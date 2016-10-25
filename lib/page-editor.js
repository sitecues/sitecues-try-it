// Modify HTML responses to inject sitecues and fix the DOM
// to suite our needs for pretending to be the target site.

'use strict';

const cheerio = require('cheerio');

const editPage = (page, option) => {
    const { xmlMode } = option;
    const $ = cheerio.load(page, { xmlMode });

    // Ensure that the proxy can see the full URL of referrals to itself,
    // so that it can fully resolve relative targets. This fixes the
    // Google logo on their homepage.
    $('meta[name=referrer]').attr('content', (index, value) => {
        if (value === 'none' || value === 'origin') {
            return 'origin-when-crossorigin';
        }

        return value;
    });

    $('h1').text('no way');

    return xmlMode ? $.xml() : $.html();
};

module.exports = {
    editPage
};
