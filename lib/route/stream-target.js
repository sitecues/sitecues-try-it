'use strict';

const url = require('url');
const isRelativeUrl = require('url-type').isRelative;
const boom = require('boom');
const Trumpet = require('trumpet');
const unzip = require('../unzip');

const routePrefix = '/stream/';
// NOTE: Not all 3xx responses should be messed with.
// For example, 304 Not Modified.
const redirectCodes = [
    301, 302, 303, 307, 308
];
// Headers that will NOT be copied from the inResponse to the outResponse.
const ignoredResponseHeaders = [
    // Hapi will negotiate this with the client for us.
    'content-encoding',
    // Hapi prefers chunked encoding, but also re-calculates size
    // when necessary, which is important if we modify it.
    'content-length',
    // Hapi will negotiate this with the client for us.
    'transfer-encoding'
];

// Modify a URL such that its protocol is http: if one
// is not already present.
const assumeHttp = (targetUrl) => {
    return targetUrl.replace(/^(?!(?:\w+:)?\/\/)/, 'http://');
};

const getTargetUrl = (requestPath) => {
    return requestPath.substring(routePrefix.length);
};

const toProxyPath = (targetUrl) => {
    return routePrefix + targetUrl;
};

// Ensure that the client receives a reasonable representation
// of what the target server sends back.
const mapResponseData = (from, to) => {
    const { headers } = from;

    Object.keys(headers).filter((name) => {
        return headers[name] && !ignoredResponseHeaders.includes(name.toLowerCase());
    }).forEach((name) => {
        to.header(name, headers[name]);
    });

    to.code(from.statusCode);
    // TODO: Figure out how to make the proxy respect statusMessage
    // console.log('from statusMessage:', from.statusMessage);
};

// This style rule is disabled because we don't control Hapi's API.
// eslint-disable-next-line max-params
const onResponse = (err, inResponse, inRequest, reply, settings) => {
    if (err) {
        // Modify errors to be more clear and user friendly.
        if (err.code === 'ENOTFOUND') {
            err.output.payload.message = 'Unable to find the target via DNS';
        }
        else if (err.code === 'ECONNREFUSED') {
            err.output.payload.message = 'Unable to connect to the target';
        }

        throw err;
    }

    // Fix HTTP redirects, which would kick the user out of the proxy.
    if (redirectCodes.includes(inResponse.statusCode)) {
        const target = settings.uri;

        // Re-write redirect URLs to use the proxy. These can be relative,
        // so we must resolve them from the original target.
        reply(inResponse).location(toProxyPath(
            url.resolve(
                target,
                inResponse.headers.location
            )
        ));
        return;
    }

    const contentType = inResponse.headers['content-type'];

    // Ensure we don't modify non-HTML responses.
    if (!contentType || !contentType.toLowerCase().includes('html')) {
        reply(inResponse);
        return;
    }

    const editor = new Trumpet();

    editor.on('error', (err) => {
        throw err;
    });

    editor.createWriteStream('h1').end('no one');

    const page = unzip(inResponse).pipe(editor);
    const outResponse = reply(page);

    // Pass along response metadata from the upstream server,
    // such as the Content-Type.
    mapResponseData(inResponse, outResponse);
};

const onRequest = (inRequest, reply) => {
    // The user's desired URL to visit.
    const target = getTargetUrl(inRequest.url.href);

    // Deal with lazy users, favicon.ico requests, etc. where a protocol
    // and maybe even an origin, cannot be determined from the target.
    if (isRelativeUrl(target)) {
        const referrer = inRequest.info.referrer;
        const resolvedTarget = referrer ?
            url.resolve(
                assumeHttp(getTargetUrl(
                    url.parse(referrer).path
                )),
                '/' + target
            ) :
            // Resolving adds a trailing slash to domain root URLs,
            // which helps the client resolve page-relative URLs.
            url.resolve('', assumeHttp(target));

        if (!url.parse(resolvedTarget).hostname) {
            reply(boom.badRequest(
                resolvedTarget === 'http:///' ?
                    'A target is required, but was not provided' :
                    'An invalid target was provided (no hostname)'
            ));
            return;
        }

        // We do a redirect rather than proxying to the resolved target so that
        // future requests for subresources within the content send us a useful
        // referrer header. Otherwise we will lose track of the relevant origin
        // for the content.

        reply.redirect(toProxyPath(resolvedTarget)).rewritable(false);
        return;
    }
    // Targets like http://foo.com need to be redirected to http://foo.com/
    // in order to help the client properly resolve subresources that use
    // page-relative URLs. In other words, we need to make sure that the
    // target is treated as a directory under the proxy.
    else if (!target.endsWith('/')) {
        const resolvedTarget = url.resolve('', target);
        if (target !== resolvedTarget) {
            reply.redirect(toProxyPath(resolvedTarget)).rewritable(false);
            return;
        }
    }

    const parsedTarget = url.parse(target);

    if (!parsedTarget.protocol) {
        reply(boom.badRequest('An invalid target was provided (no protocol)'));
        return;
    }
    if (!parsedTarget.hostname) {
        reply(boom.badRequest('An invalid target was provided (no hostname)'));
        return;
    }

    reply.proxy({
        uri         : target,
        // Shovel headers between the client and target.
        passThrough : true,
        onResponse
    });
};

module.exports = {
    method : '*',
    path   : routePrefix + '{target*}',
    config : {
        // Pretty print JSON responses (namely, errors) for a friendly UX.
        json : {
            space : 4
        },
        // Workaround reply.proxy() not supporting the default payload config.
        // https://github.com/hapijs/hapi/issues/2647
        payload : {
            output : 'stream',
            parse  : false
        }
    },
    handler : onRequest
};
