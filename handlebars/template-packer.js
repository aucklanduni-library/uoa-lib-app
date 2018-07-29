var Promise = require("bluebird"),
    DirectoryLoader = require("./../directory-loader"),
    Utilities = require("./../utilities"),
    path = require("path"),
    async = require("async"),
    fs = require("fs");


var LOG_PREFIX = "[HandlebarsTemplatePacker] ";


// Add file options
// ---
var AddFileOptions = {
    RegisterAsPartial: "register-as-partial",
    PartialName: "partial-name"
};
exports.AddFileOptions = AddFileOptions;


// File Processor result keys
// ---
var FileProcessorResultKeys = {
    Reference: "reference",
    RegisterAsPartial: AddFileOptions.RegisterAsPartial,
    PartialName: AddFileOptions.PartialName
};
exports.FileProcessorResultKeys = FileProcessorResultKeys;


// Skip template error
// ---
function SkipHandlebarsTemplateError() {
}
SkipHandlebarsTemplateError.prototype = Object.create(Error.prototype);
exports.SkipHandlebarsTemplateError = SkipHandlebarsTemplateError;



// ---
// Handlebars template packer
// ---

function HandlebarsTemplatePacker(referencePrefix) {

    this._files = [];
    this._referencePrefix = referencePrefix || "";
}
exports.Packer = HandlebarsTemplatePacker;


HandlebarsTemplatePacker.prototype.addFile = function(filePath, reference, options) {

    if(!reference) {
        return Promise.reject(new Error("Handlebars Template Packer reference must be provided when adding file."));
    }

    var partialName = options[AddFileOptions.PartialName];
    var addAsPartial = !!options[AddFileOptions.RegisterAsPartial];

    if(!partialName) {
        partialName = this.defaultPartialNameFromReference(reference);
    }

    var f = {};
    f.reference = Utilities.safeAddWithSlash(this._referencePrefix, reference);
    f.path = filePath;
    f.partialName = partialName;
    f.registerPartial = addAsPartial;

    this._files.push(f);
    return Promise.resolve(f);
};


HandlebarsTemplatePacker.prototype.addDirectory = function(directory, recursive, referencePrefix, fileProcessor, addAsPartial) {

    // We want to iterate the directory finding files that need to be added.

    var loader = new DirectoryLoader(directory, recursive, /\.hbs$/i);
    var addAsPartialFunc = (typeof addAsPartial === 'function') ? addAsPartial : null;
    var self = this;

    // Default file processor - straight reference prefix plus relative location name as reference, adds as partial
    // if the "addAsPartial" is not falsely. If addAsPartial is a function then the partial name is the expected result
    // (if null returned then not added as partial).

    if(!fileProcessor) {
        fileProcessor = function DefaultHandlebarsTemplatePackerFileProcessor(itemPath, name, basePath, referencePrefix) {

            var p = path.relative(basePath, path.dirname(itemPath));
            var prefix = Utilities.safeAddWithSlash(referencePrefix, p);
            var r = {};

            r[FileProcessorResultKeys.Reference] = Utilities.safeAddWithSlash(prefix, name.replace(/\.hbs$/i, ""));
            if(addAsPartial) {
                if(addAsPartialFunc) {
                    r[FileProcessorResultKeys.PartialName] = addAsPartialFunc(r[FileProcessorResultKeys.Reference], name, p, referencePrefix);
                    r[FileProcessorResultKeys.RegisterAsPartial] = !!r[FileProcessorResultKeys.PartialName];
                } else {
                    r[FileProcessorResultKeys.PartialName] = self.defaultPartialNameFromReference(r[FileProcessorResultKeys.Reference]);
                    r[FileProcessorResultKeys.RegisterAsPartial] = true;
                }
            }

            return Promise.resolve(r);
        };
    }

    return loader.run(function(itemPath, name, basePath, depth) {

        return new Promise(function(resolve, reject) {

            fileProcessor(itemPath, name, basePath, referencePrefix).then(function(result) {

                if(!result || !result[FileProcessorResultKeys.Reference]) {
                    console.error("[HandlebarsTemplatePacker] no valid result returned from file processor.");
                    return reject(new Error("Handlebars Template Packer file processor returned invalid result."));
                }

                // On successful file processing we need to compile the file add add it.
                self.addFile(itemPath, result[FileProcessorResultKeys.Reference], result).then(function() {
                    resolve();
                }).catch(function(e) {
                    reject(e);
                });

            }).catch(SkipHandlebarsTemplateError, function() {
                resolve();
            }).catch(function(err) {
                reject(err);
            });
        });
    });
};

HandlebarsTemplatePacker.prototype.defaultPartialNameFromReference = function(reference) {

    return (this._referencePrefix + reference).replace(/[\s\-\/]/g, "_");
};


HandlebarsTemplatePacker.prototype.pack = function(templateID, renderer, registerOnRenderer, logger) {

    if(arguments.length === 3 && typeof registerOnRenderer !== 'boolean' && registerOnRenderer.error) {
        logger = registerOnRenderer;
        registerOnRenderer = true;
    }

    var files = this._files;
    var compiledFiles = [];

    var logError = function(msg) {
        if(logger) {
            logger.error(LOG_PREFIX + msg);
        } else {
            console.error(LOG_PREFIX + msg);
        }
    };

    return new Promise(function(resolve, reject) {

        async.forEach(files, function(f, done) {

            // We need to load the file in resolve and compile it and then add it to the compiled files list to be packaged up
            // and/or registered on the renderer.

            fs.readFile(f.path, "utf8", function(err, data) {
                if(err) {
                    return done(err);
                }

                var compiledTemplate;
                try {
                    compiledTemplate = renderer.resolveAndPrecompile(data);
                } catch(e) {
                    if(e) {
                        logError("unable to resolve and compile handlebars template at path: [" + f.path + "] with reference: [" + f.reference + "] due to: " + e.toString());
                    }
                    return done(err);
                }

                var cf = {};
                cf.template = compiledTemplate;
                //cf.path = f.path;
                cf.reference = f.reference;
                cf.registerPartial = f.registerPartial || false;
                cf.partialName = f.partialName || null;
                compiledFiles.push(cf);
                done();
            });

        }, function(err) {

            if(err) {
                return reject(err);
            }

            if(!compiledFiles.length) {
                return resolve(null);
            }


            if(registerOnRenderer) {

                compiledFiles.forEach(function(cf) {
                    var tmpl = renderer.templateFromPrecompile(cf.template);

                    renderer.registerReferencedTemplate(cf.reference, tmpl);
                    if(cf.registerPartial && cf.partialName) {
                        renderer.registerPartialFromCompiledTemplate(cf.partialName, tmpl);
                    }
                });
            }

            // Using the compiled files we want to generate some JavaScript that can be provided to clients.
            // can use require.defined() to check and see if something is already defined or not...
            ////////

            var compiledTemplatesAsString = "var compiledTemplates = " + JSON.stringify(compiledFiles) + ";";

            var clientCode = "(function() {\n" +
                "\t" + DefineTemplateLookupProvider.toString() + "\n" +
                "\t" + "DefineTemplateLookupProvider();\n\n" +
                "})();\n\n" +
                "define('" + templateID + "', [\"templates/lookup\", \"handlebars.runtime\"], function(TemplateLookup, Handlebars){\n\n" +
                "\t" + compiledTemplatesAsString + "\n" +
                "\t" + LoadCompiledTemplates.toString() + "\n" +
                "\t" + "LoadCompiledTemplates(TemplateLookup, Handlebars, compiledTemplates);\n\n"
                + "});";

            resolve(clientCode);
        });
    });
};



// ----
// Client-Side code for packed templates
// ----

function DefineTemplateLookupProvider() {

    if(!require.defined('templates/lookup')) {
        define('templates/lookup', ['handlebars.runtime'], function(Handlebars) {

            function TemplateLookupProvider(hbars) {
                this._handlebars = hbars;
                this._templates = {};
            }

            TemplateLookupProvider.prototype.registerTemplate = function(reference, template) {
                if(reference && template) {
                    this._templates[reference.toLowerCase()] = template;
                }
            };

            TemplateLookupProvider.prototype.getTemplate = function(reference) {
                if(reference && (reference = reference.toLowerCase()) && this._templates.hasOwnProperty(reference)) {
                    return this._templates[reference];
                }
                return null;
            };

            TemplateLookupProvider.prototype.getMatchingTemplates = function(regex) {
                var templates = this._templates;
                var matches = [];

                for(var k in templates) {
                    if(templates.hasOwnProperty(k)) {
                        if(k.match(regex)) {
                            matches.push({reference:k, template:templates[k]});
                        }
                    }
                }

                return matches.length ? matches : null;
            };

            return new TemplateLookupProvider(Handlebars);
        });
    }
}


function LoadCompiledTemplates(TemplateLookup, Handlebars, compiledTemplates) {

    if(!compiledTemplates || !(compiledTemplates instanceof Array) || !compiledTemplates.length) {
        return;
    }

    for(var i = 0; i < compiledTemplates.length; i++) {
        var cf = compiledTemplates[i];

        if(cf.template) {
            var precompiledTemplate;
            eval("precompiledTemplate = " + cf.template);

            var template;
            try {
                template = Handlebars.template(precompiledTemplate);
            } catch(e) {
                console.error("Unable to create template from precompiled handlebars template for reference [" + cf.reference + "] due to: " + e.toString());
                continue;
            }

            if(template) {
                TemplateLookup.registerTemplate(cf.reference, template);

                if(cf.registerPartial && cf.partialName) {
                    Handlebars.registerPartial(cf.partialName, template);
                }

            } else {

                console.error("Unable to prepare pre-compiled handlebars template for reference [" + cf.reference + "]");
            }
        }
    }
}