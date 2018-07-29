var influx = require("influx"),
    async = require("async"),
    gc = require('gc-stats'),
    os = require("os");

var hostname = os.hostname();

var MetricsQueueUpperLimit = 512;

function Metric(config, infoLog, errorLog) {

    this._influx = influx(config.server);
    this._errorLog = errorLog || null;
    this._infoLog = infoLog || null;

    this._metricsToWrite = {};
    this._metricWriterTimeout = null;

    this._additionalTags = config.tags || {};

    if(!this._additionalTags[exports.CommonMetricTags.Host]) {
        this._additionalTags[exports.CommonMetricTags.Host] = hostname;
    }

    var self = this;

    this._metricsQueue = async.queue(function(mtw, callback) {
        var totalNeeded = 0;
        var allProcessed = 0;
        var k;

        for(k in mtw) {
            if(mtw.hasOwnProperty(k)) {
                ++totalNeeded;
            }
        }

        for(k in mtw) {
            if(mtw.hasOwnProperty(k)) {
                self._influx.writePoints(k, mtw[k], function(err, response) {
                    if(err && self._errorLog) {
                        self._errorLog("[LibApp/Metrics] write metrics failed due to: " + err.toString());
                    }
                    ++allProcessed;
                    if(allProcessed >= totalNeeded) {
                        callback();
                    }
                });
            }
        }
    }, 10);

    this._enableGarbageCollectionReporting();
    this._enableLatencyReporting();
}

exports.Metric = Metric;

// Common metrics and common tags
exports.CommonMetrics = {
    Requests: "requests",
    Node: "node"
};

exports.CommonMetricTags = {
    RequestStatusCode: "statusCode",
    NodeMetricType: "type",                         // used for Node metrics (garbage collection or latency etc)
    Host: "host"                                    // used for all - inserts current hostname
};

exports.NodeMetricTypes = {
    GarbageCollection: "gc",
    Latency: "latency"
};


Metric.prototype.writeMultipleMetrics = function(metric, points) {

    if(!this._influx) {
        return;
    }
    
    var mtw = this._metricsToWrite;
    var self = this;

    // Apply any additonal tags to each data point.
    if(this._additionalTags) {
        points.forEach(function(x) {
            var tags = x[1];
            for(var k in self._additionalTags) {
                if(self._additionalTags.hasOwnProperty(k) && !tags.hasOwnProperty(k)) {
                    tags[k] = self._additionalTags[k];
                }
            }
        });
    }

    if(mtw.hasOwnProperty(metric)) {
        points.forEach(function(x) {
            mtw[metric].push(x);
        });
    } else {
        mtw[metric] = points;
    }

    if(this._metricWriterTimeout == null) {

        this._metricWriterTimeout = setTimeout(function() {
            var mtw = self._metricsToWrite;
            self._metricsToWrite = {};
            self._metricWriterTimeout = null;

            if(self._metricsQueue.length() < MetricsQueueUpperLimit) {
                self._metricsQueue.push(mtw);
            } else if(self._infoLog) {
                self._infoLog("[LibApp/Metrics] metrics failed to write as metrics queue is over upper limit.");
            }

        }, 250);
    }
};


Metric.prototype.writeMetric = function(metric, values, tags) {

    this.writeMultipleMetrics(metric, [[values, tags]]);
};


Metric.prototype.writeRequestMetric = function(statusCode, totalTime, eventTimer, extraTags) {

    var values = {};
    var tags = {};

    values.value = parseInt(totalTime);

    if(eventTimer) {
        eventTimer.addTimingToMetrics(values);
    }

    if(statusCode) {
        tags[exports.CommonMetricTags.RequestStatusCode] = statusCode;
    }

    if(extraTags) {
        for(var k in extraTags) {
            if(extraTags.hasOwnProperty(k) && !tags.hasOwnProperty(k)) {
                tags[k] = extraTags[k];
            }
        }
    }

    this.writeMetric(exports.CommonMetrics.Requests, values, tags);
};



Metric.prototype._enableLatencyReporting = function(component) {

    var self = this;

    var latencyData = {
        count: 0,
        min: 60 * 1000,
        max: 0,
        total: 0
    };

    var latencyCheck = function() {
        var start = process.hrtime();
        setImmediate(function(start) {
            var delta = process.hrtime(start);
            var latency = (delta[0] * 1000) + (delta[1] / 1000000);
            latencyData.count++;
            latencyData.min = Math.min(latencyData.min, latency);
            latencyData.max = Math.max(latencyData.max, latency);
            latencyData.total = latencyData.total + latency;
        }, start);
    };

    // Generate tags for each metric collection.
    var tags = {};
    tags[exports.CommonMetricTags.NodeMetricType] = exports.NodeMetricTypes.Latency;

    if(component) {
        if(this._additionalTags.application) {
            tags.application = this._additionalTags.application + "." + component;
        } else {
            tags.component = component;
        }
    }

    var latencyReport = function() {
        if (latencyData.count === 0) {
            return;
        }

        var values = {};

        values.minimum = latencyData.min;
        values.maximum = latencyData.max;
        values.average = latencyData.total / latencyData.count;

        self.writeMetric(exports.CommonMetrics.Node, values, tags);

        latencyData.count = 0;
        latencyData.min = 60 * 1000;
        latencyData.max = 0;
        latencyData.total = 0;
    };

    var latencyCheckInterval = 500;
    var latencyReportInterval = 5000;

    this._latencyCheckLoop = setInterval(latencyCheck, latencyCheckInterval);
    this._latencyReportLoop = setInterval(latencyReport, latencyReportInterval);
};


Metric.prototype._enableGarbageCollectionReporting = function(component) {

    var self = this;
    var gcInstance = gc();

    // Generate tags for each metric collection.
    var tags = {};
    tags[exports.CommonMetricTags.NodeMetricType] = exports.NodeMetricTypes.GarbageCollection;

    if(component) {
        if(this._additionalTags.application) {
            tags.application = this._additionalTags.application + "." + component;
        } else {
            tags.component = component;
        }
    }

    gcInstance.on('stats', function (stats) {

        var values = {};
        if(stats.after) {
            values.totalHeapExecutableSize = stats.after.totalHeapExecutableSize;
            values.totalHeapSize = stats.after.totalHeapSize;
            values.physicalSize = stats.after.totalPhysicalSize;
            values.usedHeapSize = stats.after.totalPhysicalSize;
        }

        if(stats.diff) {
            values.reclaimedUsedHeapSize = stats.diff.usedHeapSize;
        }

        values.value = stats.pause; // value == nanoseconds
        values.pause = stats.pauseMS; // pause == milliseconds

        self.writeMetric(exports.CommonMetrics.Node, values, tags);
    });
};