var winston = require('winston'),
    winstonLogstashUtils = require('./util-winston-logstash');

var WinstonLogstash = require('winston-logstash').Logstash;

var os = require('os');
var hostname = os.hostname();


// ----
// Logger
// ----

function Logger(loggingConfig, debug, verbose) {

    var loggerTransports = [];
    var minLogLevel = 'info';

    if(debug || verbose || !loggingConfig || (loggingConfig && loggingConfig.console !== false)) {
        var consoleLoggerLevel = 'info';

        if(verbose) {
            minLogLevel = consoleLoggerLevel = 'verbose';
        }
        if(debug) {
            minLogLevel = consoleLoggerLevel = 'debug';
        }
        loggerTransports.push(new (winston.transports.Console)({level: consoleLoggerLevel, colorize: true}));
    }

    var logstashLoggerLevel = 'warn';

    if(loggingConfig && loggingConfig.host) {
        var meta = loggingConfig.meta || {};
        meta.type = "log";

        var opts = {
            host: loggingConfig.host,
            port: loggingConfig.port || 28777,
            node_name: hostname,
            level: logstashLoggerLevel,
            max_connect_retries: -1,                // keep trying to reconnect
            timeout_connect_retries: 5000,          // wait 5 seconds between attempts
            meta: loggingConfig.meta || {}
        };

        if(loggingConfig.ssl) {
            opts.ssl_enable = true;
            opts.ssl_key = loggingConfig.ssl.key_path;
            opts.ssl_cert = loggingConfig.ssl.cert_path;

            if(config.ssl.ca_paths) {
                opts.ca = (loggingConfig.ssl.ca_paths instanceof Array) ? loggingConfig.ssl.ca_paths : [loggingConfig.ssl.ca_paths];
            }

            if(loggingConfig.ssl.key_passphrase) {
                opts.ssl_passphrase = loggingConfig.ssl.key_passphrase;
            }
        }

        var logstash = new WinstonLogstash(opts);
        winstonLogstashUtils.applyFixes(logstash, loggingConfig.max_queue_length); // Apply a fix: limits maximum queued messages when logstash is unavailable.

        logstash.on('error', function (err) {
            console.error("[Logger/Default/Logstash] -> error from default logstash logger: " + err.toString());
        });

        logstash.on('did-connect', function() {
            console.info("[Logger/Default/Logstash] -> has connected successfully to logstash server.");
        });

        loggerTransports.push(logstash);
    }

    this._log = new (winston.Logger)({
        level: minLogLevel,
        transports: loggerTransports,
        exitOnError: false
    });
    this._log.on('error', function (err) {
        console.error("[Logger/Default] -> error from default logger: " + err.toString());
    });

    var log = this._log;
    var createLoggingMethod = function(method, type) {
        return function() {
            if(arguments && arguments.length > 1 && arguments[1]) {
                if(typeof arguments[1] === "object" && !arguments[1].hasOwnProperty("type")) {
                    arguments[1].type = type;
                }
            }
            method.apply(log, arguments);
        };
    };

    this.verbose = createLoggingMethod(this._log.verbose, "log");
    this.debug = createLoggingMethod(this._log.debug, "log");
    this.info = createLoggingMethod(this._log.info, "log");
    this.warn = createLoggingMethod(this._log.warn, "log");
    this.error = createLoggingMethod(this._log.error, "log");
}

module.exports = Logger;