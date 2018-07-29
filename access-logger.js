var winston = require('winston'),
    onFinished = require("on-finished"),
    winstonLogstashUtils = require('./util-winston-logstash');

require('winston-logstash');

var os = require('os');
var hostname = os.hostname();


// ----
// Access Logger
// ----

function AccessLogger(config, metrics, debug, verbose) {

    this._metrics = metrics || null;

    if(config && config.host) {
        var opts = {
            host: config.host,
            port: config.port || 28777,
            node_name: hostname,
            max_connect_retries: -1,                // keep trying to reconnect
            timeout_connect_retries: 5000,          // wait 5 seconds between attempts
            meta: config.meta || {}
        };

        if(config.ssl) {
            opts.ssl_enable = true;
            opts.ssl_key = config.ssl.key_path;
            opts.ssl_cert = config.ssl.cert_path;

            if(config.ssl.ca_paths) {
                opts.ca = (config.ssl.ca_paths instanceof Array) ? config.ssl.ca_paths : [config.ssl.ca_paths];
            }

            if(config.ssl.key_passphrase) {
                opts.ssl_passphrase = config.ssl.key_passphrase;
            }
        }

        var accessLogstash = new (winston.transports.Logstash)(opts);
        winstonLogstashUtils.applyFixes(accessLogstash, config.max_queue_length); // Apply a fix: limits maximum queued messages when logstash is unavailable.

        accessLogstash.on('error', function (err) {
            console.error("[Logger/Access/Logstash] -> error from access logstash logger: " + err.toString());
        });

        accessLogstash.on('did-connect', function() {
            console.info("[Logger/Access/Logstash] -> has connected successfully to logstash server.");
        });

        this._access = new (winston.Logger)({
            transports: [accessLogstash],
            exitOnError: false
        });

        this._access.on('error', function (err) {
            console.error("[Logger/Access] -> error from access logger: " + err.toString());
        });

        this.access = this._access.info.bind(this._access);

    } else {

        // Otherwise, a no-op operation
        this.access = function() {
        };
    }
}

AccessLogger.prototype.createAccessEvent = function(request, response, eventTimer, section, extraData, extraMetricTags) {

    if(!this._access) {
        return null;
    }

    var startTime = process.hrtime();
    var remoteAddress = request.connection ? request.connection.remoteAddress : null;
    var eeData = {};
    var hasProcessed = false;
    var self = this;

    var __process = function() {
        if(hasProcessed) {
            return;
        }
        hasProcessed = true;

        var diff = process.hrtime(startTime);
        var ms = diff[0] * 1e3 + diff[1] * 1e-6;
        var duration = Math.round(ms*1000)/1000;
        var message = {};
        var msg = eeData["message"];
        var k;

        delete eeData["message"];
        eeData["trigger"] = function() {};

        var _safeCopyHeader = function(header, dest, number) {
            if(request.headers && request.headers[header]) {
                message[dest] = (number) ? parseInt(request.headers[header]) : request.headers[header];
                return true;
            }
            return false;
        };

        _safeCopyHeader("host", "ident");

        if(section) {
            message.module = section;
        }

        message.type = "access";
        message.verb = request.method;
        message.request = (request.originalUrl || request.url);

        message.responseTime = duration;
        _safeCopyHeader("user-agent", "userAgent");
        message.verb = request.method;
        message.response = response.statusCode;
        message.httpversion = request.httpVersionMajor + '.' + request.httpVersionMinor;

        if(!_safeCopyHeader("referer", "referrer")) {
            _safeCopyHeader("referrer", "referrer");
        }

        var xforwardedFor = request.headers['x-forwarded-for'];
        if(xforwardedFor) {
            message.clientip = xforwardedFor.split(",")[0].trim();
        } else {
            message.clientip = remoteAddress;
        }

        // Copy over any Shib attributes as well:
        _safeCopyHeader("uid", "username");
        _safeCopyHeader("affiliation", "affiliation");

        _safeCopyHeader("content-length", "bytes", true);

        if(extraData) {
            for(k in extraData) {
                if(extraData.hasOwnProperty(k) && !message.hasOwnProperty(k)) {
                    message[k] = extraData[k];
                }
            }
        }

        for(k in eeData) {
            if(eeData.hasOwnProperty(k) && !message.hasOwnProperty(k) && k != "trigger") {
                message[k] = eeData[k];
            }
        }

        // Include any timing details as well.
        if(eventTimer) {
            eventTimer.addTimingToAccessEvent(message);
        }

        self.access(msg ? msg : ("" + message.clientip + " " + message.request), message);

        if(self._metrics) {
            self._metrics.writeRequestMetric(response.statusCode, duration, eventTimer, extraMetricTags);
        }
    };

    onFinished(response, function() {
        __process();
    });

    eeData.trigger = function() {
        __process();
    };

    return eeData;
};

module.exports = AccessLogger;


