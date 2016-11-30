'use strict';

class ErrorSubclass extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

// NOTE: These classes exist to provide a custom error name in stack traces.
// It is okay to implement custom logic within them, but it is also okay if
// they are empty.

class SecurityError extends ErrorSubclass {}

module.exports = {
    SecurityError
};
