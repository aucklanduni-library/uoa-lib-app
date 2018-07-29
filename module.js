var Utilities = require("./utilities"),
    Package = require("./packager/package"),
    Promise = require("bluebird");

function Module(module) {

    this._module = module;
    this._name = (module && module.module) ? module.module.name : null;
    this._prefix = null;
    this._packages = null;
    this._packageLookup = null;
}

Module.prototype.name = function() {
    return this._name;
};

Module.prototype.load = function(rootURL, logger) {

    if(!this._module) {
        logger.error("Unable to load module, no module instance supplied.");
        return Promise.reject(new Error("No 'module' instance supplied during creation of 'Module' object."));
    }

    if(!this._module.module) {
        logger.error("Unable to load module, module instance doesn't have required 'module' object exported.");
        return Promise.reject(new Error("Module doesn't have required 'module' object exported."));
    }

    var module = this._module.module;
    var self = this;

    return new Promise(function(resolve, reject) {

        self._name = module.name;
        self._prefix = module.prefix || (module.name + "/");
        self._packages = [];

        if(!module.packages || !(module.packages instanceof Array) || !module.packages.length) {
            return resolve();
        }

        self._packageLookup = {};

        var packageLoadingPromises = [];

        for(var i = 0; i < module.packages.length; i++) {
            var p = module.packages[i];
            if(!p) {
                continue;
            }

            var pckgName = p.name;
            if(!pckgName) {
                return reject(new Error("Unable to load package from module {" + self._name + "} as package description has no 'name'"));
            }

            var nicePackageName = pckgName.replace(/\//gi, "-");
            var packagePrefix = Utilities.safeAppendSlash(self._prefix + self._packageNameToPrefix(nicePackageName));
            var fileNameDefault = self._packageNameToFileName(nicePackageName);

            var jsFilePath = Utilities.safeAppendSlash(rootURL || "") + packagePrefix + (p.packageJSName || (fileNameDefault + ".js"));
            var cssFilePath = Utilities.safeAppendSlash(rootURL || "") + packagePrefix + (p.packageCSSName || (fileNameDefault + ".css"));
            var staticResourcesFilePath = (p.static) ? Utilities.safeAppendSlash(rootURL || "") + packagePrefix + (p.packageStaticResourcePath || (fileNameDefault)) : null;

            var pcgk = new Package(jsFilePath, cssFilePath, staticResourcesFilePath, logger);
            var loadingPromises = [];

            if(p.js) {
                var jsFiles = p.js instanceof Array ? p.js : [p.js];
                jsFiles.forEach(function(f) {
                    loadingPromises.push(pcgk.addJSFile(f, packagePrefix));
                });
            }

            if(p.jsdir) {
                var jsDirs = p.jsdir instanceof Array ? p.jsdir : [p.jsdir];
                jsDirs.forEach(function(d) {
                    loadingPromises.push(pcgk.addJSDirectory(d, packagePrefix, true));
                });
            }

            if(p.css) {
                var cssFiles = p.css instanceof Array ? p.css : [p.css];
                cssFiles.forEach(function(f) {
                    loadingPromises.push(pcgk.addCSSFile(f, packagePrefix));
                });
            }

            if(p.cssdir) {
                var cssdir = p.cssdir instanceof Array ? p.cssdir : [p.cssdir];
                cssdir.forEach(function(d) {
                    loadingPromises.push(pcgk.addCSSDirectory(d, packagePrefix, true));
                });
            }

            if(p.module && p.resolvedJS) {

                var resolveJS = p.resolvedJS instanceof Array ? p.resolvedJS : [p.resolvedJS];
                resolveJS.forEach(function(r) {
                    var resolvedJSPath = null;
                    if(r.src) {
                        resolvedJSPath = path.join(path.dirname(require.resolve(p.module)), r.src);
                    } else if(r.ref) {
                        resolvedJSPath = require.resolve(r.ref);
                    }
                    if(resolvedJSPath) {
                        loadingPromises.push(pcgk.addJSFile(resolvedJSPath, packagePrefix, r.fixes, r.basename));
                    }
                });
            }

            if(p.static && p.static instanceof Array && p.static.length) {
                p.static.forEach(function(s) {
                    if(s.root && s.directory) {
                        loadingPromises.push(pcgk.addStaticResources(s.directory, s.root, true, s.match, s.cache));
                    }
                });
            }

            if(p.bundle && p.bundle instanceof Array && p.bundle.length) {
                pcgk.addBundleReferences(p.bundle);
            }


            // Add a promise onto "packageLoadingPromises", this promised is resolved when all of the JS/CSS/static resources are
            // added to the package. This is necessary as packages can be included on other packages and the file lists are used
            // as reference to the final packer.

            (function(pcgk, pckgName, lp) {

                var loadPackageCompleted = new Promise(function(rslv, rjct) {
                    Promise.all(lp).then(function() {
                        self._packages.push(pcgk);
                        self._packageLookup[Utilities.safeAddWithSlash(self._prefix, pckgName)] = pcgk;
                        return rslv();
                    }).catch(function(err) {
                        return rjct(err);
                    });
                });

                packageLoadingPromises.push(loadPackageCompleted);

            })(pcgk, pckgName, loadingPromises);
        }

        Promise.all(packageLoadingPromises).then(function() {

            logger.verbose("Successfully loaded module [" + self._name + "]");
            return resolve();

        }).catch(function(err) {

            return reject(err);
        });
    });
};


Module.prototype._packageNameToPrefix = function(name) {

    var s = name.replace(/\s/g, "").split("/");

    if(s.length > 1) {
        s.splice(-1,1);
        return s.join("/");
    }
    return "";
};

Module.prototype._packageNameToFileName = function(name) {

    var s = name.replace(/\s/g, "").split("/");
    return s[s.length-1];
};

Module.prototype.findMatchingPackages = function(pattern) {

    pattern = pattern.trim();
    if(pattern.match(/\/\*$/)) {
        pattern = new RegExp("^" + pattern.replace(/\/\*$/, "") + "/.*", "i");
    } else {
        pattern = new RegExp("^" + pattern + "$", "i");
    }

    if(this._packages && this._packages.length) {
        var matches = [];

        for(var k in this._packageLookup) {
            if(this._packageLookup.hasOwnProperty(k)) {
                if(k.match(pattern)) {
                    matches.push(this._packageLookup[k]);
                }
            }
        }

        return matches.length ? matches : null;
    }

    return null;
};


module.exports = Module;