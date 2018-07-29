// Simple webpacker combines multiple files expressed via a block into a single JS/CSS file.
// Provides a simple handlebars helper as well.

var Package = require("./packager/package");

var PACKER_LOG_PREFIX = "[WebPacker] ";

function WebPacker() {
    this._packageCache = {};
}

WebPacker.prototype.registerHandlebarsHelper = function(handlebars, logger) {

    var self = this;

    handlebars.registerHelper("uoa-lib-app-package", function(baseURLPath, packageName) {

        if(this._packageCache.hasOwnProperty(packageName)) {
            var pckge = self._packageCache[packageName];
            return pckge.links(baseURLPath);
        }

        logger.error(PACKER_LOG_PREFIX + "unable to find named package {" + packageName + "}");
        return "";
    });
};

WebPacker.prototype.createPackage = function(jsFilePath, cssFilePath, staticResourcePath, logger, debug) {

    return new Package(jsFilePath, cssFilePath, staticResourcePath, logger, debug);
};

WebPacker.prototype.registerPackage = function(packageName, pckge) {

    var self = this;

    return pckge.compress().then(function() {
        self._packageCache[packageName] = pckge;
    });
};

module.exports = WebPacker;