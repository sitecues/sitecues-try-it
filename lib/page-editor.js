// Modify HTML responses to inject sitecues and fix the DOM
// to suite our needs for pretending to be the target site.

'use strict';

const url = require('url');
const cheerio = require('cheerio');
const urlType = require('url-type');

const { isAbsolute, isSchemeRelative, isOriginRelative } = urlType;
const isHttpish = urlType.isHttpOrHttps;

// Loader strategies are shorthand aliases for what the proxy should do
// with loaders it finds in the page.
const loaderStrategy = {
    ADD     : 'add',
    REMOVE  : 'remove',
    KEEP    : 'keep'
};

const toProxyPath = (targetUrl) => {
    return '/' + targetUrl;
};

const editPage = (page, option) => {
    // TODO: Use the csp module to conditionally add *.sitecues.com
    // to security policy, if needed.
    const { state, target, xmlMode } = option;
    const $ = cheerio.load(page, { xmlMode });

    // log.verbose('Target :', target);

    let existingBaseTagUrl;

    // The first base tag with an href attribute.
    $('base[href]').first().attr('href', (index, value) => {
        // Some sites use relative base tags, so we must compute
        // its meaning for it to be useful.
        const absoluteUrl = url.resolve(target, value);

        // The W3C spec says to respect the first encountered base tag href,
        // so we must be careful to save this only once.
        existingBaseTagUrl = absoluteUrl;

        // Decide whether configuration allows us to make ourselves the base
        // for all relative links. If not, we must ensure the final base URL
        // is absolute so it cannot accidentally be relative to the proxy.
        return state.proxyBase ? toProxyPath(absoluteUrl) : absoluteUrl;
    });

    // The base that the target itself wants / expects, can be used to
    // create links that "bypass" the proxy.
    const targetBaseUrl = existingBaseTagUrl || target;
    // The target's base as a proxy URL. Can be used to create links
    // that use the proxy. Do NOT resolve origin-relative URLs
    // against this, or else the target will be lost in the process.
    const proxiedBaseUrl = toProxyPath(targetBaseUrl);
    // The "final" base URL that we have computed and is guaranteed to be
    // what ends up as the base tag href in the page we deliver.
    const baseUrl = state.proxyBase ? proxiedBaseUrl : targetBaseUrl;

    // If a base was not declared by the page, we must fallback to using
    // one of our own, based on the configuration for proxying links.
    // if (typeof existingBaseTagUrl === undefined && !state.proxyBase) {
    if (typeof existingBaseTagUrl === 'undefined') {
        // log.verbose('final base:', baseUrl);
        $('head').prepend(`<base href="${baseUrl}">`);
    }

    // Ensure that the proxy can see the full URL of referrals to itself,
    // so that it can fully resolve relative targets. This fixes the
    // Google logo on their homepage.
    $('meta[name=referrer]').attr('content', (index, value) => {
        if (value === 'none' || value === 'origin') {
            return 'origin-when-crossorigin';
        }

        return value;
    });

    if (state.proxyBase) {
        // Anchors with an href attribute.
        $('a[href]').attr('href', (index, value) => {
            if (!value) {
                return value;
            }

            if (isAbsolute(value) && isHttpish(value)) {
                // Force proxying of links which might get clicked, etc.
                return toProxyPath(value);
            }
            else if (isSchemeRelative(value) || isOriginRelative(value)) {
                return toProxyPath(url.resolve(targetBaseUrl, value));
            }

            return value;
        });
    }

    // Bypass the proxy for content we would never alter, such as
    // images and stylesheets. This enhances performance,
    // but also avoids accidentally corrupting data.
    if (state.proxyBase) {
        // CSS stylesheets with an href attribute.
        $('link[href]').attr('href', (index, value) => {
            // Bypass the proxy entirely for downloading stylesheets.
            return value && url.resolve(targetBaseUrl, value);
        });

        // All elements with a src attribute.
        $('*[src]').attr('src', (index, value) => {
            // Bypass the proxy entirely for downloading media content,
            // to avoid accidentally corrupting it.
            return value && url.resolve(targetBaseUrl, value);
        });
    }

    // The sitecues loader can appear in many different forms depending on the
    // constraints of any given customer's website technology.
    const existingLoaders = $([
        'script[data-provider="sitecues"]',
        'script:contains(sitecues.config.scriptUrl;)',
        'script[src$="sitecues-loader.js"]'
    ].join(', '));

    if (state.loaderStrategy === loaderStrategy.ADD) {
        $('head').first().append(state.loader);
    }
    else if (state.loaderStrategy === loaderStrategy.REMOVE) {
        existingLoaders.remove();
    }
    else if (state.loaderStrategy === loaderStrategy.KEEP) {
        if (existingLoaders.length < 1) {
            $('head').first().append(state.loader);
        }
    }
    else if (existingLoaders.length > 0) {
        existingLoaders.first().replaceWith(state.loader);
    }
    else {
        $('head').first().append(state.loader);
    }

    return xmlMode ? $.xml() : $.html();
};

module.exports = {
    editPage
};
