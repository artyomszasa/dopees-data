// see: https://tools.ietf.org/html/rfc3986
const regexUri = /^(([a-z][a-z0-9+.-]*):)?(\/\/(([!$&\\'()*,;=a-z0-9._~-]|%[0-9a-f][0-9a-f])*)(\:([0-9]+))?)?(([\/!$&\\'()*,;=:@a-z0-9._~-]|%[0-9a-f][0-9a-f])*)(\?([!$&\\'()*,;=:@a-z0-9._~\/?-]|%[0-9a-f][0-9a-f])*)?(\#.*)?$/i;

const parseQuery = (params : any, raw : string) => {
    raw
        .split('&')
        .forEach(one => {
            if (one) {
                const i = one.indexOf('=');
                if (-1 === i) {
                    params[one] = null;
                } else {
                    params[one.substring(0, i)] = decodeURIComponent(one.substring(i + 1));
                }
            }
        });
};
const parse = (uri : Uri, raw : string) => {
    const m = regexUri.exec(raw);
    if (m) {
        uri.scheme = m[2];
        uri.host = m[4];
        uri.path = m[8];
        uri.port = parseInt(m[7], 10) || Uri.defaultPorts[uri.scheme] || 0;
        uri.query = (m[10] && m[10].substr(1) || '');
        uri.fragment = (m[12] && m[12].substr(1) || '');
    }
};

interface UriDefaultPorts {
    [scheme : string] : number
}

interface UriQueryParams {
    [name : string] : string
}

export default class Uri {
    static defaultPorts : UriDefaultPorts = {
        'http': 80,
        'https': 443
    }
    static create (source : Uri | string) {
        if ('string' === typeof source) {
            return new Uri(source);
        }
        return new Uri(source.href);
    }
    scheme : string
    host : string
    path : string
    port : number
    queryParams : UriQueryParams
    fragment : string
    get authority () {
        if (this.port && this.port !== Uri.defaultPorts[this.scheme]) {
            return `${this.host}:${this.port}`;
        }
        return this.host;
    }
    set authority (authority) {
        const i = authority.indexOf(':');
        if (-1 === i) {
            this.host = authority;
            this.port = 0;
        } else {
            this.host = authority.substr(0, i);
            this.port = parseInt(authority.substr(i + 1), 10) || 0;
        }
    }
    get href () {
        const query = this.query;
        const queryString = query ? `?${query}` : '';
        const fragment = this.fragment ? `#${this.fragment}` : '';
        const authority = this.authority ? `//${this.authority}` : '';
        const scheme = this.scheme ? `${this.scheme}:` : '';
        return `${scheme}${authority}${this.path}${queryString}${fragment}`;
    }
    get isRelative () {
        return !this.scheme;
    }
    get isAbsolute () {
        return !!this.scheme;
    }
    get query () {
        const queryParams = this.queryParams || {};
        return Object.keys(queryParams)
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
            .join('&');
    }
    set query (query) {
        parseQuery(this.queryParams, query);
    }
    constructor(raw : string) {
        const m = regexUri.exec(raw);
        if (m) {
            this.scheme = m[2];
            this.host = m[4];
            this.path = m[8];
            this.port = parseInt(m[7], 10) || Uri.defaultPorts[this.scheme] || 0;
            this.queryParams = {};
            this.query = (m[10] && m[10].substr(1) || '');
            this.fragment = (m[12] && m[12].substr(1) || '');
        } else {
            throw new TypeError('invalid uri');
        }
    }
    toString () { return this.href; }
}

export {
    UriDefaultPorts,
    UriQueryParams
}