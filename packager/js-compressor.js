var UglifyJS = require("uglify-js"),
    crypto = require('crypto'),
    Promise = require('bluebird'),
    path = require("path"),
    async = require("async"),
    fs = require("fs");

var errors = require("./../errors");


function JSCompressor(filename, rootURL, debug) {

    this._outputFileName = filename;
    this._files = [];
    this._rootURL = rootURL;
    this._sourcePrefix = "src";
    this._sourceURLBase = rootURL + ((rootURL[rootURL.length - 1] !== "/") ? "/" : "") + this._sourcePrefix + "/";

    this._baseURLToCompressedLookup = {};
    this._fileNameMap = null;

    this._defaultCompressorOptions = !!debug ? DebugDefaultCompressorOptions : DefaultCompressorOptions;
}


// These options make it easier to debug source code using the minified source.
var DebugDefaultCompressorOptions = {
    sequences:false,
    dead_code:false,
    unsafe:false,
    unsafe_comps:false,
    conditionals:false,
    evaluate:false,
    loops:false,
    unused:false,
    hoist_funs:false,
    hoist_vars:false,
    if_return:false,
    cascade:false,
    warnings: true
};

var DefaultCompressorOptions = {
    hoist_funs:false,
    hoist_vars:false,
    warnings: false
};



function _safeAddPath(root, addition) {
    root = root || "";
    if(addition[0] === "/"){
        addition = addition.substr(1);
    }
    return root + (root.length ? (root[root.length-1] === "/" ? "" : "/") : "") + addition;
}


JSCompressor.prototype.addFile = function(file, prefix, fixes, basename) {
    if(file) {
        this._files.push({path:file, basename:_safeAddPath(prefix, basename || path.basename(file)), fixes:fixes});
    }
    return Promise.resolve();
};

JSCompressor.prototype.addContent = function(js, prefix, basename) {
    if(js) {
        this._files.push({content:js, basename:_safeAddPath(prefix, basename)});
    }
    return Promise.resolve();
};


JSCompressor.prototype.addFilesInPath = function(path, prefix, recursive) {

    return this._addFilesInPath("" || prefix, path, recursive);
};

JSCompressor.prototype._addFilesInPath = function(prefix, srcPath, recursive) {

    // Read in directory.
    var self = this;

    return new Promise(function(resolve, reject) {

        fs.readdir(srcPath, function(err, files) {

            if(err) {
                return reject(err);
            }

            async.eachSeries(files, function(name, done) {

                var itemPath = path.join(srcPath, name);

                fs.stat(itemPath, function (err, stats) {
                    if(err) {
                        return done(err);
                    }

                    if(stats.isDirectory()) {

                        if(recursive) {
                            self._addFilesInPath(_safeAddPath(prefix || "", name + "/"), itemPath, true).then(function() {
                                done();
                            }).catch(function(err) {
                                done(err);
                            });
                        } else {
                            done();
                        }

                    } else {

                        if(name.match(/\.js$/i)) {
                            self._files.push({path:itemPath, basename:_safeAddPath(prefix, name)});
                        }
                        done();
                    }
                });

            }, function(err) {

                if(err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    });
};

JSCompressor.prototype.addFilesFromCompressor = function(compressor) {

    if(!this._files) {
        this._files = [];
    }

    if(compressor._files && compressor._files.length) {
        var t = this._files;
        compressor._files.forEach(function(p) {
            t.push(p);
        });
        return true;
    }

    return false;
};

function _applyFixesToData(f, data) {
    if(f.fixes && f.fixes instanceof Array && f.fixes.length) {
        f.fixes.forEach(function(fix) {
            if(fix.find && fix.replacement) {
                data = data.replace(fix.find, fix.replacement);
            }
        });
    }
    return data;
}

JSCompressor.prototype.compress = function(compressOptions) {

    var self = this;

    return new Promise(function(resolve, reject) {

        if(self._compressedAST) {
            return resolve(self._shaHash);
        }

        var shasum = crypto.createHash('sha1');
        var fileMap = {};
        var files = [];
        var toplevel = null;

        for(var i = 0; i < self._files.length; i++) {

            var p = self._files[i];
            if(fileMap.hasOwnProperty(p.basename)) {
                return reject(new Error("Duplicate filename [" + p.basename + "] during js compression."));
            }

            fileMap[p.basename.toLowerCase()] = p;
            files.push(p);
        }

        self._fileNameMap = fileMap;

        async.eachSeries(files, function(f, callback) {

            if(f.path) {
                fs.readFile(f.path, "utf8", function(err, data) {
                    if(err) {
                        return callback(err);
                    }

                    data = _applyFixesToData(f, data);
                    shasum.update(data);

                    toplevel = UglifyJS.parse(data, {
                        filename: f.basename,
                        toplevel: toplevel
                    });

                    callback();
                });
            } else if(f.content) {
                shasum.update(f.content);
                toplevel = UglifyJS.parse(f.content, {
                    filename: f.basename,
                    toplevel: toplevel
                });

                callback();
            } else {

                callback();
            }


        }, function(err) {

            if(err) {
                return reject(err);
            }

            if(toplevel) {
                toplevel.figure_out_scope();
                var compressor = UglifyJS.Compressor(compressOptions || self._defaultCompressorOptions);
                self._compressedAST = toplevel.transform(compressor);
                self._shaHash = shasum.digest('hex').toLowerCase();
            } else {
                self._compressedAST = null;
                self._shaHash = null;
            }

            resolve(self._shaHash);
        });
    });
};

JSCompressor.prototype.compressSync = function(compressOptions) {

    if(this._compressedAST) {
        return this._shaHash;
    }

    var shasum = crypto.createHash('sha1');
    var fileMap = {};
    var files = [];
    var toplevel = null;

    for(var i = 0; i < this._files.length; i++) {

        var p = this._files[i];
        if(fileMap.hasOwnProperty(p.basename)) {
            console.error("[CSSCompressor] Duplicate filename [" + p.basename + "] during js compression");
            return null;
        }

        fileMap[p.basename.toLowerCase()] = p;
        files.push(p);
    }

    this._fileNameMap = fileMap;

    for(var j = 0; j < files.length; j++) {
        var f = files[j];

        if(f.path) {
            var data = fs.readFileSync(f.path, "utf8");
            if(!data) {
                console.error("[CSSCompressor] Unable to read file at path [" + f.path + "]");
                return null;
            }

            data = _applyFixesToData(f, data);
            shasum.update(data);
            toplevel = UglifyJS.parse(data, {
                filename: f.basename,
                toplevel: toplevel
            });
        } else if(f.content) {
            shasum.update(f.content);
            toplevel = UglifyJS.parse(f.content, {
                filename: f.basename,
                toplevel: toplevel
            });
        }
    }

    if(toplevel) {
        toplevel.figure_out_scope();
        var compressor = UglifyJS.Compressor(compressOptions || this._defaultCompressorOptions);
        this._compressedAST = toplevel.transform(compressor);
        this._shaHash = shasum.digest('hex').toLowerCase();
    } else {
        this._compressedAST = null;
        this._shaHash = null;
    }

    return this._shaHash;
};

JSCompressor.prototype._lookupForBaseURLPath = function(baseURLPath) {

    if(!baseURLPath) {
        baseURLPath = "";
    }

    var lookup = (baseURLPath === "") ? "$BASEURL$" : baseURLPath;
    var self = this;

    return new Promise(function(resolve, reject) {

        if(self._baseURLToCompressedLookup.hasOwnProperty(lookup)) {
            return resolve(self._baseURLToCompressedLookup[lookup]);
        }

        var sourceMapOptions = {};
        sourceMapOptions.file = self._outputFileName;
        sourceMapOptions.root = baseURLPath + self._sourceURLBase;

        var sourceMap = UglifyJS.SourceMap(sourceMapOptions);
        var stream = UglifyJS.OutputStream({
            source_map: sourceMap
        });
        self._compressedAST.print(stream);

        var r = {};
        r._code = stream.toString();
        r._map = sourceMap.toString();

        self._baseURLToCompressedLookup[lookup] = r;
        resolve(r);
    });
};

JSCompressor.prototype.fileHash = function() {
    return this._shaHash;
};

JSCompressor.prototype.setupRoutes = function(app, logger) {

    var requestBaseURL = this._rootURL + ((this._rootURL[this._rootURL.length - 1] !== "/") ? "/" : "");
    var jsFileName = this._outputFileName;
    var sourceFileName = jsFileName.replace(/\.js$/, ".map");
    var self = this;

    app.get(requestBaseURL + jsFileName, function(request, response, next) {
        self._lookupForBaseURLPath(request.baseURLPath).then(function(r) {
            if(r && r._code) {

                var revision = request.query ? request.query.r : "";
                if(revision) {
                    revision = ("" + revision).toLowerCase();

                    // If a revision has been included and we don't supply that particular version,
                    // then we redirect to the base version with no revision specified.
                    if(revision !== self._shaHash) {
                        return response.redirect((request.baseURLPath || "") + request.path);
                    }
                }

                response.header("Content-Type", "application/javascript");
                response.header("X-SourceMap", (request.baseURLPath || "") + requestBaseURL + sourceFileName);
                if(revision) {
                    response.header("Cache-Control", "public, max-age=31536000");
                }
                response.send(r._code);
            } else {
                next(new errors.NotFoundError());
            }
        }).catch(function(err) {
            logger.error("[JSCompressor/Handler] unable to find compressed JS for provided Base URL [" + request.baseURLPath + "] due to: " + err.toString());
            next(err);
        });
    });

    app.get(requestBaseURL + sourceFileName, function(request, response, next) {
        self._lookupForBaseURLPath(request.baseURLPath).then(function(r) {
            if(r && r._map) {
                response.header("Content-Type", "application/octet-stream");
                response.send(r._map);
            } else {
                next(new errors.NotFoundError());
            }
        }).catch(function(err) {
            logger.error("[JSCompressor/Handler] unable to find compressed JS for provided Base URL [" + request.baseURLPath + "] due to: " + err.toString());
            next(err);
        });
    });

    var srcRegExp = new RegExp("^" + this._sourceURLBase + "(.*)$", "i");

    app.get(srcRegExp, function(request, response, next) {

        var filename = request.params[0].toLowerCase();
        if(!self._fileNameMap.hasOwnProperty(filename)) {
            return next();
        }

        var f = self._fileNameMap[filename];

        if(f.path) {
            if(f.fixes && f.fixes.length) {
                fs.readFile(f.path, "utf8", function(err, data) {
                    if(err) {
                        return next(err);
                    }
                    data = _applyFixesToData(f, data);
                    response.header("Content-Type", "application/javascript");
                    response.send(data);
                });
            } else {
                response.sendFile(f.path, {dotfiles: 'deny'});
            }
        } else if(f.content) {
            response.header("Content-Type", "application/javascript");
            response.send(f.content);
        } else {
            next();
        }
    });
};

module.exports = JSCompressor;