var DirectoryLoader = require("./../directory-loader"),
    Promise = require("bluebird"),
    path = require("path");


function StaticResourceProvider(rootURL) {

    this._rootURL = rootURL;
    this._fileMap = {};
}

function _duplicateCacheOptions(cacheOpts) {
    if(!cacheOpts) {
        return null;
    }

    var _cacheOpts = {};
    for(var k in cacheOpts) {
        if(cacheOpts.hasOwnProperty(k)) {
            _cacheOpts[k] = cacheOpts[k];
        }
    }

    return _cacheOpts;
}


StaticResourceProvider.prototype.addFile = function(filePath, prefix, cacheOpts) {

    if(!prefix) {
        prefix = "";
    } else if(prefix[prefix.length - 1] !== "/") {
        prefix = prefix + "/";
    }

    var lookupPath;

    lookupPath = prefix + path.basename(filePath);
    lookupPath = lookupPath.toLowerCase();

    cacheOpts = _duplicateCacheOptions(cacheOpts);

    if(cacheOpts) {
        self._fileMap[lookupPath] = cacheOpts ? {path:filePath, cache:cacheOpts} : filePath;
    } else {
        this._fileMap[lookupPath] = filePath;
    }
};

StaticResourceProvider.prototype.addDirectory = function(directory, prefix, recursive, nameRegex, cacheOpts) {

    if(!prefix) {
        prefix = "";
    } else if(prefix[prefix.length - 1] !== "/") {
        prefix = prefix + "/";
    }

    cacheOpts = _duplicateCacheOptions(cacheOpts);

    var self = this;

    var loader = new DirectoryLoader(directory, recursive, function(name, srcPath) {
        if(!nameRegex) {
            return true;
        }
        return name.match(nameRegex);
    });

    return loader.run(function(itemPath, name, basePath, depth) {

        var relativePath = path.relative(basePath, itemPath);
        var lookupPath;

        lookupPath = prefix + relativePath;
        lookupPath = lookupPath.toLowerCase();

        if(lookupPath.length && lookupPath[0] !== "/") {
            lookupPath = "/" + lookupPath;
        }

        self._fileMap[lookupPath] = cacheOpts ? {path:itemPath, cache:cacheOpts} : itemPath;
        return Promise.resolve();
    });
};

StaticResourceProvider.prototype.addFilesFromProvider = function(staticResourceProvider) {
    var didAdd = false;

    if(staticResourceProvider && staticResourceProvider._fileMap) {

        for(var k in staticResourceProvider._fileMap) {
            if(staticResourceProvider._fileMap.hasOwnProperty(k) && !this._fileMap.hasOwnProperty(k)) {
                this._fileMap[k] = staticResourceProvider._fileMap[k];
                didAdd = true;
            }
        }
    }

    return didAdd;
};



StaticResourceProvider.prototype.setupRoutes = function(app) {

    var srcRegExp = new RegExp("^" + this._rootURL + "(.*)$", "i");
    var self = this;

    app.get(srcRegExp, function(request, response, next) {
        var filename = request.params[0].toLowerCase();
        if(!self._fileMap.hasOwnProperty(filename)) {
            return next();
        }
        var details = self._fileMap[filename];
        var opts = {dotfiles: 'deny'};

        if(typeof details === "string") {
            return response.sendFile(self._fileMap[filename], opts);
        }

        if(!details.path) {
            return next();
        }

        if(details.cache && details.cache.maxAge) {
            opts.maxAge = details.cache.maxAge;
        }

        response.sendFile(details.path, opts);
    });
};


module.exports = StaticResourceProvider;