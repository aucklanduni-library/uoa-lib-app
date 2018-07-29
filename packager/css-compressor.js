var CleanCSS = require("clean-css"),
    crypto = require('crypto'),
    Promise = require('bluebird'),
    path = require("path"),
    async = require("async"),
    fs = require("fs");

var errors = require("./../errors");


function CSSCompressor(filename, rootURL) {

    this._outputFileName = filename;
    this._files = [];
    this._rootURL = rootURL;
    this._sourcePrefix = "src";
    this._sourceURLBase = rootURL + ((rootURL[rootURL.length - 1] !== "/") ? "/" : "") + this._sourcePrefix + "/";

    this._baseURLToCompressedLookup = {};
    this._fileNameMap = null;
}

function _safeAddPath(root, addition) {
    root = root || "";
    if(addition[0] === "/"){
        addition = addition.substr(1);
    }
    return root + (root.length ? (root[root.length-1] === "/" ? "" : "/") : "") + addition;
}


CSSCompressor.prototype.addFile = function(file, prefix, fixes, basename) {
    if(file) {
        this._files.push({path:file, basename:_safeAddPath(prefix, basename || path.basename(file)), fixes:fixes});
    }
    return Promise.resolve();
};

CSSCompressor.prototype.addFilesInPath = function(path, prefix, recursive) {

    return this._addFilesInPath(prefix || "", path, recursive);
};

CSSCompressor.prototype.addContent = function(css, prefix, basename) {
    if(css) {
        this._files.push({content:css, basename:_safeAddPath(prefix, basename)});
    }
    return Promise.resolve();
};


CSSCompressor.prototype._addFilesInPath = function(prefix, srcPath, recursive) {

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

                        if(name.match(/\.css$/i)) {
                            self._files.push({path:itemPath, basename:_safeAddPath(prefix, name)});
                        }
                        done();
                    }
                });

            }, function(err) {

                if(err) {
                    return reject(err);
                }

                resolve();
            });
        });
    });
};

CSSCompressor.prototype.addFilesFromCompressor = function(compressor) {

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


CSSCompressor.prototype.compress = function(compressOptions) {

    var self = this;

    return new Promise(function(resolve, reject) {

        if(self._compressedCSS) {
            return resolve(self._shaHash);
        }

        var shasum = crypto.createHash('sha1');
        var fileMap = {};
        var files = [];

        for(var i = 0; i < self._files.length; i++) {

            var p = self._files[i];
            if(fileMap.hasOwnProperty(p.basename)) {
                return reject(new Error("Duplicate filename [" + p.basename + "] during css compression."));
            }

            fileMap[p.basename.toLowerCase()] = p;
            files.push(p);
        }

        self._fileNameMap = fileMap;

        var cssFiles = {};

        async.eachSeries(files, function(f, callback) {

            if(f.path) {
                fs.readFile(f.path, "utf8", function(err, data) {
                    if(err) {
                        return callback(err);
                    }

                    data = _applyFixesToData(f, data);
                    shasum.update(data);

                    cssFiles[self._sourcePrefix + "/" + f.basename] = {styles:data};
                    callback();
                });
            } else if(f.content) {
                shasum.update(f.content);
                cssFiles[self._sourcePrefix + "/" + f.basename] = {styles:f.content};
                callback();
            } else {
                callback();
            }

        }, function(err) {

            if(err) {
                return reject(err);
            }

            // "Minify" the CSS files.
            var cleanCSSOptions = {};
            cleanCSSOptions.sourceMap = true;
            cleanCSSOptions.rebase = false;
            cleanCSSOptions.relativeTo = null; // otherwise can make urls relative to this path

            cleanCSSOptions.advanced = false;
            cleanCSSOptions.keepBreaks = true;
            cleanCSSOptions.aggressiveMerging = false;
            cleanCSSOptions.restructuring = false;
            cleanCSSOptions.shorthandCompacting = false;
            cleanCSSOptions.processImport = false;

            cleanCSSOptions.compatibility = {
                colors: {
                    opacity: true
                },
                properties: {
                    colors: false
                }
            };

            var cleanCSS = new CleanCSS(cleanCSSOptions).minify(cssFiles, function (err, minified) {
                if(err) {
                    return reject(err);
                }

                self._compressedCSS = minified.styles;
                self._sourceMap = minified.sourceMap.toString();
                self._shaHash = shasum.digest('hex').toLowerCase();
                resolve(self._shaHash);
            });
        });
    });
};

CSSCompressor.prototype.compressSync = function(compressOptions) {

    if(this._compressedCSS) {
        return this._shaHash;
    }

    var shasum = crypto.createHash('sha1');
    var fileMap = {};
    var files = [];

    for(var i = 0; i < this._files.length; i++) {

        var p = self._files[i];
        if(fileMap.hasOwnProperty(p.basename)) {
            console.error("[CSSCompressor] Duplicate filename [" + p.basename + "] during css compression");
            return null;
        }

        fileMap[p.basename.toLowerCase()] = p;
        files.push(p);
    }

    this._fileNameMap = fileMap;

    var cssFiles = {};

    for(var j = 0; j < files.length; j++) {
        if(f.path) {
            var f = files[j];
            var data = fs.readFileSync(f.path, "utf8");
            if(!data) {
                console.error("[CSSCompressor] Unable to read file at path [" + f.path + "]");
                return null;
            }

            data = _applyFixesToData(f, data);
            shasum.update(data);
            cssFiles[this._sourcePrefix + "/" + f.basename] = {styles:data};
        } else if(f.content) {
            shasum.update(f.content);
            cssFiles[this._sourcePrefix + "/" + f.basename] = {styles:f.content};
        }
    }

    var cleanCSS = new CleanCSS({sourceMap: true}).minify(cssFiles);
    if(!cleanCSS) {
        console.error("[CSSCompressor] minification of CSS failed.");
        return null;
    }

    this._compressedCSS = cleanCSS.styles;
    this._sourceMap = cleanCSS.sourceMap.toString();
    this._shaHash = shasum.digest('hex').toLowerCase();

    return this._shaHash;
};



CSSCompressor.prototype._lookupForBaseURLPath = function(baseURLPath) {

    var r = {};
    r._code = this._compressedCSS;
    r._map = this._sourceMap;

    return new Promise(function(resolve, reject) {
        resolve(r);
    });
};


CSSCompressor.prototype.fileHash = function() {
    return this._shaHash;
};


CSSCompressor.prototype.setupRoutes = function(app, logger) {

    var requestBaseURL = this._rootURL + ((this._rootURL[this._rootURL.length - 1] !== "/") ? "/" : "");
    var cssFileName = this._outputFileName;
    var sourceFileName = cssFileName.replace(/\.css$/, ".map");
    var self = this;

    app.get(requestBaseURL + cssFileName, function(request, response, next) {
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

                response.header("Content-Type", "text/css");
                response.header("X-SourceMap", (request.baseURLPath || "") + requestBaseURL + sourceFileName);
                if(revision) {
                    response.header("Cache-Control", "public, max-age=31536000");
                }
                response.send(r._code);
            } else {
                next(new errors.NotFoundError());
            }
        }).catch(function(err) {
            logger.error("[CSSCompressor/Handler] unable to find compressed CSS for provided Base URL [" + request.baseURLPath + "] due to: " + err.toString());
            next(err);
        });
    });

    app.get(requestBaseURL + sourceFileName, function(request, response, next) {
        self._lookupForBaseURLPath(request.baseURLPath).then(function(r) {
            if(r && r._map) {
                response.header("Content-Type", "application/javascript");
                response.send(r._map);
            } else {
                next(new errors.NotFoundError());
            }
        }).catch(function(err) {
            logger.error("[CSSCompressor/Handler] unable to find compressed CSS for provided Base URL [" + request.baseURLPath + "] due to: " + err.toString());
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
                    response.header("Content-Type", "text/css");
                    response.send(data);
                });
            } else {
                response.sendFile(f.path, {dotfiles: 'deny'});
            }
        } else if(f.content) {
            response.header("Content-Type", "text/css");
            response.send(f.content);
        } else {
            response.status(404).send("Not found");
        }

    });
};

module.exports = CSSCompressor;