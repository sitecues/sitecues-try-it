'use strict';

const zlib = require('zlib');

const unzip = (inResponse) => {
    const encoding = inResponse.headers['content-encoding'];

    let decoder;

    if (encoding === 'gzip') {
        decoder = zlib.createGunzip();
    }
    else if (encoding === 'deflate') {
        decoder = zlib.createInflate();
    }
    else if (encoding) {
        throw new Error('Unknown encoding:', encoding);
    }

    return decoder ? inResponse.pipe(decoder) : inResponse;
};

module.exports = unzip;
