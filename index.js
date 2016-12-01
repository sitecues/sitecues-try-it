'use strict';

const fs = require('fs');
const path = require('path');
const portType = require('port-type');
const { Server } = require('hapi');
const hi = require('hapi-hi');
const h2o2 = require('h2o2');
/* eslint-disable global-require */
const routes = [
    require('./lib/route/target'),
    require('./lib/route/stream-target')
];
/* eslint-enable global-require */

class TryIt extends Server {
    constructor(option) {
        const privileged = portType.haveRights(80);
        const config = Object.assign(
            {
                insecurePort : privileged ? 80 : 3001,
                port         : privileged ? 443 : 3000,
                tls          : {
                    // Async configuration for constructors is a pain.
                    /* eslint-disable no-sync */
                    key  : fs.readFileSync(path.join(__dirname, 'lib/key/localhost.key')),
                    cert : fs.readFileSync(path.join(__dirname, 'lib/cert/localhost-chain.cert'))
                    /* eslint-enable no-sync */
                }
            },
            option
        );

        super();

        super.connection({
            port : config.port,
            tls  : config.tls
        });
        super.connection({
            port : config.insecurePort
        });
    }

    start() {
        const plugins = [
            {
                register : hi,
                options  : {
                    cwd        : __dirname,
                    noConflict : true
                }
            },
            h2o2
        ];
        return super.register(plugins).then(() => {
            super.route(routes);

            // Sadly, we cannot just return the start() promise because of:
            // https://github.com/hapijs/hapi/issues/3217

            return new Promise((resolve, reject) => {
                super.start((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                });
            });
        });
    }
}

module.exports = {
    TryIt
};
