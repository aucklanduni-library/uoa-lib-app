var JSCompressor = require("./js-compressor"),
    CSSCompressor = require("./css-compressor"),
    StaticResourceProvider = require("./static-resource-provider");

var Promise = require("bluebird"),
    path = require("path");

var PACKAGE_LOG_PREFIX = "[WebPacker/Package] ";


function Package(jsFilePath, cssFilePath, staticResourcePath, logger, debug) {

    if(jsFilePath) {
        var jsFileName = path.basename(jsFilePath);
        var jsRootURL = path.dirname(jsFilePath);

        this._jsFilePath = jsFilePath;
        this._jsCompressor = new JSCompressor(jsFileName, jsRootURL, debug);
    } else {
        this._jsFilePath = null;
        this._jsCompressor = null;
    }

    if(cssFilePath) {
        var cssFileName = path.basename(cssFilePath);
        var cssRootURL = path.dirname(cssFilePath);

        this._cssFilePath = cssFilePath;
        this._cssCompressor = new CSSCompressor(cssFileName, cssRootURL, debug);
    } else {
        this._cssFilePath = null;
        this._cssCompressor = null;
    }

    if(typeof(staticResourcePath) === "string") {
        this._staticResourcePath = staticResourcePath;
        this._staticResourceProvider = new StaticResourceProvider(staticResourcePath, debug);
    } else {
        this._staticResourcePath = null;
        this._staticResourceProvider = null;
    }

    this._hasJS = false;
    this._jsSHAHash = null;

    this._hasCSS = false;
    this._cssSHAHash = null;

    this._hasStaticResources = false;
    this._references = [];

    this._logger = logger;
}

Package.prototype.compress = function() {

    var p = [];
    var self = this;

    if(this._jsCompressor) {
        p.push(this._jsCompressor.compress().then(function(shaHash) {
            if(shaHash) {
                self._jsSHAHash = shaHash;
            }
        }));
    }

    if(this._cssCompressor) {
        p.push(this._cssCompressor.compress().then(function(shaHash) {
            if(shaHash) {
                self._cssSHAHash = shaHash;
            }
        }));
    }

    return Promise.all(p);
};


Package.prototype.registerRoutes = function(app) {

    var self = this;

    return new Promise(function(resolve, reject) {
        if(self._jsCompressor) {
            self._jsCompressor.setupRoutes(app, self._logger);
        }
        if(self._cssCompressor) {
            self._cssCompressor.setupRoutes(app, self._logger);
        }
        if(self._staticResourceProvider) {
            self._staticResourceProvider.setupRoutes(app, self._logger);
        }
        resolve();
    });
};


// Adding JavaScript files to package
// ---
Package.prototype.addJSFile = function(jsFile, prefix, fixes, basename) {
    if(!this._jsCompressor) {
        if(this._logger) {
            this._logger.error(PACKAGE_LOG_PREFIX + "adding js file to package with no compressed js file path");
        }
        return Promise.reject(new Error("Adding JS file to package with no compressed js file path"));
    }
    this._hasJS = true;
    return this._jsCompressor.addFile(jsFile, prefix, fixes, basename)
};

Package.prototype.addJSDirectory = function(directory, prefix, recursive) {
    if(!this._jsCompressor) {
        if(this._logger) {
            this._logger.error(PACKAGE_LOG_PREFIX + "adding js directory to package with no compressed js file path");
        }
        return Promise.reject(new Error("Adding JS directory to package with no compressed js file path"));
    }
    this._hasJS = true;
    return this._jsCompressor.addFilesInPath(directory, prefix, recursive || false);
};

Package.prototype.addJavascript = function(jsContent, prefix, basename) {
    if(!this._jsCompressor) {
        if(this._logger) {
            this._logger.error(PACKAGE_LOG_PREFIX + "adding js content to package with no compressed js file path");
        }
        return Promise.reject(new Error("Adding javascript to package with no compressed js file path"));
    }
    this._hasJS = true;
    return this._jsCompressor.addContent(jsContent, prefix, basename);
};


// Adding CSS files to package
// ---
Package.prototype.addCSSFile = function(cssFile, prefix, fixes, basename) {
    if(!this._cssCompressor) {
        if(this._logger) {
            this._logger.error(PACKAGE_LOG_PREFIX + "adding css file to package with no compressed css file path");
        }
        return Promise.reject(new Error("Adding CSS file to package with no compressed CSS file path"));
    }
    this._hasCSS = true;
    return this._cssCompressor.addFile(cssFile, prefix, fixes, basename);
};

Package.prototype.addCSSDirectory = function(directory, prefix, recursive) {
    if(!this._cssCompressor) {
        if(this._logger) {
            this._logger.error(PACKAGE_LOG_PREFIX + "adding css directory to package with no compressed css file path");
        }
        return Promise.reject(new Error("Adding CSS directory to package with no compressed CSS file path"));
    }
    this._hasCSS = true;
    return this._cssCompressor.addFilesInPath(directory, prefix, recursive || false);
};

Package.prototype.addCSS = function(cssContent, prefix, basename) {
    if(!this._cssCompressor) {
        if(this._logger) {
            this._logger.error(PACKAGE_LOG_PREFIX + "adding css content to package with no compressed css file path");
        }
        return Promise.reject(new Error("Adding css to package with no compressed css file path"));
    }
    this._hasCSS = true;
    return this._cssCompressor.addContent(cssContent, prefix, basename);
};


// Adding static resources
// ---
Package.prototype.addStaticResources = function(directory, prefix, recursive, nameMatch, cacheOpts) {
    if(!this._staticResourceProvider) {
        if(this._logger) {
            this._logger.error(PACKAGE_LOG_PREFIX + "adding static resource directory to package with no static resources path");
        }
        return Promise.reject(new Error("Adding static resource directory to package with no static resources path"));
    }

    this._hasStaticResources = true;
    return this._staticResourceProvider.addDirectory(directory, prefix, recursive, nameMatch, cacheOpts);
};


// Add bundle references
// ---
Package.prototype.addBundleReferences = function(references) {

    if(typeof(references) === "string") {
        references = [references];
    }

    if(references instanceof Array) {

        var allReferences = this._references;

        references = references.filter(function(x) {
            return (allReferences.indexOf(x) === -1);
        });

        if(references.length) {
            allReferences.push.apply(allReferences, references);
        }
    }
};

Package.prototype.bundleReferences = function() {
    return (this._references && this._references.length) ? this._references : null;
};


// Adding all files from another package
// ---
Package.prototype.addPackage = function(pckge) {

    if(pckge._jsCompressor && this._jsCompressor) {
        if(this._jsCompressor.addFilesFromCompressor(pckge._jsCompressor)) {
            this._hasJS = true;
        }
    }

    if(pckge._cssCompressor && this._cssCompressor) {
        if(this._cssCompressor.addFilesFromCompressor(pckge._cssCompressor)) {
            this._hasCSS = true;
        }
    }

    if(pckge._staticResourceProvider && this._staticResourceProvider) {
        if(this._staticResourceProvider.addFilesFromProvider(pckge._staticResourceProvider)) {
            this._hasStaticResources = true;
        }
    }

    if(pckge._references && pckge._references.length) {
        this.addBundleReferences(pckge._references);
    }
};



// Links (for insertion)
Package.prototype.links = function(baseURLPath) {

    var result = "";

    if(this._hasJS) {
        result += '<script src="' + (baseURLPath || "") + this._jsFilePath + (this._jsSHAHash ? "?r=" + this._jsSHAHash : "") + '"></script>' + "\n";
    }

    if(this._hasCSS) {
        result += '<link rel="stylesheet" href="' + (baseURLPath || "") + this._cssFilePath + (this._cssSHAHash ? "?r=" + this._cssSHAHash : "") + '" />'+ "\n";
    }

    return result;
};

Package.prototype.jsLinks = function(baseURLPath) {

    var result = "";
    if(this._hasJS) {
        result += '<script src="' + (baseURLPath || "") + this._jsFilePath + (this._jsSHAHash ? "?r=" + this._jsSHAHash : "") + '"></script>' + "\n";
    }
    return result;
};

Package.prototype.cssLinks = function(baseURLPath) {

    var result = "";
    if(this._hasCSS) {
        result += '<link rel="stylesheet" href="' + (baseURLPath || "") + this._cssFilePath + (this._cssSHAHash ? "?r=" + this._cssSHAHash : "") + '" />'+ "\n";
    }
    return result;
};

Package.prototype.staticLink = function(baseURLPath) {

    var link = (baseURLPath || "") + this._staticResourcePath;
    if(link[link.length - 1] !== "/") {
        link += "/";
    }

    for(var i = 1; i < arguments.length; i++) {
        var l = arguments[i];
        if(l[0] === "/") {
            l = l.substr(1);
        }
        link += l;
    }

    return link;
};



Package.prototype.jsFilePath = function() {
    return this._hasJS ? this._jsFilePath : null;
};

Package.prototype.jsFileHash = function() {
    return this._hasJS ? this._jsSHAHash : null;
};

Package.prototype.resolvedJSFilePath = function(baseURLPath) {
    return this._hasJS ? ((baseURLPath || "") + this._jsFilePath + (this._jsSHAHash ? "?r=" + this._jsSHAHash : "")) : null;
};

Package.prototype.hasJS = function() {
    return this._hasJS;
};



Package.prototype.cssFilePath = function() {
    return this._hasCSS ? this._cssFilePath : null;
};

Package.prototype.cssFileHash = function() {
    return this._hasCSS ? this._cssSHAHash : null;
};

Package.prototype.resolvedCSSFilePath = function(baseURLPath) {
    return this._hasJS ? ((baseURLPath || "") + this._cssFilePath + (this._cssSHAHash ? "?r=" + this._cssSHAHash : "")) : null;
};



Package.prototype.allBundleReferences = function() {
    return (this._references && this._references.length) ? this._references.slice() : null;
};


module.exports = Package;