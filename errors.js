// Not Found error
function NotFoundError() {
}
NotFoundError.prototype = Object.create(Error.prototype);
exports.NotFoundError = NotFoundError;


// Access Restricted error
function AccessRestrictedError() {
}
AccessRestrictedError.prototype = Object.create(Error.prototype);
exports.AccessRestrictedError = AccessRestrictedError;
