function CORSMiddleware(allowedOrigins, defaultOrigin, headers) {
    this._allowedOrigins = allowedOrigins || null;
    this._defaultOrigin = defaultOrigin || null;
    this._headers = headers || null;
}

CORSMiddleware.prototype.middleware = function() {

    var AllowedOrigins = this._allowedOrigins;
    var DefaultOrigin = this._defaultOrigin;
    var CORSHeaders = this._headers;

    return function CORSMiddleware(request, response, next) {
        var origin = request.headers.origin;
        var allowedOrigin = null;

        if(origin && AllowedOrigins && AllowedOrigins.length)  {
            var indx = AllowedOrigins.indexOf(origin.toLowerCase());
            if(indx !== -1) {
                allowedOrigin = AllowedOrigins[indx];
            }
        }
        if(!allowedOrigin) {
            allowedOrigin = DefaultOrigin;
        }

        if(allowedOrigin) {
            response.set('Access-Control-Allow-Origin', allowedOrigin);

            var vary = response.get("Vary") || "";
            vary = vary.split(",").map(function(x) {
                return x.trim();
            });
            vary.push("Origin");

            response.set('Vary', vary.join(", "));
        }

        if(CORSHeaders) {
            for(var k in CORSHeaders) {
                if(CORSHeaders.hasOwnProperty(k)) {
                    response.set(k, CORSHeaders[k]);
                }
            }
        }
        return next();
    };
};

CORSMiddleware.prototype.optionsHandler = function() {

    var middleware = this.middleware();

    return function CORSOptionsHandler(request, response, next) {
        middleware(request, response, function() {
            return response.status(200).end();
        });
    };
};

module.exports = CORSMiddleware;