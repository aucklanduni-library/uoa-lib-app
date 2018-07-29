var Promise = require("bluebird"),
    async = require("async"),
    path = require("path");

var DirectoryLoader = require("./directory-loader");


function DataProviderLoader() {
    this._paths = [];
}

DataProviderLoader.prototype.addPath = function(addPath, recursive) {

    this._paths.push({path:addPath, recursive:(recursive || false)});
};


function _loadProviderPath(app, config, srcPath, recursive, logger) {

    var loader = new DirectoryLoader(srcPath, recursive, /\.js$/i);

    return loader.run(function(loadPath) {
        var m;
        m = require(loadPath);
        if(!m || !m.setup) {
            return Promise.resolve();
        }

        return m.setup(app, config).then(function() {
            if(logger) {
                logger.verbose("Successfully loaded data provider [" + path.basename(loadPath) + "]");
            }
        });
    });
}


DataProviderLoader.prototype.load = function(app, config, logger) {

    var paths = this._paths;

    return new Promise(function(resolve, reject) {

        async.forEachSeries(paths, function(path, done) {

            _loadProviderPath(app, config, path.path, path.recursive, logger).then(function() {
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

module.exports = DataProviderLoader;