// ----
// Event Timer
// ----

function EventTimer() {
    this._solrQueryTimes = [];
    this._timers = {};
}

exports.EventTimer = EventTimer;

EventTimer.prototype.startTimer = function(type) {

    var timer = this._timers[type] || null;

    if(timer) {
        if(timer.count > 0) {
            timer.count++;
        } else {
            timer.count = 1;
            timer.timer = process.hrtime();
        }
    } else {
        timer = {};
        timer.count = 1;
        timer.timer = process.hrtime();
        timer.total = 0;

        this._timers[type] = timer;
    }
};

EventTimer.prototype.stopTimer = function(type) {
    var timer = this._timers[type] || null;
    if(timer && timer.count > 0) {
        --timer.count;
        if(timer.count === 0) {
            var diff = process.hrtime(timer.timer);
            timer.total += diff[0] * 1e3 + diff[1] * 1e-6;
        }
    }
};

exports.EventTypes = {};
exports.EventTypes.MemcachedTimer = "memcached";
exports.EventTypes.SolrTimer = "solr";
exports.EventTypes.MongoDBTimer = "mongodb";
exports.EventTypes.RenderTimer = "render";


EventTimer.prototype.addSolrQueryTime = function(time) {

    this._solrQueryTimes.push(time);
};


EventTimer.prototype.addTimingToAccessEvent = function(eeData) {

    if(this._timers) {
        for(var k in this._timers) {
            if(this._timers.hasOwnProperty(k)) {
                var timer = this._timers[k];
                if(timer && timer.total > 0) {
                    if(k.indexOf(".") !== -1) {
                        k = (k.split(".").map(function(v, i){ return i > 0 ? v.charAt(0).toUpperCase() + v.substr(1) : v; }).join(""));
                    }
                    eeData[k + "Overhead"] = Math.round(timer.total*1000)/1000;
                }
            }
        }
    }

    if(this._solrQueryTimes && this._solrQueryTimes.length > 0) {
        eeData["solrQueryTimes"] = this._solrQueryTimes;

        var totalReportedSolrTime = 0;
        this._solrQueryTimes.forEach(function(x) {
            totalReportedSolrTime += x;
        });

        if(totalReportedSolrTime) {
            eeData["solrQueryTimesTotal"] = totalReportedSolrTime;
        }
    }
};


EventTimer.prototype.addTimingToMetrics = function(metricValues) {

    if(!this._timers) {
        return;
    }

    for(var k in this._timers) {
        if(this._timers.hasOwnProperty(k)) {
            var timer = this._timers[k];
            if(timer && timer.total > 0) {
                metricValues["timing." + k] = parseInt(Math.round(timer.total*1000)/1000);
            }
        }
    }
};