exports.applyFixes = function(logstash, maxLogQueue) {

    maxLogQueue = parseInt(maxLogQueue || "1000");
    maxLogQueue = (isNaN(maxLogQueue) || !maxLogQueue) ? 1000 : maxLogQueue;

    var orig_log = logstash.log;
    logstash.log = function() {
        if(!this.connected) {
            if(this.log_queue && this.log_queue.length >= maxLogQueue) {
                this.log_queue.splice(0,1);
            }
        }
        return orig_log.apply(this, arguments);
    };

    var orig_announce = logstash.announce;
    logstash.announce = function() {
        if(!this.terminating) {
            this.emit("did-connect");
            if(this.hasOwnProperty("silent") && this.silent) {
                this.silent = false;
            }
        }
        return orig_announce.apply(this, arguments);
    };
};