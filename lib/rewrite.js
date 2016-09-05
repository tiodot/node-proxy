const fs = require('fs');
const path = require('path');
const parseUrl = require('url').parse;
const httpProxy = require('http-proxy');
const minimatch = require('minimatch');
const util = require('./util.js');
const isArray = Array.isArray;
const PATH_REGEX = /^([\w+\/]*?)([\w+\.]*\.\w+)$/;
let conf;

function parseUrlPath (urlPath) {
    var match = urlPath.match(PATH_REGEX);
    if (match) {
        return {
            path: match[1],
            name: match[2]
        };
    }
    return {path: urlPath, name: null};
}

function wrapMatch (rule, url) {

    if (typeof rule === 'string') {
        return rule;
    }
    if (typeof rule === 'object') {
        return rule.to(url, parseUrlPath(url), rule);
    }
    return url;
}

function match (url) {
    let found;
    let arr = [url.path, url.pathname];

    if (conf.map && typeof conf.map === 'object') {
        let mapKeys = Object.keys(conf.map);
        mapKeys.every((key) => {
            arr.every(url => {
                if (minimatch(url, key)) {
                    found = conf.map[key];
                    return false;
                }
                return !found;
            });
            return !found;
        });
        if (found) {
            return found;
        }
    }
    if (conf.rules && isArray(conf.rules)) {
        let rules = conf.rules;
        rules.every((rule) => {
            if (!rule.match || !rule.to) {
                return true;
            }
            arr.every(url => {
                if (rule.match instanceof RegExp) {
                    if (rule.match.test(url)) {
                        found = rule;
                        return false;
                    }
                }
                return !found;
            });
            return !found;
        });
    }
    return found;
}

module.exports = (options) => {
    const filePath = options.rewrite_file;

    if (!fs.existsSync(path.resolve(filePath))) {
        throw new Error(`rewrite: configure file [${filePath}] not found`);
    }
    conf = require(path.resolve(filePath));

    const proxy = httpProxy.createProxyServer({
        changeOrigin: true,
        autoRewrite: true
    });

    proxy.on('error',  (error, req, res) => {
        console.error('rewrite: proxy error');
    });

    return async (ctx, next) => {
        const url = parseUrl(ctx.url);
        const ruleMatched = wrapMatch(match(url), ctx.url);

        if (ruleMatched && ruleMatched !== url.path) {
            console.log(`rewrite ruleMatched: ${ruleMatched}`);
            const target = parseUrl(ruleMatched);
            // if (target.host !== url.host) {
            //     ctx.redirect(ruleMatched);
            //     return;
            // }
            ctx.originalUrl = ctx.originalUrl || ctx.url;
            ctx.url = target.path + (target.search ? (url.query ? ('&' + url.query) : '') : url.search || '');
            if (target.host === url.host) {
                ctx.path = target.path;
                return next();
            }

            await new Promise((resolve) => {
                proxy.web(ctx.req, ctx.res, {
                    target: target.protocol + '//' + target.host
                }, (e) => {
                    console.log('callback');
                });
            });
            return;
        }
        return next();
    }
};