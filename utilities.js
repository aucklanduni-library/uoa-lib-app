exports.safeAddWithSlash = function(string, add) {

    if(!string) {
        string = "";
    } else if(!string.length) {
        string = "";
    } else if(string[string.length-1] === "/") {
        string = string.substr(0, string.length-1);
    }

    if(add && add.length && add[0] === "/") {
        add = add.substr(1, add.length-1);
    }

    return (string.length ? (string + "/") : "") + add;
};

exports.safeAppendSlash = function(string) {

    if(!string) {
        string = "";
    }
    return (string.length && string[string.length-1] === "/") ? string : string + "/";
};