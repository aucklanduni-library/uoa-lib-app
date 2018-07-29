var Promise = require("bluebird"),
    async = require("async"),
    path = require("path");

var DirectoryLoader = require("./directory-loader");


function RoutesLoader() {
    this._paths = [];
}

RoutesLoader.prototype.addPath = function(addPath, recursive) {

    this._paths.push({path:addPath, recursive:(recursive || false)});
};


function _loadRoutesPath(app, config, srcPath, recursive, logger) {

    var loader = new DirectoryLoader(srcPath, recursive, /\.js$/i);

    return loader.run(function(loadPath) {
        var m;
        m = require(loadPath);
        if(!m || !m.setup) {
            return Promise.resolve();
        }

        return m.setup(app, config, app.app).then(function() {
            if(logger) {
                logger.verbose("Successfully loaded route [" + path.basename(loadPath) + "]");
            }
        });
    });
}


RoutesLoader.prototype.load = function(app, config, logger) {

    var paths = this._paths;

    return new Promise(function(resolve, reject) {

        async.forEachSeries(paths, function(path, done) {

            _loadRoutesPath(app, config, path.path, path.recursive, logger).then(function() {
                done();
            }).catch(function(err) {
                done(err);
            });

        }, function(err) {

            if(err) {
                return reject(err);
            }

            resolve();
        });
    });
};

module.exports = RoutesLoader;