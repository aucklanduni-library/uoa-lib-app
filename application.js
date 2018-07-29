// AMD define NodeJS support (primary use is for handlebar helpers)
require('./amd-interceptor');

var express = require('express'),
    Promise = require("bluebird"),
    bodyParser = require('body-parser'),
    socketio = require('socket.io'),
    async = require("async"),
    http = require("http");

var CDNProvider = require("@uoalib/uoa-lib-cdn");

var DataProviderLoader = require("./data-provider-loader"),
    RoutesLoader = require("./route-loader"),
    EventTimer = require("./event-timer").EventTimer,
    CORSMiddleware = require("./cors-middleware"),
    Module = require("./module"),
    WebPacker = require("./webpacker"),
    Extensions = require("./extension"),
    Metrics = require("./metrics").Metric,
    AccessLogger = require("./access-logger"),
    Logger = require("./logger");


var HandlebarsRenderer = require("./handlebars/renderer").Renderer;

var BaseURLPathReplacementString = "$BASEURL$";


// Renderer
var Renderers = {
    Handlebars: "handlebars"
};
exports.Renderers = Renderers;


function App(appConfig) {

    this._appConfig = appConfig;

    this._debug = false;
    this._verbose = false;
    this._port = appConfig._port || 8082;

    this._dataProviders = {};
    this._dataProviderLoader = new DataProviderLoader();
    this._routesLoader = new RoutesLoader();

    this._middlewares = appConfig._middlewares ? appConfig._middlewares.slice() : [];

    this._webPacker = new WebPacker();
    this._handlebarsRenderer = new HandlebarsRenderer();
    this._defaultRendererType = (appConfig && appConfig._defaultRendererType) ? appConfig._defaultRendererType : Renderers.Handlebars;

    this._packages = null;
    this._packageLookup = null;

    this._modulesLookup = null;
    this._modulesOrdered = null;

    this._cdnResources = appConfig._cdnResources ? appConfig._cdnResources.slice() : [];

    this._notFoundExtension = new Extensions.NotFoundExtension();
    this._errorExtension = new Extensions.ErrorExtension();
    this._accessRestrictedExtension = new Extensions.AccessRestrictedExtension();

    // Setup the data provider and handlers loaders.
    var self = this;

    if(appConfig._dataProviderPaths && appConfig._dataProviderPaths.length) {
        appConfig._dataProviderPaths.forEach(function(p) {
            self._dataProviderLoader.addPath(p.path, p.recursive);
        });
    }

    if(appConfig._routesPaths && appConfig._routesPaths.length) {
        appConfig._routesPaths.forEach(function(p) {
            self._routesLoader.addPath(p.path, p.recursive);
        });
    }
}

exports.App = App;


// ----
// Named Packages
// ----

App.prototype.namedPackage = function(name) {
    return this._packageLookup ? this._packageLookup[name] : null;
};

App.prototype.requireNamedPackage = function(name) {
    var p = this.namedPackage(name);
    if(p) {
        return p;
    }

    console.error("[LibApp/Packages] unable to find required named package {" + name + "}");
    process.exit(1);
};



// ----
// Data Providers
// ----

App.prototype.registerDataProvider = function(key, value) {
    if(!this._dataProviders) {
        this._dataProviders = {};
    }
    this._dataProviders[key] = value;
};

App.prototype.getDataProvider = function(key) {
    if(this._dataProviders && this._dataProviders.hasOwnProperty(key)) {
        return this._dataProviders[key];
    }
    return null;
};

App.prototype.requireDataProvider = function(key) {
    if(this._dataProviders && this._dataProviders.hasOwnProperty(key)) {
        return this._dataProviders[key];
    }

    console.error("[LibApp/DataProviders] unable to find required data provider {" + key + "}");
    process.exit(1);
};


// ----
// Templates
// ----

App.prototype.loadTemplate = function(type, name) {

    if(arguments.length === 1) {
        name = type;
        type = this._defaultRendererType;
    }

    if(type === Renderers.Handlebars) {
        return this._handlebarsRenderer.loadTemplate(name);
    }
};

App.prototype.requireTemplate = function(type, name) {

    var t = this.loadTemplate.apply(this, arguments);
    if(!t) {
        console.error("[LibApp/Templates] unable to find required template {" + (name || type) + "}");
        process.exit(1);
    }

    return t;
};


// ----
// Renderers
// ----

App.prototype.renderer = function(type) {

    if(type === Renderers.Handlebars) {
        return this._handlebarsRenderer;
    }
    return null;
};

App.prototype.handlebarsRenderer = function() {
    return this._handlebarsRenderer;
};


// ----
// Setup methods
// ----

App.prototype.run = function(config, processArguments) {

    var argv = processArguments ? require('minimist')(processArguments.slice(2)) : {};
    var self = this;

    if((argv.e && typeof(argv.e) === "string") || (argv.environment && typeof(argv.environment) === "string") || (config.hasOwnProperty("Environment") && typeof(config.Environment) === "string")) {
        this.environment = (argv.e && typeof(argv.e) === "string") ? argv.e : ((argv.environment && typeof(argv.environment) === "string") ? argv.environment : config.Environment);
    } else {
        this.environment = null;
    }

    if(argv.d || argv.debug || (config.hasOwnProperty("Debug") && !!config.Debug)) {
        this.isDebug = this._debug = true;
    } else {
        this.isDebug = false;
    }

    this._verbose = (argv.v || argv.verbose || (config.hasOwnProperty("Verbose") && !!config.Verbose));
    this._debug = (argv.d || argv.debug || (config.hasOwnProperty("Debug") && !!config.Debug)) ? true : (this.environment && this.environment.toLowerCase() === "debug");

    if(config.hasOwnProperty("GoogleAnalyticsCode") && config.GoogleAnalyticsCode && typeof(config.GoogleAnalyticsCode) === "string") {
        this._googleAnalyticsCode = config.GoogleAnalyticsCode;
    }

    this._baseURLPathLookup = this._appConfig._baseURLPathLookup;
    if(!this._baseURLPathLookup && config.hasOwnProperty("BaseURLPath") && typeof config.BaseURLPath === 'object') {
        this._baseURLPathLookup = config.BaseURLPath;
    }

    // Now we can start configuring the components of the application.
    var metricsConfig = config.Metrics || null;
    var loggingConfig = config.Logging || null;
    var accessConfig = config.Access || null;

    return new Promise(function(resolve, reject) {

        if(!metricsConfig) {
            self._metrics = null;
            return resolve();
        }

        self._metrics = new Metrics(metricsConfig, function(msg) {
            if(self.log) {
                self.log.info(msg);
            } else {
                console.info(msg);
            }
        }, function(err) {
            if(self.log) {
                self.log.error(err);
            } else {
                console.error(err);
            }
        });
        resolve();

    }).then(function() {

        self.metrics = self._metrics;
        self.log = self.logger = self._logger = new Logger(loggingConfig, self._debug, self._verbose);
        self.access = self._access = new AccessLogger(accessConfig, self._metrics, self._debug, self._verbose);

        self.cdn = new CDNProvider(config, self.logger);

        if(self.cdn && self._cdnResources && self._cdnResources.length) {
            self._baseCDNConfig = self.cdn.generateBundleDetails(self._cdnResources, self.environment, BaseURLPathReplacementString);
        } else {
            self._baseCDNConfig = null;
        }

        if(config.CORSAllowedOrigins) {
            self.cors = new CORSMiddleware(config.CORSAllowedOrigins, config.CORSDefaultOrigin, config.CORSHeaders);
        } else {
            self.cors = null;
        }

    }).then(function() {

        return self._loadModules();

    }).then(function() {

        return self._setupRenderers();

    }).then(function() {

        return self._configurePackages();

    }).then(function() {

        return self._startServer(argv, config);

    }).then(function() {

        return self._dataProviderLoader.load(self, config, self.log);

    }).then(function() {

        return self._routesLoader.load(self, config, self.log);

    }).then(function() {

        return self._registerPackages(self.app);

    }).then(function() {

        return self._setupExtensions(self.app);

    }).then(function() {

        self._runServer();

    }).then(function() {

        return self;

    }).catch(function(e) {

        var errMsg = "Unable to start application due to: " + e.toString();
        if(self.log) {
            self.log.error(errMsg);
        } else {
            console.error(errMsg);
        }
    });
};


App.prototype._loadModules = function() {

    var appConfig = this._appConfig;
    var modules = appConfig._modules;
    var moduleRootURL = "";
    var log = this.log;
    var self = this;

    if(!modules || !modules.length) {
        return Promise.resolve();
    }

    return new Promise(function(resolve, reject) {

        var finalLoadedModules = {};
        var finalLoadedModulesOrdered = [];

        async.forEachSeries(modules, function(module, done) {

            var m = new Module(module);
            var name = m.name();

            if(finalLoadedModules.hasOwnProperty(name)) {
                return done();
            }

            m.load(moduleRootURL, self.log).then(function() {
                finalLoadedModules[name] = m;
                finalLoadedModulesOrdered.push(m);
                log.verbose("Successfully loaded module [" + name + "].");
                done();
            }).catch(function(err) {
                log.error("Unable to load module [" + name + "] due to: " + err.toString());
                done(err);
            });

        }, function(err) {

            if(err) {
                return reject(err);
            }

            self._modulesLookup = finalLoadedModules;
            self._modulesOrdered = finalLoadedModulesOrdered;
            resolve();
        });
    });
};


App.prototype._configurePackages = function() {

    var registeredPackages = [];
    var packageLookup = {};
    var appConfig = this._appConfig;
    var log = this.log;
    var self = this;

    var renderers = {};
    renderers["default"] = self._handlebarsRenderer;
    renderers[Renderers.Handlebars] = self._handlebarsRenderer;

    var allPackageConfigs = appConfig._packageConfigs.slice();

    var packageBundleReferences = {};
    var hasPackageBundleReferences = false;

    var packageJSPathReferences = {};
    var hasJSPathReferences = false;

    allPackageConfigs.forEach(function(pckgeConfig) {
        var ref = pckgeConfig.reference();

        if(ref) {
            ref = ref.toLowerCase();

            var bundleRefs = pckgeConfig.allBundleReferences(self._modulesOrdered);
            if(bundleRefs) {
                packageBundleReferences[ref] = bundleRefs;
                hasPackageBundleReferences = true;
            }

            if(pckgeConfig.containsJS()) {
                var jsPath = pckgeConfig.jsPath("$BASEURL$");
                if(jsPath) {
                    packageJSPathReferences[ref] = jsPath;
                    hasJSPathReferences = true;
                }
            }
        }
    });

    self._packageBundleReferences = hasPackageBundleReferences ? packageBundleReferences : null;
    self._packageJSPaths = hasJSPathReferences ? packageJSPathReferences : null;

    var requireJSConfig = Object.assign({}, self._baseCDNConfig ? (self._baseCDNConfig.requireConfig || {}) : {});
    var k;

    if(hasPackageBundleReferences) {
        if(!requireJSConfig.bundles) {
            requireJSConfig.bundles = {};
        }

        for(k in packageBundleReferences) {
            if(packageBundleReferences.hasOwnProperty(k)) {
                requireJSConfig.bundles[k] = packageBundleReferences[k];
            }
        }
    }

    if(hasJSPathReferences) {
        if(!requireJSConfig.paths) {
            requireJSConfig.paths = {};
        }

        for(k in packageJSPathReferences) {
            if(packageJSPathReferences.hasOwnProperty(k)) {
                requireJSConfig.paths[k] = packageJSPathReferences[k].replace(/\.js/gi, ""); /// fix me, will have a ?=dfdfdfdf part on the end
            }
        }
    }

    // For the default package (or marked packages), we may want to insert the setup JavaScript that configures RequireJS
    // with references to all of the packages and also states where the bundles are located.
    allPackageConfigs.forEach(function(pckgeConfig) {

        if(!pckgeConfig.wantsRequireJSConfig()) {
            return;
        }

        var startingReferences = pckgeConfig.requireJSStartingPoints();
        var setupJS = "(function(require){\n\n";

        setupJS += "    var config = " + JSON.stringify(requireJSConfig, null, 4).replace(/^/mg, "    ").replace(/^\s+/, "") + ";" + "\n";

        setupJS += "    var baseURLPath = '';\n";
        setupJS += "    try{ var b = JSON.parse(document.getElementById('data').innerHTML); if(b && b.baseURLPath) { baseURLPath = '' + b.baseURLPath; } } catch(e) {}\n";
        setupJS += "    if(config && config.paths) {\n";
        setupJS += "        for(var k in config.paths) {\n";
        setupJS += "            if(!(config.paths.hasOwnProperty(k))) { continue; }\n";
        setupJS += "            var v = config.paths[k];\n";
        setupJS += "            if(typeof(v) === 'string') { config.paths[k] = v.replace('" + BaseURLPathReplacementString + "', baseURLPath); }\n";
        setupJS += "            if(v instanceof Array) {\n";
        setupJS += "                for(var i = 0; i < v.length; i++) {\n";
        setupJS += "                    v[i] = v[i].replace('" + BaseURLPathReplacementString + "', baseURLPath);\n";
        setupJS += "                }\n";
        setupJS += "            }\n";
        setupJS += "        }\n";
        setupJS += "    }\n\n";
        setupJS += "    require.config(config);\n\n";

        if(startingReferences) {
            if(typeof(startingReferences) === "string") {
                startingReferences = [startingReferences];
            }
            setupJS += "\n\n    " + "require(" + JSON.stringify(startingReferences) + ", function() {});";
        }

        setupJS += "\n})(require);";

        pckgeConfig.rawJavascript(setupJS, null, "setup.js");
    });


    return new Promise(function(resolve, reject) {

        async.forEachSeries(allPackageConfigs, function(pckgeConfig, done) {

            pckgeConfig.createPackage(self._webPacker, renderers, self._modulesOrdered, self._logger, self._debug).then(function(finalPackage) {
                if(finalPackage) {
                    registeredPackages.push(finalPackage);

                    var ref = pckgeConfig.reference();
                    if(ref) {
                        packageLookup[ref.toLowerCase()] = finalPackage;
                    }
                }
                done();
            }).catch(function(err) {
                log.error("Unable to create package due to: " + err.toString());
                done(err);
            });

        }, function(err) {

            if(err) {
                return reject(err);
            }

            self._packages = registeredPackages;
            self._packageLookup = packageLookup;
            return resolve();
        });
    });
};


App.prototype._startServer = function(procArgs, config) {

    var app = express(),
        server = http.Server(app);

    this.app = app;
    this.server = server;
    this.express = express;

    if(this._appConfig._enableSocketIO) {
        var sio = {};
        if(this._appConfig._socketIOPath) {
            sio.path = this._appConfig._socketIOPath;
        }
        this.socketIO = socketio(server, sio);
    }

    app.disable('x-powered-by');
    this._applyGlobalMiddleware(app);

    var port;
    port = (procArgs.p || procArgs.port);
    if(port) {
        port = parseInt(port.toString());
        if(isNaN(port)) {
            port = undefined;
        }
    }
    if(!port && config.Port) {
        port = parseInt(config.Port);
        if(isNaN(port)) {
            port = undefined;
        }
    }
    this._port = port || (this._port ? this._port : 8082);
    return Promise.resolve();
};


App.prototype._runServer = function() {

    var self = this;

    return new Promise(function(resolve, reject) {
        self.server.listen(self._port, function(err) {

            if(err) {
                return reject(err);
            }
            self.log.verbose("Listening on port " + self._port);
            resolve();
        });
    });
};


App.prototype._registerPackages = function(app) {

    var packages = this._packages;
    var log = this.log;

    if(!packages || !packages.length) {
        return Promise.resolve();
    }

    return new Promise(function(resolve, reject) {

        async.forEachSeries(packages, function(preparedPackage, done) {

            preparedPackage.compress().then(function() {
                return preparedPackage.registerRoutes(app);
            }).then(function() {
                done();
            }).catch(function(err) {
                log.error("Unable to register package due to: " + err.toString());
                done(err);
            });

        }, function(err) {

            if(err) {
                return reject(err);
            }

            log.verbose("Successfully configured and registered all packages.");
            return resolve();
        });
    });
};


App.prototype._setupRenderers = function() {

    var self = this;
    var appConfig = this._appConfig;


    // Register default package helper for handlebars renderer.
    if(this._handlebarsRenderer) {
        var hbarRenderer = this._handlebarsRenderer;
        hbarRenderer.registerHelper("uoa-lib-package", function(baseURLPath, packageName) {

            if(!packageName) {
                self.log.error("'uoa-lib-package' requires a named package to be provided.");
                return "";
            }
            packageName = packageName.toLowerCase();

            if(!baseURLPath) {
                baseURLPath = "";
            }

            var pckge = (self._packageLookup && self._packageLookup.hasOwnProperty(packageName)) ? self._packageLookup[packageName] : null;
            return hbarRenderer.safeStringFromHelper(pckge ? pckge.links(baseURLPath) : "");
        });

        hbarRenderer.registerHelper("uoa-lib-package-css", function(baseURLPath, packageName) {

            if(!packageName) {
                self.log.error("'uoa-lib-package-css' requires a named package to be provided.");
                return "";
            }
            packageName = packageName.toLowerCase();

            if(!baseURLPath) {
                baseURLPath = "";
            }

            var pckge = (self._packageLookup && self._packageLookup.hasOwnProperty(packageName)) ? self._packageLookup[packageName] : null;
            return hbarRenderer.safeStringFromHelper(pckge ? pckge.cssLinks(baseURLPath) : "");
        });

        hbarRenderer.registerHelper("uoa-lib-package-js", function(baseURLPath, packageName) {

            if(!packageName) {
                self.log.error("'uoa-lib-package-js' requires a named package to be provided.");
                return "";
            }
            packageName = packageName.toLowerCase();

            if(!baseURLPath) {
                baseURLPath = "";
            }

            var pckge = (self._packageLookup && self._packageLookup.hasOwnProperty(packageName)) ? self._packageLookup[packageName] : null;
            return hbarRenderer.safeStringFromHelper(pckge ? pckge.jsLinks(baseURLPath) : "");
        });

        hbarRenderer.registerHelper("uoa-lib-package-static-resource", function(baseURLPath, packageName) {

            if(!packageName) {
                self.log.error("'uoa-lib-package-static-resource' requires a named package to be provided.");
                return "";
            }
            packageName = packageName.toLowerCase();

            if(!baseURLPath) {
                baseURLPath = "";
            }

            var pckge = (self._packageLookup && self._packageLookup.hasOwnProperty(packageName)) ? self._packageLookup[packageName] : null;
            var linkArgs = Array.prototype.slice.call(arguments);

            linkArgs.shift();
            linkArgs.shift();
            linkArgs.pop();
            linkArgs.unshift(baseURLPath);

            return hbarRenderer.safeStringFromHelper(pckge ? pckge.staticLink.apply(pckge, linkArgs) : "");
        });


        // CDN Helper
        hbarRenderer.registerHelper("uoa-lib-cdn-links", function(baseURLPath, prefix) {

            if(arguments.length > 2) {
                prefix = prefix || "    ";
            } else {
                prefix = "    ";
            }

            if(!baseURLPath) {
                baseURLPath = "";
            }

            var c = {baseURLPath: "" + baseURLPath};
            var inc = "<script id='baseConfig' type='application/json'>" + JSON.stringify(c) + "</script>\n";

            if(self._baseCDNConfig) {

                var jsFiles = self._baseCDNConfig.jsFiles;
                var cssFiles = self._baseCDNConfig.cssFiles;

                if(jsFiles && jsFiles.length) {
                    jsFiles.forEach(function(file) {
                        if(file) {
                            file = file.replace(BaseURLPathReplacementString, baseURLPath);
                            inc += prefix + '<script src="' + file + '"></script>' + "\n";
                        }
                    });
                }

                if(cssFiles && cssFiles.length) {
                    cssFiles.forEach(function(file) {
                        if(file) {
                            file = file.replace(BaseURLPathReplacementString, baseURLPath);
                            inc += prefix + '<link rel="stylesheet" href="' + file + '" />'+ "\n";
                        }
                    });
                }
            }

            return hbarRenderer.safeStringFromHelper(inc);
        });
    }

    return new Promise(function(resolve, reject) {

        if(!appConfig._defaultRendererType) {
            return resolve();
        }

        if(appConfig._defaultRendererType === Renderers.Handlebars) {

            var handlebarsConfig = appConfig._rendererOptions[Renderers.Handlebars];
            var templates = handlebarsConfig.templatePaths || [];
            var helpers = handlebarsConfig.helperPaths || [];
            var context = handlebarsConfig.context || {};

            self._handlebarsRenderer.configure(templates, templates, helpers, context).then(function() {
                if(self.log) {
                    self.log.verbose("Successfully configured renderer [" + Renderers.Handlebars + "]");
                }
                return resolve();
            }).catch(function(err) {
                return reject(err);
            });
        } else {

            resolve();
        }
    });
};


App.prototype._applyGlobalMiddleware = function(app) {

    var self = this;

    app.use(function(request, response, next) {

        var timer = new EventTimer();

        request.timer = response.timer = timer;

        request.accessEvent = function(section, extraData, extraMetricTags) {
            var accessEvent = self._access.createAccessEvent(request, response, timer, section, extraData, extraMetricTags);
            request._accessEvent = response._accessEvent = accessEvent;
            request.accessEvent = function() {
                return accessEvent;
            };
            return accessEvent;
        };

        response.data = self._initRenderData(request);
        request.baseURLPath = response.baseURLPath = response.data.baseURLPath;

        if(self._handlebarsRenderer) {
            self._handlebarsRenderer.extendRequest(request);
            self._handlebarsRenderer.extendResponse(response);
        }

        // If the response has an associated
        var baseResponseSend = response.send;
        response.send = function() {
            var r;
            r = baseResponseSend.apply(response, arguments);
            if(response._accessEvent) {
                response._accessEvent.trigger();
            }
            return r;
        };

        next();
    });

    if(this._appConfig._jsonBodyParserOptions) {
        app.use(bodyParser.json(this._appConfig._jsonBodyParserOptions));
    }

    if(this._middlewares) {
        this._middlewares.forEach(function(x) {
            app.use(x.bind(self));
        });
    }
};


App.prototype._setupExtensions = function(app) {

    var self = this;
    var template;

    if(this._appConfig._errorTemplate) {
        template = this.requireTemplate(this._appConfig._errorTemplate);
        this._errorExtension.template(template);
    }

    if(this._appConfig._accessRestrictedTemplate) {
        template = this.requireTemplate(this._appConfig._accessRestrictedTemplate);
        this._accessRestrictedExtension.template(template);
    }

    if(this._appConfig._notFoundTemplate) {
        template = this.requireTemplate(this._appConfig._notFoundTemplate);
        this._notFoundExtension.template(template);
    }

    return this._accessRestrictedExtension.setup(app).then(function() {

        return self._errorExtension.setup(app);

    }).then(function() {

        return self._notFoundExtension.setup(app);
    })
};


function _hostForRequest(request) {
    var host;
    host = request.get("x-forwarded-server");
    if(host) {
        host = host.split(",")[0];
    } else {
        host = request.get('host');
    }
    return host;
}

App.prototype.baseURLForHost = function(host) {
    if(!host) {
        return "";
    }
    host = host.toLowerCase();
    if(this._baseURLPathLookup) {
        if(this._baseURLPathLookup.hasOwnProperty(host)) {
            return this._baseURLPathLookup[host];
        }

        if(this._baseURLPathLookup.hasOwnProperty("*")) {
            return this._baseURLPathLookup["*"];
        }
    }

    return "";
};

App.prototype.baseURLForRequest = function(request) {

    var host = _hostForRequest(request);
    if(!host) {
        return "";
    }
    host = host.toLowerCase();

    if(this._baseURLPathLookup) {
        if(this._baseURLPathLookup.hasOwnProperty(host)) {
            return this._baseURLPathLookup[host];
        }

        if(this._baseURLPathLookup.hasOwnProperty("*")) {
            return this._baseURLPathLookup["*"];
        }
    }

    return "";
};


App.prototype._initRenderData = function(request) {

    var data = {};
    if(this._googleAnalyticsCode) {
        data.googleAnalyticsCode = this._googleAnalyticsCode;
    }

    var baseURLPath = this.baseURLForRequest(request);
    data.baseURLPath = baseURLPath ? baseURLPath : "";
    return data;
};