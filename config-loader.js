var path = require("path");

function ConfigLoader(configDirectory, environment) {
    this._directory = configDirectory || path.resolve("./");
    this._environment = environment || process.env.ENVIRONMENT || "dev";
}

ConfigLoader.prototype._tryLoad = function(fileName) {
    var p = path.join(this._directory, fileName);
    try {
        return require(p);
    } catch(e) {
    }
    return null;
};

ConfigLoader.prototype.load = function(skipSecretLoading) {

    var env = this._environment;
    var config = this._tryLoad("config.local");

    if(!config) {
        config = this._tryLoad("config." + env);
        if(!config) {
            console.error("[**] Error: unable to load config file for environment {" + env + "}");
            process.exit(1);
        }
        console.log("[**] Loading config file for environment {" + env + "}");
    } else {
        console.log("[**] Loading config file for environment {local}");
    }

    var r = {};

    _mergeValuesIntoConfig(config, r);

    if(skipSecretLoading !== true) {
        var cs = this._tryLoad("config.secret");
        if(cs) {
            console.log("[**] Loaded secrets config file.");
            _mergeValuesIntoConfig(cs, r);
        }
    }

    return r;
};

module.exports = ConfigLoader;



function _mergeValuesIntoConfig(source, dest) {
    for(var k in source) {
        if(source.hasOwnProperty(k)) {

            if(!dest.hasOwnProperty(k)) {
                dest[k] = source[k];
                continue;
            }

            if(typeof(source[k]) === 'object' && typeof(dest[k]) === 'object') {
                _mergeValuesIntoConfig(source[k], dest[k]);
                continue;
            }

            dest[k] = source[k];
        }
    }
}