var util = require("util"),
    Promise = require("bluebird"),
    errors = require("./errors");


// Extensions - provides "plugable" middleware
// ---
function Extension(logger) {
}
exports.Extension = Extension;

Extension.prototype.setup = function(app) {
};


// Basic Extension
// ---
function BasicExtension() {
    Extension.call(this);
    this._handler = null;
    this._template = null;
}
util.inherits(BasicExtension, Extension);
exports.BasicExtension = BasicExtension;


BasicExtension.prototype.setHandler = function(handler) {
    this._handler = handler;
};

BasicExtension.prototype.handler = function() {
    return this._handler;
};

BasicExtension.prototype.setTemplate = function(template) {
    this._template = template;
};

BasicExtension.prototype.template = function() {
    return this._template;
};

BasicExtension.prototype.setup = function(app) {

    var self = this;
    app.use(function BasicExtensionMiddleware(request, response, next) {

        if(self._handler) {
            return self._handler(request, response, next);
        }
        self.performDefaultRouteAction(request, response, next);
    });

    return Promise.resolve();
};

BasicExtension.prototype.performDefaultRouteAction = function(request, response, next) {
    next();
};


// Extended Extension (passes error in addition to request, response and next).
// ---
function ExtendedExtension() {
    BasicExtension.call(this);
}
util.inherits(ExtendedExtension, BasicExtension);
exports.ExtendedExtension = ExtendedExtension;

ExtendedExtension.prototype.setup = function(app) {

    var self = this;
    app.use(function ExtendedExtensionMiddleware(err, request, response, next) {

        if(self._handler) {
            return self._handler(err, request, response, next);
        }
        self.performDefaultRouteAction(err, request, response, next);
    });

    return Promise.resolve();
};

ExtendedExtension.prototype.performDefaultRouteAction = function(err, request, response, next) {
    next();
};



// ----
//  Not Found Extension
// ----

function NotFoundExtension() {
    BasicExtension.call(this);
}

util.inherits(NotFoundExtension, BasicExtension);
exports.NotFoundExtension = NotFoundExtension;

NotFoundExtension.prototype.performDefaultRouteAction = function(request, response, next) {

    var template = this.template();
    if(template) {
        return response.status(404).render(template).catch(function(e) {
            console.error("[LibApp/NotFoundExtension] rendering 404 not found template failed due to: " + e.toString(), {error:e.toString()});
        });
    }

    response.setHeader('Content-Type', 'text/html');
    response.status(404).end("Not Found");
};


// ----
//  Access Restricted
// ----

function AccessRestrictedExtension() {
    ExtendedExtension.call(this);
}

util.inherits(AccessRestrictedExtension, ExtendedExtension);
exports.AccessRestrictedExtension = AccessRestrictedExtension;

AccessRestrictedExtension.prototype.performDefaultRouteAction = function(err, request, response, next) {

    if(!err || !(err instanceof errors.AccessRestrictedError)) {
        return next(err);
    } else if(response.headersSent) {
        return next(err);
    } else if(request.xhr) {
        response.status(403).send({status: 'error', error:'access restricted'});
        return;
    }

    var template = this.template();
    if(template) {
        return response.status(403).render(template).catch(function(e) {
            console.error("[LibApp/AccessRestrictedExtension] rendering 403 access restricted template failed due to: " + e.toString(), {error:e.toString()});
        });
    }

    response.setHeader('Content-Type', 'text/html');
    response.status(403).end("Access Restricted");
};


// ----
//  Error
// ----

function ErrorExtension() {
    ExtendedExtension.call(this);
}

util.inherits(ErrorExtension, ExtendedExtension);
exports.ErrorExtension = ErrorExtension;

ErrorExtension.prototype.performDefaultRouteAction = function(err, request, response, next) {

    if(err && err instanceof errors.NotFoundError) {
        return next(err);
    } else if(response.headersSent) {
        return next(err);
    } else if(request.xhr) {
        // If error has a status or statusCode use that value (if within an expected range)
        var statusCode = err.status || err.statusCode;
        if(typeof(statusCode) !== "number" || statusCode < 400 || statusCode > 599) {
            statusCode = 500;
        }
        response.status(statusCode).send({status: 'error'});
        return;
    }

    var template = this.template();
    if(template) {
        return response.status(500).render(template).catch(function(e) {
            console.error("[LibApp/ErrorExtension] rendering error template failed due to: " + e.toString(), {error:e.toString()});
        });
    }

    response.setHeader('Content-Type', 'text/html');
    response.status(500).end("Server Error");
};
