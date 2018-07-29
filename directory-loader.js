var async = require("async"),
    path = require("path"),
    fs = require("fs");

function DirectoryLoader(srcPath, recursive, nameMatcher) {
    this._srcPath = srcPath;
    this._recursive = recursive;
    this._nameMatcherRegExp = (nameMatcher instanceof RegExp) ? nameMatcher : null;
    this._nameMatcherFunction = (typeof nameMatcher === "function") ? nameMatcher : null;
}

DirectoryLoader.prototype._directoryIterator = function(itemProcessor, srcPath, recursive, basePath, depth) {

    var self = this;

    return new Promise(function(resolve, reject) {

        fs.readdir(srcPath, function(err, files) {

            if(err) {
                return reject(err);
            }

            if(!files || !files.length) {
                return resolve();
            }

            async.forEach(files, function(name, done) {

                var itemPath = path.join(srcPath, name);

                fs.stat(itemPath, function (err, stats) {
                    if(err) {
                        return done(err);
                    }

                    if(stats.isDirectory()) {
                        if(recursive) {
                            self._directoryIterator(itemProcessor, itemPath, true, basePath, depth + 1).then(function() {
                                done();
                            }).catch(function(err) {
                                done(err);
                            });
                        } else {
                            done();
                        }
                    } else {
                        if(self._nameMatcherRegExp && name.match(self._nameMatcherRegExp)) {
                            itemProcessor(itemPath, name, basePath, depth).then(function() {
                                done();
                            }).catch(function(err) {
                                done(err);
                            });
                        } else if(self._nameMatcherFunction && self._nameMatcherFunction(name, srcPath)) {
                            itemProcessor(itemPath, name, basePath, depth).then(function() {
                                done();
                            }).catch(function(err) {
                                done(err);
                            });
                        } else {
                            done();
                        }
                    }
                });

            }, function(err) {

                if(err) {
                    return reject(err);
                }

                resolve();
            });
        })
    });
};


DirectoryLoader.prototype.run = function(itemProcessor) {

    return this._directoryIterator(itemProcessor, this._srcPath, this._recursive, this._srcPath, 0);
};

module.exports = DirectoryLoader;