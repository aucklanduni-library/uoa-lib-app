var PackageConfig = require("./packager/package-config"),
    App = require("./application").App;


function AppConfig(appName) {

    this._appName = appName || "default";
    this._safeAppName = this._appName.toLowerCase().replace("_", "-").replace(/[^A-Za-z0-9\-]/gi, "");

    this._config = null;
    this._baseURLPathLookup = null;

    this._debug = false;
    this._verbose = false;
    this._port = null;

    this._enableSocketIO = false;
    this._socketIOPath = null;
    this._jsonBodyParserOptions = {};

    this._cdnResources = [];

    this._dataProviderPaths = [];
    this._routesPaths = [];

    this._middlewares = [];

    this._modules = [];

    // Default "package".
    this._defaultPackage = new PackageConfig(this._appName);
    this._defaultPackage.paths("/resources/" + this._safeAppName + "/js/client.js",
        "/resources/" + this._safeAppName + "/css/client.css",
        "/resources/" + this._safeAppName);
    this._defaultPackage.insertRequireJSConfig(this._safeAppName + "/init");
    this._packageConfigs = [this._defaultPackage];

    this._rendererTypes = [];
    this._defaultRendererType = null;
    this._rendererOptions = {};

    // Templates
    this._errorTemplate = null;
    this._accessRestrictedTemplate = null;
    this._notFoundTemplate = null;
}

AppConfig.prototype.config = function(config) {
    this._config = config;
    return this;
};

AppConfig.prototype.baseURLLookup = function(lookup) {
    this._baseURLPathLookup = lookup;
    return this;
};

AppConfig.prototype.dataProvider = function(path, recursive) {
    this._dataProviderPaths.push({path:path, recursive:recursive});
    return this;
};

AppConfig.prototype.routes = function(path, recursive) {
    this._routesPaths.push({path:path, recursive:recursive});
    return this;
};

AppConfig.prototype.debug = function(debug) {
    this._debug = !!debug;
    return this;
};

AppConfig.prototype.verbose = function(verbose) {
    this._verbose = !!verbose;
    return this;
};

AppConfig.prototype.listen = function(port) {
    this._port = port;
    return this;
};

AppConfig.prototype.socketIO = function(path) {
    this._enableSocketIO = true;
    if(path) {
        this._socketIOPath = path;
    }
    return this;
};

AppConfig.prototype.middleware = function(middleware) {
    this._middlewares.push(middleware);
    return this;
};

AppConfig.prototype.jsonBodyParser = function(options) {
    this._jsonBodyParserOptions = options;
    return this;
};



// CDN Resources
// ---

AppConfig.prototype.cdn = function() {
    var resources = this._cdnResources;
    if(arguments.length) {
        for(var i = 0; i < arguments.length; i++) {
            var a = arguments[i];
            if(a) {
                if(a instanceof Array) {
                    a.forEach(function(x) {
                        if(typeof(x) === "string") {
                            resources.push(x);
                        }
                    });
                } else if(typeof(a) === "string") {
                    resources.push(a);
                }
            }
        }
    }
    return this;
};


// Module
// ---

AppConfig.prototype.register = function(module) {
    this._modules.push(module);
    return this;
};


// Package
// ---

AppConfig.prototype.defaultPackage = function(jsPath, cssPath, staticPath) {

    this._defaultPackage.paths(jsPath, cssPath, staticPath);
    return this;
};

AppConfig.prototype.customPackage = function(packageConfig) {

    // add a custom package to the list of configured packages
    this._packageConfigs.push(packageConfig);
    return this;
};

AppConfig.prototype.javascript = function(path, prefix, recursive) {

    // add javascript to default package
    this._defaultPackage.javascript.apply(this._defaultPackage, arguments);
    return this;
};

AppConfig.prototype.rawJavascript = function(content, prefix, basename) {

    // add javascript to default package
    this._defaultPackage.rawJavascript.apply(this._defaultPackage, arguments);
    return this;
};

AppConfig.prototype.css = function(path, prefix, recursive) {

    // add css to default package
    this._defaultPackage.css.apply(this._defaultPackage, arguments);
    return this;
};

AppConfig.prototype.rawCSS = function(content, prefix, basename) {

    // add javascript to default package
    this._defaultPackage.rawCSS.apply(this._defaultPackage, arguments);
    return this;
};

AppConfig.prototype.static = function(path, prefix, recursive, nameRegex) {

    // add static resources to the default package
    this._defaultPackage.static.apply(this._defaultPackage, arguments);
    return this;
};

AppConfig.prototype.package = function(packageDesc) {

    // Add a package from a registered module to the default package.
    this._defaultPackage.package(packageDesc);
    return this;
};

AppConfig.prototype.templates = function(templateID, templatePacker, prefix, basename, registerWithRenderer, rendererType) {

    if(arguments.length === 3) {
        basename = prefix;
        prefix = null;
    }

    // Add a template packer to the default package.
    this._defaultPackage.templates(templateID, templatePacker, prefix, basename, registerWithRenderer, rendererType);
    return this;
};

AppConfig.prototype.bundle = function() {
    this._defaultPackage.bundle.apply(this._defaultPackage, arguments);
    return this;
};

// Renderers
// ---

AppConfig.prototype.renderer = function(type, defaultRenderer) {

    this._rendererTypes.push(type);
    if(defaultRenderer || !this._defaultRendererType) {
        this._defaultRendererType = type;
    }
    return this;
};

AppConfig.prototype.rendererTemplates = function(type, templatePath) {

    if(arguments.length === 1) {
        templatePath = type;
        type = this._defaultRendererType || Renderers.Handlebars;
    }

    var rendererOptions = this._rendererOptions[type];
    if(!rendererOptions) {
        rendererOptions = {};
        this._rendererOptions[type] = rendererOptions;
    }

    if(!rendererOptions.templatePaths) {
        rendererOptions.templatePaths = [];
    }

    if(templatePath instanceof Array) {
        templatePath.forEach(function(p) {
            rendererOptions.templatePaths.push(templatePath);
        });
    } else if(typeof templatePath === 'string') {
        rendererOptions.templatePaths.push(templatePath);
    }
    return this;
};

AppConfig.prototype.rendererHelper = function(type, helperPath) {

    if(arguments.length === 1) {
        helperPath = type;
        type = this._defaultRendererType || Renderers.Handlebars;
    }

    var rendererOptions = this._rendererOptions[type];
    if(!rendererOptions) {
        rendererOptions = {};
        this._rendererOptions[type] = rendererOptions;
    }

    if(!rendererOptions.helperPaths) {
        rendererOptions.helperPaths = [];
    }

    if(helperPath instanceof Array) {
        helperPath.forEach(function(p) {
            rendererOptions.helperPaths.push(helperPath);
        });
    } else if(typeof helperPath === 'string') {
        rendererOptions.helperPaths.push(helperPath);
    }
    return this;
};

AppConfig.prototype.rendererContext = function(type, context) {

    if(arguments.length === 1) {
        context = type;
        type = this._defaultRendererType || Renderers.Handlebars;
    }

    var rendererOptions = this._rendererOptions[type];
    if(!rendererOptions) {
        rendererOptions = {};
        this._rendererOptions[type] = rendererOptions;
    }

    rendererOptions.context = context;
    return this;
};


// Extension templates
// ---

AppConfig.prototype.errorTemplate = function(template) {
    this._errorTemplate = template;
    return this;
};

AppConfig.prototype.accessRestrictedTemplate = function(template) {
    this._accessRestrictedTemplate = template;
    return this;
};

AppConfig.prototype.notFoundTemplate = function(template) {
    this._notFoundTemplate = template;
    return this;
};


// Run the config
// ---
AppConfig.prototype.run = function(processArguments) {

    // Generate a new "App" from the config and start the server running !!
    var app = new App(this);
    return app.run(this._config, processArguments);
};


module.exports = AppConfig;