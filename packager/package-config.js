var async = require("async"),
    fs = require("fs");

// ---
// Package Config
// ---

function PackageConfig(packageReference) {

    this._packageReference = packageReference;
    this._defaultJSPath = null;
    this._defaultCSSPath = null;
    this._defaultStaticPath = null;

    this._packageContents = [];

    this._includeRequireJSConfig = false;
    this._startingReferences = null;
}

PackageConfig.prototype.reference = function() {
    return this._packageReference;
};

PackageConfig.prototype.paths = function(jsPath, cssPath, staticPath) {

    this._defaultJSPath = jsPath;
    this._defaultCSSPath = cssPath;
    this._defaultStaticPath = staticPath;
    return this;
};

PackageConfig.prototype.insertRequireJSConfig = function(startingReference) {
    this._includeRequireJSConfig = true;
    this._startingReferences = startingReference;
};

PackageConfig.prototype.javascript = function(path, prefix, recursive) {

    if(arguments.length === 2) {
        if(typeof prefix === 'boolean') {
            recursive = prefix;
            prefix = null;
        }
    }

    if(path instanceof Array) {
        for(var i = 0; i < path.length; i++) {
            this._packageContents.push({type:"js", path:path[i], prefix:(prefix || null), recursive:(recursive || false)});
        }
    } else {
        this._packageContents.push({type:"js", path:path, prefix:(prefix || null), recursive:(recursive || false)});
    }

    return this;
};

PackageConfig.prototype.rawJavascript = function(content, prefix, basename) {
    if(arguments.length === 2) {
        basename = prefix;
        prefix = null;
    }
    this._packageContents.push({type:"js-raw", content:content, prefix:prefix, basename:basename});
};

PackageConfig.prototype.css = function(path, prefix, recursive) {

    if(arguments.length === 2) {
        if(typeof prefix === 'boolean') {
            recursive = prefix;
            prefix = null;
        }
    }

    if(path instanceof Array) {
        for(var i = 0; i < path.length; i++) {
            this._packageContents.push({type:"css", path:path[i], prefix:(prefix || null), recursive:(recursive || false)});
        }
    } else {
        this._packageContents.push({type:"css", path:path, prefix:(prefix || null), recursive:(recursive || false)});
    }

    return this;
};

PackageConfig.prototype.rawCSS = function(content, prefix, basename) {
    if(arguments.length === 2) {
        basename = prefix;
        prefix = null;
    }
    this._packageContents.push({type:"css-raw", content:content, prefix:prefix, basename:basename});
};

PackageConfig.prototype.static = function(path, prefix, recursive, nameRegex, cacheOpts) {

    if(recursive instanceof RegExp) {
        nameRegex = recursive;
        recursive = false;
    }

    if(typeof prefix === 'boolean') {
        recursive = prefix;
        prefix = null;
    }

    var opts = {type:"static", path:path, prefix:prefix, recursive:recursive};
    if(nameRegex) {
        opts.match = nameRegex;
    }
    if(cacheOpts) {
        opts.cache = cacheOpts;
    }

    // add static resources to the default package
    this._packageContents.push(opts);
    return this;
};

PackageConfig.prototype.package = function(packageDesc) {

    // Add a package from a registered module to the default package.
    this._packageContents.push({type:"package", ref:packageDesc});
    return this;
};

PackageConfig.prototype.templates = function(templateID, templatePacker, prefix, basename, registerWithRenderer, rendererType) {

    this._packageContents.push({type:"templates", templateID:templateID, packer:templatePacker, rendererType:(rendererType || "default"), prefix:(prefix || ""), basename:basename, register:registerWithRenderer});
    return this;
};


PackageConfig.prototype.bundle = function(bundle) {

    this._packageContents.push({type:"bundle", content:bundle});
    return this;
};


function __findMatchingModuleForPackageReference(pckgRef, modules) {

    var allMatchingPackages = [];

    for(var i = 0; i < modules.length; i++) {
        var m = modules[i];
        var matchingPackages;

        if(m) {
            matchingPackages = m.findMatchingPackages(pckgRef);
            if(matchingPackages && matchingPackages.length) {
                allMatchingPackages.push.apply(allMatchingPackages, matchingPackages);
            }
        }
    }

    return allMatchingPackages.length ? allMatchingPackages : null;
}


PackageConfig.prototype._jsPath = function() {

    return this._defaultJSPath || ("/resources/" + (this._packageReference.toLowerCase().replace("_", "-").replace(/[^A-Za-z0-9\-]/gi, "")) +"/js/client.js");
};


PackageConfig.prototype.createPackage = function(webpacker, renderers, modules, logger, debug) {

    var safePackageReference = this._packageReference.toLowerCase().replace("_", "-").replace(/[^A-Za-z0-9\-]/gi, "");
    var jsPath = this._jsPath();
    var cssPath = this._defaultCSSPath || ("/resources/" + safePackageReference + "/css/client.css");
    var staticResourcePath = (typeof(this._defaultStaticPath) === "string") ? this._defaultStaticPath : ("/resources/" + safePackageReference);
    var self = this;

    return new Promise(function(resolve, reject) {

        if(!self._packageContents || !self._packageContents.length) {
            return resolve(null);
        }

        var newPackage;
        newPackage = webpacker.createPackage(jsPath, cssPath, staticResourcePath, logger, debug);

        async.eachSeries(self._packageContents, function(p, done) {

            var srcPath;

            if(p.type === "js" || p.type === "css") {

                srcPath = p.path;

                fs.stat(srcPath, function (err, stats) {
                    if(err) {
                        return done(err);
                    }

                    var isDir = stats.isDirectory();
                    var pr;

                    if(p.type === "js") {
                        if(isDir) {
                            pr = newPackage.addJSDirectory(srcPath, p.prefix, p.recursive || false);
                        } else {
                            pr = newPackage.addJSFile(srcPath, p.prefix, null, null);
                        }
                    } else {
                        if(isDir) {
                            pr = newPackage.addCSSDirectory(srcPath, p.prefix, p.recursive || false);
                        } else {
                            pr = newPackage.addCSSFile(srcPath, p.prefix, null, null);
                        }
                    }

                    pr.then(function() {
                        done();
                    }).catch(function(e) {
                        done(e);
                    });
                });

            } else if(p.type === "js-raw" && p.content && p.basename) {

                newPackage.addJavascript(p.content, p.prefix || null, p.basename).then(function() {
                    done();
                });

            } else if(p.type === "css-raw" && p.content && p.basename) {

                newPackage.addCSS(p.content, p.prefix || null, p.basename).then(function() {
                    done();
                });

            } else if(p.type === "package" && p.ref && modules && modules.length) {

                var matchingPackages = __findMatchingModuleForPackageReference(p.ref, modules);
                if(matchingPackages) {
                    matchingPackages.forEach(function(pckge) {
                        newPackage.addPackage(pckge);
                    });
                } else {
                    logger.warn("Unable to find any matching packages for [" + p.ref + "]");
                }

                done();

            } else if(p.type === "static") {

                newPackage.addStaticResources(p.path, p.prefix, p.recursive || false, p.match, p.cache || null).then(function() {
                    done();
                }).catch(function(e) {
                    done(e);
                });

            } else if(p.type === "templates") {

                // We need resolve the template packer and then add the packed JavaScript result (packed templates for client).
                var renderer = (p.rendererType && renderers.hasOwnProperty(p.rendererType)) ? renderers[p.rendererType] : null;
                if(!renderer) {
                    return done(new Error("Unable to find renderer [" + p.rendererType + "] for packed templates in package."));
                }

                if(p.packer && renderer) {

                    p.packer.pack(p.templateID, renderer, p.register, logger).then(function(packedTemplates) {
                        newPackage.addJavascript(packedTemplates, p.prefix, p.basename);
                        done();
                    }).catch(function(err) {
                        done(err);
                    });

                } else {

                    done();
                }

            } else if(p.type === "bundle" && p.content && (typeof(p.content) === "string" || p.content instanceof Array)) {

                newPackage.addBundleReferences(p.content);
                done();

            } else {

                done();
            }

        }, function(err) {

            if(err) {
                return reject(err);
            }
            return resolve(newPackage);
        });

    });
};


PackageConfig.prototype.allBundleReferences = function(modules) {

    if(!this._packageContents || !this._packageContents.length) {
        return null;
    }

    var bundleRefs = [];

    this._packageContents.forEach(function(p) {
        if(p.type === "bundle" && p.content && (typeof(p.content) === "string" || p.content instanceof Array)) {

            var c = p.content;
            if(typeof(c) === "string") {
                c = [c];
            }

            if(c instanceof Array && c.length) {
                c.forEach(function(ref) {
                    if(typeof(ref) === "string" && bundleRefs.indexOf(ref) === -1) {
                        bundleRefs.push(ref);
                    }
                });
            }
        } else if(p.type === "package" && p.ref && modules && modules.length) {

            var matchingPackages = __findMatchingModuleForPackageReference(p.ref, modules);
            if(matchingPackages) {
                matchingPackages.forEach(function(pckge) {
                    var pckgBundleRefs = pckge.bundleReferences();
                    if(pckgBundleRefs && pckgBundleRefs.length) {
                        pckgBundleRefs.forEach(function(ref) {
                            if(typeof(ref) === "string" && bundleRefs.indexOf(ref) === -1) {
                                bundleRefs.push(ref);
                            }
                        });
                    }
                });
            }
        }
    });

    return (bundleRefs.length) ? bundleRefs : null;
};


PackageConfig.prototype.containsJS = function(modules) {

    for(var i = 0; i < this._packageContents.length; i++) {
        var p = this._packageContents[i];
        if(!p) {
            continue;
        }

        if(p.type === "js") {
            return true;
        }

        if(p.type === "package" && p.ref && modules && modules.length) {

            var matchingPackages = __findMatchingModuleForPackageReference(p.ref, modules);
            if(matchingPackages) {
                for(var ii = 0; ii < matchingPackages.length; i++) {
                    var pckg = matchingPackages[ii];
                    if(pckg && pckg.hasJS()) {
                        return true;
                    }
                }
            }
        }
    }

    return false;
};

PackageConfig.prototype.jsPath = function(baseURLPath) {
    return ((baseURLPath || "") + this._jsPath());
};

PackageConfig.prototype.wantsRequireJSConfig = function() {
    return this._includeRequireJSConfig;
};

PackageConfig.prototype.requireJSStartingPoints = function() {
    return this._startingReferences;
};


module.exports = PackageConfig;
