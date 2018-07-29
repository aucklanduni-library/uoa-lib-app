var handlebars = require("handlebars"),
    Promise = require("bluebird"),
    DirectoryLoader = require("./../directory-loader"),
    async = require("async"),
    path = require("path"),
    fs = require("fs");


function HandlebarsRenderer() {

    this._handlebars = handlebars;
    this._context = null;
    this._noGlobalPartialSupport = true;
    this._templatePaths = [];
    this._referencedTemplates = {};
}

HandlebarsRenderer.prototype.handlebars = function() {
    return this._handlebars;
};

HandlebarsRenderer.prototype.configure = function(templatePaths, partialPaths, helperPaths, context, options) {

    if(templatePaths && typeof templatePaths === 'string') {
        templatePaths = [templatePaths];
    }

    if(partialPaths && typeof partialPaths === 'string') {
        partialPaths = [partialPaths];
    }

    if(helperPaths && typeof helperPaths === 'string') {
        helperPaths = [helperPaths];
    }

    this._context = context;
    this._noGlobalPartialSupport = options && options.hasOwnProperty(exports.RendererOptions.DisableGlobalPartialDirectory)
                                        && !!options[exports.RendererOptions.DisableGlobalPartialDirectory];

    this._templatePaths = templatePaths ? templatePaths.slice() : [];

    var self = this;

    return new Promise(function(resolve, reject) {

        if(!helperPaths || helperPaths.length === 0) {
            return resolve();
        }

        async.forEachSeries(helperPaths, function(p, done) {

            var loader = new DirectoryLoader(p, true, /\.js$/i);

            loader.run(function(itemPath) {
                if(itemPath) {
                    try {
                        // Load the handlebar helper.
                        require(itemPath);
                    } catch(e) {
                        return Promise.reject(e);
                    }
                }
                return Promise.resolve();
            }).then(function() {
                return done();
            }).catch(function(err) {
                return done(err);
            });

        }, function(err) {
            if(err) {
                return reject(err);
            }
            return resolve();
        });

    }).then(function() {

        if(!partialPaths || !partialPaths.length) {
            return Promise.resolve();
        }

        // Load up any partials at the registered paths.
        return new Promise(function(resolve, reject) {

            async.forEachSeries(partialPaths, function(p, done) {

                var isTemplatePath = self._templatePaths.indexOf(p) !== -1;
                var opts = {};

                self.registerPartialsFromDirectory(p, opts, true, isTemplatePath).then(function() {
                    return done();
                }).catch(function(err) {
                    return done(err);
                });

            }, function(err) {

                if(err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    });
};


HandlebarsRenderer.prototype.resolveAndPrecompile = function(template, options) {

    template = this.resolveReferencedVariables(template);
    return this._handlebars.precompile(template, options);
};


// eval use here is required
function _evalPrecompiledTemplate(s) {
    return eval("(function(){return " + s + "}());");
}

HandlebarsRenderer.prototype.templateFromPrecompile = function(precompile) {

    return this._handlebars.template(_evalPrecompiledTemplate(precompile));
};


HandlebarsRenderer.prototype.loadTemplate = function(name) {

    // Lookup a referenced template - these are registered via registerReferencedTemplate
    // (normally done via a template packer).
    if(name.match(/^ref:/i)) {
        var reference = name.replace(/^ref:/i, "").toLowerCase();
        return this._referencedTemplates[reference] || null;
    }

    if(!this._templatePaths || !this._templatePaths.length) {
        return null;
    }

    if(!name.match(/\.hbs$/i)) {
        name = name + ".hbs";
    }

    var templateString = fs.existsSync(name) ? fs.readFileSync(name, "utf8") : null;
    if(templateString) {
        templateString = this.resolveReferencedVariables(templateString);
        return this._handlebars.compile(templateString);
    }

    for(var i = 0; i < this._templatePaths.length; i++) {

        var templatePath = path.join(this._templatePaths[i], name);

        // need to see if the template is available
        templateString = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, "utf8") : null;

        if(templateString) {
            templateString = this.resolveReferencedVariables(templateString);
            return this._handlebars.compile(templateString);
        }
    }

    return null;
};


HandlebarsRenderer.prototype.registerReferencedTemplate = function(reference, template) {

    if(reference && template) {
        this._referencedTemplates[reference.toLowerCase()] = template;
    }
};


HandlebarsRenderer.prototype.extendRequest = function(request) {

    // Do nothing.
};


HandlebarsRenderer.prototype.extendResponse = function(response) {

    var baseResponseRender = response.render;
    var self = this;

    response.render = function() {

        var arglen = arguments.length;
        if((arglen === 1 || arglen === 2) && typeof(arguments[0]) === 'function') {

            var template = arguments[0];
            var data = arglen > 1 ? arguments[1] : response.data;

            return self.render(template, data, response.timer, response);
        }

        var r;
        r = baseResponseRender.apply(response, arguments);
        return r;
    };
};


HandlebarsRenderer.prototype.render = function(template, renderData, eventTimer, response /*optional*/) {

    var r = "";
    var p = new Promise(function(resolve, reject) {

        try {
            if(eventTimer) {
                eventTimer.startTimer("render");
            }

            r = template(renderData);

            if(eventTimer) {
                eventTimer.stopTimer("render");
            }
        } catch(e) {
            if(eventTimer) {
                eventTimer.stopTimer("render");
            }
            r = null;
            reject(e);
            return;
        }

        resolve(r);
    });


    if(response) {
        p = p.finally(function() {
            if(r !== null && p._thenAdded !== true && !response.headersSent) {
                response.send(r);
            }
        });

        var originalThen = p.then;
        p.then = function() {
            if(arguments.length > 0 && arguments[0]) {
                p._thenAdded = true;
            }
            return originalThen.apply(p, arguments);
        };
    }

    return p;
};


var resolvePath = function(resolverContext, path) {
    var parts = path.split(".");
    var cntxt = resolverContext;
    if(!cntxt) {
        return undefined;
    }

    for(var i = 0, ii=parts.length; i < ii; i++) {
        if(cntxt.hasOwnProperty(parts[i])) {
            cntxt = cntxt[parts[i]];
        } else {
            cntxt = undefined;
            break;
        }
    }
    return cntxt;
};


function _resolveReferencedVariables(resolverContext, string) {

    return string.replace(/__[\w\.]+__/gi, function(r) {
        var p = r.replace(/^__/, "").replace(/__$/, "");
        var rr="";
        p = p.split("__.__");
        p.forEach(function(x) {
            if(rr !== null) {
                var v = resolvePath(resolverContext, x);
                if(v) {
                    rr += ((rr.length > 0) ? "." : "") + v.toString();
                } else {
                    rr = null;
                }
            }
        });
        if(!rr || rr.length === 0) {
            console.log("Handlebars Compiler: unable to resolve reference [" + r + "]");
        }
        return ((rr && rr.length > 0) ? rr : r);
    });
}


HandlebarsRenderer.prototype.resolveReferencedVariables = function(string) {
    var resolverContext = this._context;
    return _resolveReferencedVariables(resolverContext, string);
};


// Register the partial with handlebars directly
var registerPartialHelper = function(hbars, directory, filepath, opts, resolverContext) {

    var regex = (typeof opts.match === 'string') ? new RegExp(opts.match) : opts.match || /\.(html|hbs)$/,
        isValidTemplate = regex.test(filepath);

    if (!isValidTemplate) {
        return Promise.resolve(null);
    }

    return new Promise(function(resolve, reject) {
        fs.readFile(filepath, 'utf8', function(err, data) {
            if(err) {
                return reject(err);
            }

            var templateName;

            if(typeof opts.name === 'function') {
                templateName = opts.name(path.basename(filepath), path.relative(directory, filepath), filepath);
            } else if(typeof opts.name === 'string') {
                templateName = opts.name;
            } else {
                var ext = path.extname(filepath);
                templateName = ((directory !== null) ? path.relative(directory, filepath) : path.basename(filepath)).slice(0, -(ext.length)).replace(/[ -]/g, '_');
            }

            data = _resolveReferencedVariables(resolverContext, data);

            hbars.registerPartial(templateName, data);
            return resolve({name:templateName, template:data});
        });
    });
};


HandlebarsRenderer.prototype._compilePartials = function() {
    var hbars = this._handlebars;
    var partials = hbars.partials;

    for (var p in partials) {
        if (partials.hasOwnProperty(p) && typeof partials[p] === 'string') {
            var compiled = hbars.compile(partials[p]);
            if(compiled) {
                partials[p] = compiled;
            }
        }
    }
};


// Register a specific path as a partial
HandlebarsRenderer.prototype.registerPartialFromFile = function(filePath, opts) {

    opts = opts || {};
    var hbars = this._handlebars;

    registerPartialHelper(hbars, null, filePath, opts, this._context).then(function(r) {
        if(opts.precompile && r.template && r.name) {
            var compiled = hbars.compile(r.template);
            if(compiled) {
                hbars.partials[r.name] = compiled;
            }
        }
        return r.template;
    });
};


HandlebarsRenderer.prototype.registerPartialsFromDirectory = function(directory, opts, recursive, skipInitialLevel) {

    var loader = new DirectoryLoader(directory, recursive, /\.hbs$/i);
    var hbars = this._handlebars;
    var context = this._context;
    var globalPartialSupport = !this._noGlobalPartialSupport;
    var passedOpts = {};

    return loader.run(function(itemPath, name, basePath, depth) {

        if(depth === 0 && skipInitialLevel) {
            return Promise.resolve();
        }

        passedOpts = {};

        for(var k in opts) {
            if(opts.hasOwnProperty(k)) {
                passedOpts[k] = opts[k];
            }
        }

        if(!passedOpts.name) {
            var p = path.relative(basePath, itemPath);
            var parts = p.split("/");
            var templateName = parts[parts.length - 1].replace(/\.hbs$/, "");
            var templatePrefix;

            parts.splice(-1,1);
            templatePrefix = parts.length ? parts.join("_") + "_" : "";
            templatePrefix = templatePrefix.replace(/[ -]/g, '_');

            if(globalPartialSupport && (templatePrefix.match(/^global_$/i) || templatePrefix.match(/^global_partials_$/i))) {
                templatePrefix = "";
            }

            passedOpts.name = (templatePrefix + templateName).replace(/[ -]/g, '_');
        }

        return registerPartialHelper(hbars, null, itemPath, passedOpts, context).then(function(r) {
            if(opts.precompile && r.template && r.name) {
                var compiled = hbars.compile(r.template);
                if(compiled) {
                    hbars.partials[r.name] = compiled;
                }
            }
            return r.template;
        });
    });
};

HandlebarsRenderer.prototype.registerPartialFromCompiledTemplate = function(partialName, template) {

    if(template && partialName) {
        this._handlebars.partials[partialName] = template;
    }
};

HandlebarsRenderer.prototype.registerHelper = function(name, method) {

    if(name && method) {
        this._handlebars.registerHelper(name, method);
    }
};

HandlebarsRenderer.prototype.safeStringFromHelper = function(string) {

    return new this._handlebars.SafeString(string);
};




exports.Renderer = HandlebarsRenderer;

exports.RendererOptions = {
    DisableGlobalPartialDirectory: 'disable-global-partial'
};

exports.Handlebars = handlebars;

exports.registerHelper = function(name, method) {
    if(name && method) {
        handlebars.registerHelper(name, method);
    }
};