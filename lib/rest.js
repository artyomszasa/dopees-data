import { Query, QuerySortDirection } from './repositories';
import * as Q from './protocol';
import { HttpError } from 'dopees-core/lib/fetch';
import * as utf8 from 'dopees-core/lib/utf8';
import { HttpClient, httpClientConfiguration } from 'dopees-core/lib/http';
import { Uri } from 'dopees-core/lib/uri';
const b64DecodeUnicode = (str) => {
    // Going backwards: from bytestream, to percent-encoding, to original string.
    return decodeURIComponent(atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
};
const checkNum = (n, message) => {
    if (n % 1 !== 0 || n <= 0) {
        throw new TypeError(message);
    }
};
export class KeyRestRepository {
    constructor(options) {
        this.options = options;
        const restMessageHandler = httpClientConfiguration.getHandler((options && options.configuration) || 'rest');
        this.clientFactory = () => new HttpClient(restMessageHandler);
    }
    get collectionEndpoint() {
        return `${this.endpoint}/${this.type}`;
    }
    get protocolVersion() {
        return this.options.protocolVersion || 2;
    }
    get type() {
        return this.options.type;
    }
    get endpoint() {
        return this.options.endpoint;
    }
    get keyProperty() {
        return this.options.keyProperty || 'id';
    }
    get items() {
        // tslint:disable-next-line:max-line-length
        return new RestQuery(this, 0, RestQuery.defaultCount, null, undefined, undefined, {}, this.options.protocolVersion);
    }
    getKey(item) {
        return item[this.keyProperty];
    }
    hasKey(item) {
        return !!this.getKey(item);
    }
    itemEndpoint(item) {
        return `${this.endpoint}/${this.type}/${this.getKey(item)}`;
    }
    __getError(response) {
        const messages = response.headers.get('X-Message');
        if (messages) {
            let text;
            try {
                text = b64DecodeUnicode(messages);
            }
            catch (exn) {
                try {
                    text = decodeURIComponent(messages);
                }
                catch (exn) {
                    text = messages;
                }
            }
            return new HttpError(response, text);
        }
        return new HttpError(response);
    }
    async lookup(key, cancellation) {
        const uri = `${this.endpoint}/${this.type}/${key}`;
        return this.clientFactory().getJson(uri, cancellation);
    }
    async update(item, cancellation) {
        if (!item) {
            throw new TypeError('unable to update empty value');
        }
        const response = await this.clientFactory().put(this.itemEndpoint(item), item, cancellation);
        if (response.ok) {
            return await this.lookup(this.getKey(item), cancellation);
        }
        throw this.__getError(response);
    }
    async insert(item, cancellation) {
        if (!item) {
            throw new TypeError('unable to insert empty value');
        }
        const response = await this.clientFactory().post(this.collectionEndpoint, item, cancellation);
        if (response.ok) {
            const uri = response.headers.get('Location');
            if (!uri) {
                throw new Error('rest insert did not return a location');
            }
            return this.clientFactory().getJson(uri, cancellation);
        }
        throw this.__getError(response);
    }
    async remove(item, cancellation) {
        const response = await this.clientFactory().delete(this.itemEndpoint(item), cancellation);
        if (200 === response.status || 202 === response.status || 204 === response.status) {
            // success;
            return;
        }
        throw this.__getError(response);
    }
    // tslint:disable-next-line:max-line-length
    async total(predicate, query, customOptions, cancellation) {
        const headers = new Headers();
        headers.append('Accept', 'application/json');
        headers.append('X-Filter', predicate);
        headers.append('X-Count', '0');
        if (query && query.query) {
            headers.append('X-Query', query.query);
            headers.append('X-SearchType', query.type || 'partial');
        }
        const customKeys = Object.keys(customOptions || {});
        customKeys.forEach((key) => {
            const value = customOptions[key];
            if (value) {
                headers.append(key, value);
            }
        });
        const response = await this.clientFactory().send({
            uri: new Uri(this.collectionEndpoint),
            headers
        }, cancellation);
        if (response.ok) {
            const header = response.headers.get('X-Total-Count');
            return header ? (parseInt(header, 10) || 0) : 0;
        }
        else {
            throw new Error(`Hiba lépett fel adatok lekérdezése közben: ${response.statusText}`);
        }
    }
    exec(offset, count, predicate, sortBy, sortByDirection, query, customOptions, cancellation) {
        const repo = this;
        let error = null;
        let items = null;
        let index = 0;
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        if (cancellation) {
                            cancellation.throwIfCancelled();
                        }
                        if (null !== error) {
                            throw error;
                        }
                        if (!items) {
                            // Első next() meghívásakor ez fut le.
                            const headers = new Headers();
                            headers.append('Accept', 'application/json');
                            headers.append('X-Offset', String(offset));
                            headers.append('X-Count', String(count));
                            headers.append('X-Filter', predicate);
                            headers.append('X-Sort-By', sortBy || '');
                            headers.append('X-Sort-By-Direction', sortByDirection || '');
                            if (query && query.query) {
                                headers.append('X-Query', query.query);
                                headers.append('X-SearchType', query.type || 'partial');
                            }
                            const customKeys = Object.keys(customOptions || {});
                            customKeys.forEach((key) => {
                                const val = (customOptions || {})[key];
                                if (val) {
                                    headers.append(key, val);
                                }
                            });
                            // const response = await fetch(repo.collectionEndpoint, { headers, signal: abortion.signal });
                            const response = await repo.clientFactory().send({
                                uri: Uri.from(repo.collectionEndpoint),
                                headers
                            }, cancellation);
                            if (response.ok && response.content) {
                                items = await response.content.json();
                            }
                            else {
                                error = new Error(`Hiba lépett fel adatok lekérdezése közben: ${response.statusText}`);
                                throw error;
                            }
                        }
                        if (!items) {
                            throw new Error('should never happen');
                        }
                        if (index >= items.length) {
                            return { done: true, value: undefined };
                        }
                        const value = items[index];
                        ++index;
                        return { done: false, value };
                    }
                };
            }
        };
    }
}
const regex = /[\0-\x08\n-\x1F\x7F-\uFFFF]/g;
export class RestQuery extends Query {
    // tslint:disable-next-line:max-line-length
    constructor(repo, offset, count, predicate, sortBy, sortByDirection, customOptions, protocolVersion) {
        super();
        this.repo = repo;
        this.offset = offset || 0;
        this.count = 0 === count ? count : (count || RestQuery.defaultCount);
        this.predicate = predicate || null;
        this.sortBy = sortBy || '';
        this.sortByDirection = sortByDirection || QuerySortDirection.Asc;
        this.customOptions = customOptions || {};
        this.protocolVersion = protocolVersion || 2;
    }
    escape(input) {
        if (!input) {
            return '';
        }
        const inp = input instanceof Q.Expr ? this.applyProtocol(input).toString() : input;
        return utf8
            .utf8encode(inp)
            .replace(regex, (m) => '%' + ('0' + m.charCodeAt(0).toString(16).toUpperCase()).slice(-2));
    }
    applyProtocol(expr) {
        if (this.protocolVersion < 2 && expr instanceof Q.Lambda) {
            const param = expr.param;
            return expr.body.accept({
                visitConst(c) { return c; },
                visitParam(p) { return p; },
                // tslint:disable-next-line:max-line-length
                visitProp(p) { return p.instance.eq(param) ? new Q.Param(p.name) : new Q.Prop(p.instance.accept(this), p.name); },
                visitBinary(b) { return new Q.BinOp(b.left.accept(this), b.op, b.right.accept(this)); },
                visitUnary(u) { return new Q.UnOp(u.op, u.operand.accept(this)); },
                visitCall(c) { return new Q.Call(c.name, c.args.map((arg) => arg.accept(this))); },
                visitLambda(l) { return new Q.Lambda(l.body.accept(this), l.param); }
            });
        }
        return expr;
    }
    extractV1Query(expr) {
        const q = {};
        const v1Expr = expr.accept({
            visitConst(c) { return c; },
            visitParam(p) { return p; },
            visitProp(p) { return new Q.Prop(p.instance.accept(this), p.name); },
            visitBinary(b) {
                const l = b.left.accept(this);
                const r = b.right.accept(this);
                if (l instanceof Q.Const && (l.value === true || l.value === 'true')) {
                    return r;
                }
                if (r instanceof Q.Const && (r.value === true || r.value === 'true')) {
                    return l;
                }
                return new Q.BinOp(l, b.op, r);
            },
            visitUnary(u) { return new Q.UnOp(u.op, u.operand.accept(this)); },
            visitCall(c) {
                if ('partialMatch' === c.name && 2 === c.args.length) {
                    const arg = c.args[1];
                    if (arg instanceof Q.Const && arg.value) {
                        q.query = arg.value;
                        return new Q.Const(true);
                    }
                    throw new Error('not supported partial match in protocol v1');
                }
                return new Q.Call(c.name, c.args.map((arg) => arg.accept(this)));
            },
            visitLambda(l) { return new Q.Lambda(l.body.accept(this), l.param); }
        });
        return {
            expr: v1Expr,
            query: q
        };
    }
    get escapedPredicate() {
        return this.escape(this.predicate);
    }
    get escapedSortBy() {
        return this.escape(this.sortBy);
    }
    filter(predicate) {
        const p = 'string' === typeof predicate ? Q.parse(predicate) : predicate;
        if (!(p instanceof Q.Lambda)) {
            throw TypeError('predicate must be a lambda expression');
        }
        return new RestQuery(this.repo, this.offset, this.count, this.predicate ? this.predicate.and(p) : p, this.sortBy, this.sortByDirection, this.customOptions, this.protocolVersion);
    }
    skip(n) {
        if (0 === n) {
            return this;
        }
        checkNum(n, 'skip parameter must be non-negative whole number.');
        return new RestQuery(this.repo, n, // TODO: Ezt végig kell gondolni, mert lehet (this.offset + n) kellene ide?
        this.count, this.predicate, this.sortBy, this.sortByDirection, this.customOptions, this.protocolVersion);
    }
    take(n) {
        checkNum(n, 'take parameter must be non-negative whole number.');
        return new RestQuery(this.repo, this.offset, n, this.predicate, this.sortBy, this.sortByDirection, this.customOptions, this.protocolVersion);
    }
    orderBy(selector, direction) {
        return new RestQuery(this.repo, this.offset, this.count, this.predicate, selector, direction || QuerySortDirection.Asc, this.customOptions, this.protocolVersion);
    }
    setCustomOptions(options, replace) {
        const opts = replace ? (options || {}) : Object.assign({}, this.customOptions, options);
        return new RestQuery(this.repo, this.offset, this.count, this.predicate, this.sortBy, this.sortByDirection, opts, this.protocolVersion);
    }
    async total(cancellation) {
        let predicate;
        let v1Query;
        if (!this.predicate) {
            predicate = '';
        }
        else {
            if (this.protocolVersion < 2) {
                const data = this.extractV1Query(this.predicate);
                predicate = this.escape(data.expr);
                v1Query = data.query;
                if (predicate && predicate.startsWith('(') && predicate.endsWith(')')) {
                    predicate = predicate.substr(1, predicate.length - 2);
                }
            }
            else {
                predicate = this.escape(this.predicate);
            }
        }
        return this.repo.total(predicate, v1Query, this.customOptions, cancellation);
    }
    exec() {
        let predicate;
        let v1Query;
        if (!this.predicate) {
            predicate = '';
        }
        else {
            if (this.protocolVersion < 2) {
                const data = this.extractV1Query(this.predicate);
                predicate = this.escape(data.expr);
                v1Query = data.query;
                if (predicate && predicate.startsWith('(') && predicate.endsWith(')')) {
                    predicate = predicate.substr(1, predicate.length - 2);
                }
            }
            else {
                predicate = this.escape(this.predicate);
            }
        }
        // tslint:disable-next-line:max-line-length
        return this.repo.exec(this.offset, this.count, predicate, this.sortBy, this.sortByDirection, v1Query, this.customOptions);
    }
}
RestQuery.defaultCount = 100000;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxLQUFLLEVBQWMsa0JBQWtCLEVBQWlCLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEYsT0FBTyxLQUFLLENBQUMsTUFBTSxZQUFZLENBQUM7QUFDaEMsT0FBTyxFQUEyQixTQUFTLEVBQWdCLE1BQU0sdUJBQXVCLENBQUM7QUFDekYsT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsQ0FBQztBQUU3QyxPQUFPLEVBQUUsVUFBVSxFQUFFLHVCQUF1QixFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDM0UsT0FBTyxFQUFFLEdBQUcsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBRTFDLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxHQUFXLEVBQUUsRUFBRTtJQUN2Qyw2RUFBNkU7SUFDN0UsT0FBTyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxVQUFTLENBQUM7UUFDeEQsT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNqRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNmLENBQUMsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBUyxFQUFFLE9BQWUsRUFBRSxFQUFFO0lBQzlDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6QixNQUFNLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0tBQzlCO0FBQ0gsQ0FBQyxDQUFDO0FBb0NGLE1BQU0sT0FBTyxpQkFBaUI7SUFJNUIsWUFBWSxPQUE4QjtRQUN4QyxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztRQUN2QixNQUFNLGtCQUFrQixHQUFHLHVCQUF1QixDQUFDLFVBQVUsQ0FBQyxDQUFDLE9BQU8sSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLElBQUksTUFBTSxDQUFDLENBQUM7UUFDNUcsSUFBSSxDQUFDLGFBQWEsR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO0lBQ2hFLENBQUM7SUFFRCxJQUFZLGtCQUFrQjtRQUM1QixPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDekMsQ0FBQztJQUVELElBQUksZUFBZTtRQUNqQixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsZUFBZSxJQUFJLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBRUQsSUFBSSxJQUFJO1FBQ04sT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQztJQUMzQixDQUFDO0lBRUQsSUFBSSxRQUFRO1FBQ1YsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQztJQUMvQixDQUFDO0lBRUQsSUFBSSxXQUFXO1FBQ2IsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUM7SUFDMUMsQ0FBQztJQUVELElBQUksS0FBSztRQUNQLDJDQUEyQztRQUMzQyxPQUFPLElBQUksU0FBUyxDQUFRLElBQUksRUFBRSxDQUFDLEVBQUUsU0FBUyxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUM3SCxDQUFDO0lBRVMsTUFBTSxDQUFDLElBQVc7UUFDMUIsT0FBUSxJQUFZLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBUyxDQUFDO0lBQ2pELENBQUM7SUFFTyxNQUFNLENBQUMsSUFBVztRQUN4QixPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzdCLENBQUM7SUFFTyxZQUFZLENBQUMsSUFBVztRQUM5QixPQUFPLEdBQUcsSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUM5RCxDQUFDO0lBRU8sVUFBVSxDQUFDLFFBQXNCO1FBQ3ZDLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ25ELElBQUksUUFBUSxFQUFFO1lBQ1osSUFBSSxJQUFZLENBQUM7WUFDakIsSUFBSTtnQkFDRixJQUFJLEdBQUcsZ0JBQWdCLENBQUMsUUFBUSxDQUFDLENBQUM7YUFDbkM7WUFBQyxPQUFPLEdBQUcsRUFBRTtnQkFDWixJQUFJO29CQUNGLElBQUksR0FBRyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsQ0FBQztpQkFDckM7Z0JBQUMsT0FBTyxHQUFHLEVBQUU7b0JBQ1osSUFBSSxHQUFHLFFBQVEsQ0FBQztpQkFDakI7YUFDRjtZQUNELE9BQU8sSUFBSSxTQUFTLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO1NBQ3RDO1FBQ0QsT0FBTyxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFTLEVBQUUsWUFBMkI7UUFDakQsTUFBTSxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxJQUFJLElBQUksR0FBRyxFQUFFLENBQUM7UUFDbkQsT0FBTyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsT0FBTyxDQUFDLEdBQUcsRUFBRSxZQUFZLENBQUMsQ0FBQztJQUN6RCxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFXLEVBQUUsWUFBMkI7UUFDbkQsSUFBSSxDQUFDLElBQUksRUFBRTtZQUNULE1BQU0sSUFBSSxTQUFTLENBQUMsOEJBQThCLENBQUMsQ0FBQztTQUNyRDtRQUNELE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFRLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQztRQUNuRyxJQUFJLFFBQVEsQ0FBQyxFQUFFLEVBQUU7WUFDZixPQUFPLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLFlBQVksQ0FBQyxDQUFDO1NBQzNEO1FBQ0QsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2xDLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTSxDQUFDLElBQVcsRUFBRSxZQUEwQjtRQUNsRCxJQUFJLENBQUMsSUFBSSxFQUFFO1lBQ1QsTUFBTSxJQUFJLFNBQVMsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO1NBQ3JEO1FBQ0QsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBUSxJQUFJLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFDcEcsSUFBSSxRQUFRLENBQUMsRUFBRSxFQUFFO1lBQ2YsTUFBTSxHQUFHLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDN0MsSUFBSSxDQUFDLEdBQUcsRUFBRTtnQkFDUixNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7YUFDMUQ7WUFDRCxPQUFPLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLFlBQVksQ0FBQyxDQUFDO1NBQ3hEO1FBQ0QsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2xDLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTSxDQUFDLElBQVcsRUFBRSxZQUEwQjtRQUNsRCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsRUFBRSxZQUFZLENBQUMsQ0FBQztRQUMxRixJQUFJLEdBQUcsS0FBSyxRQUFRLENBQUMsTUFBTSxJQUFJLEdBQUcsS0FBSyxRQUFRLENBQUMsTUFBTSxJQUFJLEdBQUcsS0FBSyxRQUFRLENBQUMsTUFBTSxFQUFFO1lBQ2pGLFdBQVc7WUFDWCxPQUFPO1NBQ1I7UUFDRCxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVELDJDQUEyQztJQUMzQyxLQUFLLENBQUMsS0FBSyxDQUFDLFNBQWlCLEVBQUUsS0FBd0IsRUFBRSxhQUFrRCxFQUFFLFlBQTBCO1FBQ3JJLE1BQU0sT0FBTyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUM7UUFDOUIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztRQUM3QyxPQUFPLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUN0QyxPQUFPLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUMvQixJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFO1lBQ3hCLE9BQU8sQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUN2QyxPQUFPLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUMsSUFBSSxJQUFJLFNBQVMsQ0FBQyxDQUFDO1NBQ3pEO1FBQ0QsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDLENBQUM7UUFDcEQsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3pCLE1BQU0sS0FBSyxHQUFHLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqQyxJQUFJLEtBQUssRUFBRTtnQkFDVCxPQUFPLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQzthQUM1QjtRQUNILENBQUMsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsSUFBSSxDQUFDO1lBQy9DLEdBQUcsRUFBRSxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUM7WUFDckMsT0FBTztTQUNSLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFDakIsSUFBSSxRQUFRLENBQUMsRUFBRSxFQUFFO1lBQ2YsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDckQsT0FBTyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQ2pEO2FBQU07WUFDTCxNQUFNLElBQUksS0FBSyxDQUFDLDhDQUE4QyxRQUFRLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztTQUN0RjtJQUNILENBQUM7SUFFRCxJQUFJLENBQ0YsTUFBYyxFQUNkLEtBQWEsRUFDYixTQUFpQixFQUNqQixNQUFlLEVBQ2YsZUFBb0MsRUFDcEMsS0FBZSxFQUNmLGFBQW1ELEVBQ25ELFlBQTJCO1FBRTNCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQztRQUNsQixJQUFJLEtBQUssR0FBUSxJQUFJLENBQUM7UUFDdEIsSUFBSSxLQUFLLEdBQWlCLElBQUksQ0FBQztRQUMvQixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7UUFDZCxPQUFPO1lBQ0wsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDO2dCQUNwQixPQUFPO29CQUNMLEtBQUssQ0FBQyxJQUFJO3dCQUNSLElBQUksWUFBWSxFQUFFOzRCQUNoQixZQUFZLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQzt5QkFDakM7d0JBQ0QsSUFBSSxJQUFJLEtBQUssS0FBSyxFQUFFOzRCQUNsQixNQUFNLEtBQUssQ0FBQzt5QkFDYjt3QkFDRCxJQUFJLENBQUMsS0FBSyxFQUFFOzRCQUNWLHNDQUFzQzs0QkFDdEMsTUFBTSxPQUFPLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQzs0QkFDOUIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsa0JBQWtCLENBQUMsQ0FBQzs0QkFDN0MsT0FBTyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7NEJBQzNDLE9BQU8sQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDOzRCQUN6QyxPQUFPLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxTQUFTLENBQUMsQ0FBQzs0QkFDdEMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDOzRCQUMxQyxPQUFPLENBQUMsTUFBTSxDQUFDLHFCQUFxQixFQUFFLGVBQWUsSUFBSSxFQUFFLENBQUMsQ0FBQzs0QkFDN0QsSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLEtBQUssRUFBRTtnQ0FDeEIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUUsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dDQUN2QyxPQUFPLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUMsSUFBSSxJQUFJLFNBQVMsQ0FBQyxDQUFDOzZCQUN6RDs0QkFDRCxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUMsQ0FBQzs0QkFDcEQsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFO2dDQUN6QixNQUFNLEdBQUcsR0FBRyxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQ0FDdkMsSUFBSSxHQUFHLEVBQUU7b0NBQ1AsT0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7aUNBQzFCOzRCQUNILENBQUMsQ0FBQyxDQUFDOzRCQUNILCtGQUErRjs0QkFDL0YsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsSUFBSSxDQUFDO2dDQUMvQyxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUM7Z0NBQ3RDLE9BQU87NkJBQ1IsRUFBRSxZQUFZLENBQUMsQ0FBQzs0QkFDakIsSUFBSSxRQUFRLENBQUMsRUFBRSxJQUFJLFFBQVEsQ0FBQyxPQUFPLEVBQUU7Z0NBQ25DLEtBQUssR0FBRyxNQUFNLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7NkJBQ3ZDO2lDQUFNO2dDQUNMLEtBQUssR0FBRyxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0NBQ3ZGLE1BQU0sS0FBSyxDQUFDOzZCQUNiO3lCQUNGO3dCQUNELElBQUksQ0FBQyxLQUFLLEVBQUU7NEJBQ1YsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO3lCQUN4Qzt3QkFDRCxJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFOzRCQUN6QixPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQVEsU0FBUyxFQUFFLENBQUM7eUJBQy9DO3dCQUNELE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQzt3QkFDM0IsRUFBRSxLQUFLLENBQUM7d0JBQ1IsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUM7b0JBQ2hDLENBQUM7aUJBQ0YsQ0FBQztZQUNKLENBQUM7U0FDRixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBRUQsTUFBTSxLQUFLLEdBQUcsOEJBQThCLENBQUM7QUFFN0MsTUFBTSxPQUFPLFNBQWEsU0FBUSxLQUFRO0lBVXhDLDJDQUEyQztJQUMzQyxZQUFZLElBQXVCLEVBQUUsTUFBYyxFQUFFLEtBQWEsRUFBRSxTQUF5QixFQUFFLE1BQWUsRUFBRSxlQUFvQyxFQUFFLGFBQW1ELEVBQUUsZUFBd0I7UUFDak8sS0FBSyxFQUFFLENBQUM7UUFDUixJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztRQUNqQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLENBQUM7UUFDMUIsSUFBSSxDQUFDLEtBQUssR0FBRyxDQUFDLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUNyRSxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsSUFBSSxJQUFJLENBQUM7UUFDbkMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLElBQUksRUFBRSxDQUFDO1FBQzNCLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxJQUFJLGtCQUFrQixDQUFDLEdBQUcsQ0FBQztRQUNqRSxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsSUFBSSxFQUFFLENBQUM7UUFDekMsSUFBSSxDQUFDLGVBQWUsR0FBRyxlQUFlLElBQUksQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFDTyxNQUFNLENBQUMsS0FBeUI7UUFDdEMsSUFBSSxDQUFDLEtBQUssRUFBRTtZQUNWLE9BQU8sRUFBRSxDQUFDO1NBQ1g7UUFDRCxNQUFNLEdBQUcsR0FBRyxLQUFLLFlBQVksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBQ25GLE9BQU8sSUFBSTthQUNSLFVBQVUsQ0FBQyxHQUFHLENBQUM7YUFDZixPQUFPLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQy9GLENBQUM7SUFFTyxhQUFhLENBQUMsSUFBWTtRQUNoQyxJQUFJLElBQUksQ0FBQyxlQUFlLEdBQUcsQ0FBQyxJQUFJLElBQUksWUFBWSxDQUFDLENBQUMsTUFBTSxFQUFFO1lBQ3hELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7WUFDekIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBUztnQkFDOUIsVUFBVSxDQUFDLENBQUMsSUFBSSxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQzNCLFVBQVUsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUMzQiwyQ0FBMkM7Z0JBQzNDLFNBQVMsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3ZILFdBQVcsQ0FBQyxDQUFDLElBQUksT0FBTyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDdkYsVUFBVSxDQUFDLENBQUMsSUFBSSxPQUFPLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNsRSxTQUFTLENBQUMsQ0FBQyxJQUFJLE9BQU8sSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDbEYsV0FBVyxDQUFDLENBQUMsSUFBSSxPQUFPLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO2FBQ3RFLENBQUMsQ0FBQztTQUNKO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU8sY0FBYyxDQUFDLElBQVk7UUFDakMsTUFBTSxDQUFDLEdBQXVCLEVBQUUsQ0FBQztRQUNqQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFTO1lBQ2pDLFVBQVUsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNCLFVBQVUsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNCLFNBQVMsQ0FBQyxDQUFDLElBQUksT0FBTyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNwRSxXQUFXLENBQUMsQ0FBQztnQkFDWCxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDOUIsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQy9CLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxLQUFLLElBQUksQ0FBTyxDQUFDLENBQUMsS0FBSyxLQUFLLElBQUksSUFBVSxDQUFDLENBQUMsS0FBSyxLQUFLLE1BQU0sQ0FBQyxFQUFFO29CQUM5RSxPQUFPLENBQUMsQ0FBQztpQkFDWjtnQkFDRCxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsS0FBSyxJQUFJLENBQU8sQ0FBQyxDQUFDLEtBQUssS0FBSyxJQUFJLElBQVUsQ0FBQyxDQUFDLEtBQUssS0FBSyxNQUFNLENBQUMsRUFBRTtvQkFDOUUsT0FBTyxDQUFDLENBQUM7aUJBQ1o7Z0JBQ0QsT0FBTyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDakMsQ0FBQztZQUNELFVBQVUsQ0FBQyxDQUFDLElBQUksT0FBTyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNsRSxTQUFTLENBQUMsQ0FBQztnQkFDVCxJQUFJLGNBQWMsS0FBSyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRTtvQkFDcEQsTUFBTSxHQUFHLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDdEIsSUFBSSxHQUFHLFlBQVksQ0FBQyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsS0FBSyxFQUFFO3dCQUN2QyxDQUFDLENBQUMsS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUM7d0JBQ3BCLE9BQU8sSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFPLElBQUksQ0FBQyxDQUFDO3FCQUNoQztvQkFDRCxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7aUJBQy9EO2dCQUNELE9BQU8sSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ25FLENBQUM7WUFDRCxXQUFXLENBQUMsQ0FBQyxJQUFJLE9BQU8sSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDdEUsQ0FBQyxDQUFDO1FBQ0gsT0FBTztZQUNILElBQUksRUFBRSxNQUFNO1lBQ1osS0FBSyxFQUFFLENBQUM7U0FDWCxDQUFDO0lBQ0osQ0FBQztJQUVELElBQUksZ0JBQWdCO1FBQ2xCLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDckMsQ0FBQztJQUNELElBQUksYUFBYTtRQUNmLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUNELE1BQU0sQ0FBQyxTQUEwQjtRQUMvQixNQUFNLENBQUMsR0FBRyxRQUFRLEtBQUssT0FBTyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUN6RSxJQUFJLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQzVCLE1BQU0sU0FBUyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7U0FDMUQ7UUFDRCxPQUFPLElBQUksU0FBUyxDQUNsQixJQUFJLENBQUMsSUFBSSxFQUNULElBQUksQ0FBQyxNQUFNLEVBQ1gsSUFBSSxDQUFDLEtBQUssRUFDVixJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUMxQyxJQUFJLENBQUMsTUFBTSxFQUNYLElBQUksQ0FBQyxlQUFlLEVBQ3BCLElBQUksQ0FBQyxhQUFhLEVBQ2xCLElBQUksQ0FBQyxlQUFlLENBQ3JCLENBQUM7SUFDSixDQUFDO0lBQ0QsSUFBSSxDQUFDLENBQVM7UUFDWixJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUU7WUFDWCxPQUFPLElBQUksQ0FBQztTQUNiO1FBQ0QsUUFBUSxDQUFDLENBQUMsRUFBRSxtREFBbUQsQ0FBQyxDQUFDO1FBQ2pFLE9BQU8sSUFBSSxTQUFTLENBQ2xCLElBQUksQ0FBQyxJQUFJLEVBQ1QsQ0FBQyxFQUFFLDJFQUEyRTtRQUM5RSxJQUFJLENBQUMsS0FBSyxFQUNWLElBQUksQ0FBQyxTQUFTLEVBQ2QsSUFBSSxDQUFDLE1BQU0sRUFDWCxJQUFJLENBQUMsZUFBZSxFQUNwQixJQUFJLENBQUMsYUFBYSxFQUNsQixJQUFJLENBQUMsZUFBZSxDQUNyQixDQUFDO0lBQ0osQ0FBQztJQUNELElBQUksQ0FBQyxDQUFTO1FBQ1osUUFBUSxDQUFDLENBQUMsRUFBRSxtREFBbUQsQ0FBQyxDQUFDO1FBQ2pFLE9BQU8sSUFBSSxTQUFTLENBQ2xCLElBQUksQ0FBQyxJQUFJLEVBQ1QsSUFBSSxDQUFDLE1BQU0sRUFDWCxDQUFDLEVBQ0QsSUFBSSxDQUFDLFNBQVMsRUFDZCxJQUFJLENBQUMsTUFBTSxFQUNYLElBQUksQ0FBQyxlQUFlLEVBQ3BCLElBQUksQ0FBQyxhQUFhLEVBQ2xCLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUMxQixDQUFDO0lBQ0QsT0FBTyxDQUFDLFFBQWdCLEVBQUUsU0FBOEI7UUFDdEQsT0FBTyxJQUFJLFNBQVMsQ0FDbEIsSUFBSSxDQUFDLElBQUksRUFDVCxJQUFJLENBQUMsTUFBTSxFQUNYLElBQUksQ0FBQyxLQUFLLEVBQ1YsSUFBSSxDQUFDLFNBQVMsRUFDZCxRQUFRLEVBQ1IsU0FBUyxJQUFJLGtCQUFrQixDQUFDLEdBQUcsRUFDbkMsSUFBSSxDQUFDLGFBQWEsRUFDbEIsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO0lBQzFCLENBQUM7SUFDRCxnQkFBZ0IsQ0FBQyxPQUE0QyxFQUFFLE9BQWlCO1FBQzlFLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDeEYsT0FBTyxJQUFJLFNBQVMsQ0FDbEIsSUFBSSxDQUFDLElBQUksRUFDVCxJQUFJLENBQUMsTUFBTSxFQUNYLElBQUksQ0FBQyxLQUFLLEVBQ1YsSUFBSSxDQUFDLFNBQVMsRUFDZCxJQUFJLENBQUMsTUFBTSxFQUNYLElBQUksQ0FBQyxlQUFlLEVBQ3BCLElBQUksRUFDSixJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7SUFDMUIsQ0FBQztJQUNELEtBQUssQ0FBQyxLQUFLLENBQUMsWUFBMEI7UUFDcEMsSUFBSSxTQUFpQixDQUFDO1FBQ3RCLElBQUksT0FBMEIsQ0FBQztRQUMvQixJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUNuQixTQUFTLEdBQUcsRUFBRSxDQUFDO1NBQ2hCO2FBQU07WUFDTCxJQUFJLElBQUksQ0FBQyxlQUFlLEdBQUcsQ0FBQyxFQUFFO2dCQUM1QixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDakQsU0FBUyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNuQyxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFDckIsSUFBSSxTQUFTLElBQUksU0FBUyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFO29CQUNyRSxTQUFTLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztpQkFDdkQ7YUFDRjtpQkFBTTtnQkFDTCxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7YUFDekM7U0FDRjtRQUNELE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsYUFBYSxFQUFFLFlBQVksQ0FBQyxDQUFDO0lBQy9FLENBQUM7SUFDRCxJQUFJO1FBQ0YsSUFBSSxTQUFpQixDQUFDO1FBQ3RCLElBQUksT0FBMEIsQ0FBQztRQUMvQixJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUNuQixTQUFTLEdBQUcsRUFBRSxDQUFDO1NBQ2hCO2FBQU07WUFDTCxJQUFJLElBQUksQ0FBQyxlQUFlLEdBQUcsQ0FBQyxFQUFFO2dCQUM1QixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDakQsU0FBUyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNuQyxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFDckIsSUFBSSxTQUFTLElBQUksU0FBUyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFO29CQUNyRSxTQUFTLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztpQkFDdkQ7YUFDRjtpQkFBTTtnQkFDTCxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7YUFDekM7U0FDRjtRQUNELDJDQUEyQztRQUMzQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsZUFBZSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDNUgsQ0FBQzs7QUFwTU0sc0JBQVksR0FBRyxNQUFNLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBRdWVyeSwgUmVwb3NpdG9yeSwgUXVlcnlTb3J0RGlyZWN0aW9uLCBLZXlSZXBvc2l0b3J5IH0gZnJvbSAnLi9yZXBvc2l0b3JpZXMnO1xuaW1wb3J0ICogYXMgUSBmcm9tICcuL3Byb3RvY29sJztcbmltcG9ydCB7IGRlY29yYXRlZEZldGNoIGFzIGZldGNoLCBIdHRwRXJyb3IsIFJlc3BvbnNlTGlrZSB9IGZyb20gJ2RvcGVlcy1jb3JlL2xpYi9mZXRjaCc7XG5pbXBvcnQgKiBhcyB1dGY4IGZyb20gJ2RvcGVlcy1jb3JlL2xpYi91dGY4JztcbmltcG9ydCB7IENhbmNlbGxhdGlvbiB9IGZyb20gJ2RvcGVlcy1jb3JlL2xpYi9jYW5jZWxsYXRpb24nO1xuaW1wb3J0IHsgSHR0cENsaWVudCwgaHR0cENsaWVudENvbmZpZ3VyYXRpb24gfSBmcm9tICdkb3BlZXMtY29yZS9saWIvaHR0cCc7XG5pbXBvcnQgeyBVcmkgfSBmcm9tICdkb3BlZXMtY29yZS9saWIvdXJpJztcblxuY29uc3QgYjY0RGVjb2RlVW5pY29kZSA9IChzdHI6IHN0cmluZykgPT4ge1xuICAvLyBHb2luZyBiYWNrd2FyZHM6IGZyb20gYnl0ZXN0cmVhbSwgdG8gcGVyY2VudC1lbmNvZGluZywgdG8gb3JpZ2luYWwgc3RyaW5nLlxuICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGF0b2Ioc3RyKS5zcGxpdCgnJykubWFwKGZ1bmN0aW9uKGMpIHtcbiAgICAgIHJldHVybiAnJScgKyAoJzAwJyArIGMuY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikpLnNsaWNlKC0yKTtcbiAgfSkuam9pbignJykpO1xufTtcblxuY29uc3QgY2hlY2tOdW0gPSAobjogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpID0+IHtcbiAgaWYgKG4gJSAxICE9PSAwIHx8IG4gPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IobWVzc2FnZSk7XG4gIH1cbn07XG5cbmludGVyZmFjZSBSZXN0UmVwb3NpdG9yeU9wdGlvbnMge1xuICB0eXBlOiBzdHJpbmc7XG4gIGVuZHBvaW50OiBzdHJpbmc7XG4gIGtleVByb3BlcnR5Pzogc3RyaW5nO1xuICBwcm90b2NvbFZlcnNpb24/OiBudW1iZXI7XG4gIGNvbmZpZ3VyYXRpb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVjFRdWVyeSB7XG4gIHF1ZXJ5Pzogc3RyaW5nO1xuICB0eXBlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc3RSZXBvc2l0b3J5PFQ+IGV4dGVuZHMgUmVwb3NpdG9yeTxUPiB7XG4gIGV4ZWMoXG4gICAgb2Zmc2V0OiBudW1iZXIsXG4gICAgY291bnQ6IG51bWJlcixcbiAgICBwcmVkaWNhdGU6IHN0cmluZyxcbiAgICBzb3J0Qnk/OiBzdHJpbmcsXG4gICAgc29ydEJ5RGlyZWN0aW9uPzpcbiAgICBRdWVyeVNvcnREaXJlY3Rpb24sXG4gICAgcXVlcnk/OiBWMVF1ZXJ5LFxuICAgIGN1c3RvbU9wdGlvbnM/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfSxcbiAgICBjYW5jZWxsYXRpb24/OiBDYW5jZWxsYXRpb25cbiAgKTogQXN5bmNJdGVyYWJsZTxUPjtcblxuICB0b3RhbChcbiAgICBwcmVkaWNhdGU6IHN0cmluZyxcbiAgICBxdWVyeTogVjFRdWVyeXx1bmRlZmluZWQsXG4gICAgY3VzdG9tT3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sXG4gICAgY2FuY2VsbGF0aW9uOiBDYW5jZWxsYXRpb25cbiAgKTogUHJvbWlzZTxudW1iZXI+O1xufVxuXG5leHBvcnQgY2xhc3MgS2V5UmVzdFJlcG9zaXRvcnk8VERhdGEsIFRLZXk+IGltcGxlbWVudHMgS2V5UmVwb3NpdG9yeTxURGF0YSwgVEtleT4sIFJlc3RSZXBvc2l0b3J5PFREYXRhPiB7XG4gIHJlYWRvbmx5IGNsaWVudEZhY3Rvcnk6ICgpID0+IEh0dHBDbGllbnQ7XG4gIHJlYWRvbmx5IG9wdGlvbnM6IFJlc3RSZXBvc2l0b3J5T3B0aW9ucztcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBSZXN0UmVwb3NpdG9yeU9wdGlvbnMpIHtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIGNvbnN0IHJlc3RNZXNzYWdlSGFuZGxlciA9IGh0dHBDbGllbnRDb25maWd1cmF0aW9uLmdldEhhbmRsZXIoKG9wdGlvbnMgJiYgb3B0aW9ucy5jb25maWd1cmF0aW9uKSB8fCAncmVzdCcpO1xuICAgIHRoaXMuY2xpZW50RmFjdG9yeSA9ICgpID0+IG5ldyBIdHRwQ2xpZW50KHJlc3RNZXNzYWdlSGFuZGxlcik7XG4gIH1cblxuICBwcml2YXRlIGdldCBjb2xsZWN0aW9uRW5kcG9pbnQoKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuZW5kcG9pbnR9LyR7dGhpcy50eXBlfWA7XG4gIH1cblxuICBnZXQgcHJvdG9jb2xWZXJzaW9uKCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMucHJvdG9jb2xWZXJzaW9uIHx8IDI7XG4gIH1cblxuICBnZXQgdHlwZSgpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLnR5cGU7XG4gIH1cblxuICBnZXQgZW5kcG9pbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5lbmRwb2ludDtcbiAgfVxuXG4gIGdldCBrZXlQcm9wZXJ0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLmtleVByb3BlcnR5IHx8ICdpZCc7XG4gIH1cblxuICBnZXQgaXRlbXMoKTogUXVlcnk8VERhdGE+IHtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bWF4LWxpbmUtbGVuZ3RoXG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VERhdGE+KHRoaXMsIDAsIFJlc3RRdWVyeS5kZWZhdWx0Q291bnQsIG51bGwsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB7fSwgdGhpcy5vcHRpb25zLnByb3RvY29sVmVyc2lvbik7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0S2V5KGl0ZW06IFREYXRhKSB7XG4gICAgcmV0dXJuIChpdGVtIGFzIGFueSlbdGhpcy5rZXlQcm9wZXJ0eV0gYXMgVEtleTtcbiAgfVxuXG4gIHByaXZhdGUgaGFzS2V5KGl0ZW06IFREYXRhKSB7XG4gICAgcmV0dXJuICEhdGhpcy5nZXRLZXkoaXRlbSk7XG4gIH1cblxuICBwcml2YXRlIGl0ZW1FbmRwb2ludChpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX0vJHt0aGlzLmdldEtleShpdGVtKX1gO1xuICB9XG5cbiAgcHJpdmF0ZSBfX2dldEVycm9yKHJlc3BvbnNlOiBSZXNwb25zZUxpa2UpOiBIdHRwRXJyb3Ige1xuICAgIGNvbnN0IG1lc3NhZ2VzID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoJ1gtTWVzc2FnZScpO1xuICAgIGlmIChtZXNzYWdlcykge1xuICAgICAgbGV0IHRleHQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIHRleHQgPSBiNjREZWNvZGVVbmljb2RlKG1lc3NhZ2VzKTtcbiAgICAgIH0gY2F0Y2ggKGV4bikge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRleHQgPSBkZWNvZGVVUklDb21wb25lbnQobWVzc2FnZXMpO1xuICAgICAgICB9IGNhdGNoIChleG4pIHtcbiAgICAgICAgICB0ZXh0ID0gbWVzc2FnZXM7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgSHR0cEVycm9yKHJlc3BvbnNlLCB0ZXh0KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBIdHRwRXJyb3IocmVzcG9uc2UpO1xuICB9XG5cbiAgYXN5bmMgbG9va3VwKGtleTogVEtleSwgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGNvbnN0IHVyaSA9IGAke3RoaXMuZW5kcG9pbnR9LyR7dGhpcy50eXBlfS8ke2tleX1gO1xuICAgIHJldHVybiB0aGlzLmNsaWVudEZhY3RvcnkoKS5nZXRKc29uKHVyaSwgY2FuY2VsbGF0aW9uKTtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZShpdGVtOiBURGF0YSwgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGlmICghaXRlbSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndW5hYmxlIHRvIHVwZGF0ZSBlbXB0eSB2YWx1ZScpO1xuICAgIH1cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2xpZW50RmFjdG9yeSgpLnB1dCh0aGlzLml0ZW1FbmRwb2ludChpdGVtKSwgPGFueT4gaXRlbSwgY2FuY2VsbGF0aW9uKTtcbiAgICBpZiAocmVzcG9uc2Uub2spIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvb2t1cCh0aGlzLmdldEtleShpdGVtKSwgY2FuY2VsbGF0aW9uKTtcbiAgICB9XG4gICAgdGhyb3cgdGhpcy5fX2dldEVycm9yKHJlc3BvbnNlKTtcbiAgfVxuXG4gIGFzeW5jIGluc2VydChpdGVtOiBURGF0YSwgY2FuY2VsbGF0aW9uOiBDYW5jZWxsYXRpb24pOiBQcm9taXNlPFREYXRhPiB7XG4gICAgaWYgKCFpdGVtKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1bmFibGUgdG8gaW5zZXJ0IGVtcHR5IHZhbHVlJyk7XG4gICAgfVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnRGYWN0b3J5KCkucG9zdCh0aGlzLmNvbGxlY3Rpb25FbmRwb2ludCwgPGFueT4gaXRlbSwgY2FuY2VsbGF0aW9uKTtcbiAgICBpZiAocmVzcG9uc2Uub2spIHtcbiAgICAgIGNvbnN0IHVyaSA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdMb2NhdGlvbicpO1xuICAgICAgaWYgKCF1cmkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdyZXN0IGluc2VydCBkaWQgbm90IHJldHVybiBhIGxvY2F0aW9uJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5jbGllbnRGYWN0b3J5KCkuZ2V0SnNvbih1cmksIGNhbmNlbGxhdGlvbik7XG4gICAgfVxuICAgIHRocm93IHRoaXMuX19nZXRFcnJvcihyZXNwb25zZSk7XG4gIH1cblxuICBhc3luYyByZW1vdmUoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNsaWVudEZhY3RvcnkoKS5kZWxldGUodGhpcy5pdGVtRW5kcG9pbnQoaXRlbSksIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKDIwMCA9PT0gcmVzcG9uc2Uuc3RhdHVzIHx8IDIwMiA9PT0gcmVzcG9uc2Uuc3RhdHVzIHx8IDIwNCA9PT0gcmVzcG9uc2Uuc3RhdHVzKSB7XG4gICAgICAvLyBzdWNjZXNzO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aHJvdyB0aGlzLl9fZ2V0RXJyb3IocmVzcG9uc2UpO1xuICB9XG5cbiAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICBhc3luYyB0b3RhbChwcmVkaWNhdGU6IHN0cmluZywgcXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkLCBjdXN0b21PcHRpb25zOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfSwgY2FuY2VsbGF0aW9uOiBDYW5jZWxsYXRpb24pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IGhlYWRlcnMgPSBuZXcgSGVhZGVycygpO1xuICAgIGhlYWRlcnMuYXBwZW5kKCdBY2NlcHQnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgIGhlYWRlcnMuYXBwZW5kKCdYLUZpbHRlcicsIHByZWRpY2F0ZSk7XG4gICAgaGVhZGVycy5hcHBlbmQoJ1gtQ291bnQnLCAnMCcpO1xuICAgIGlmIChxdWVyeSAmJiBxdWVyeS5xdWVyeSkge1xuICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtUXVlcnknLCBxdWVyeS5xdWVyeSk7XG4gICAgICBoZWFkZXJzLmFwcGVuZCgnWC1TZWFyY2hUeXBlJywgcXVlcnkudHlwZSB8fCAncGFydGlhbCcpO1xuICAgIH1cbiAgICBjb25zdCBjdXN0b21LZXlzID0gT2JqZWN0LmtleXMoY3VzdG9tT3B0aW9ucyB8fCB7fSk7XG4gICAgY3VzdG9tS2V5cy5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gY3VzdG9tT3B0aW9uc1trZXldO1xuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIGhlYWRlcnMuYXBwZW5kKGtleSwgdmFsdWUpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnRGYWN0b3J5KCkuc2VuZCh7XG4gICAgICB1cmk6IG5ldyBVcmkodGhpcy5jb2xsZWN0aW9uRW5kcG9pbnQpLFxuICAgICAgaGVhZGVyc1xuICAgIH0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSByZXNwb25zZS5oZWFkZXJzLmdldCgnWC1Ub3RhbC1Db3VudCcpO1xuICAgICAgcmV0dXJuIGhlYWRlciA/IChwYXJzZUludChoZWFkZXIsIDEwKSB8fCAwKSA6IDA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSGliYSBsw6lwZXR0IGZlbCBhZGF0b2sgbGVrw6lyZGV6w6lzZSBrw7Z6YmVuOiAke3Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gICAgfVxuICB9XG5cbiAgZXhlYyhcbiAgICBvZmZzZXQ6IG51bWJlcixcbiAgICBjb3VudDogbnVtYmVyLFxuICAgIHByZWRpY2F0ZTogc3RyaW5nLFxuICAgIHNvcnRCeT86IHN0cmluZyxcbiAgICBzb3J0QnlEaXJlY3Rpb24/OiBRdWVyeVNvcnREaXJlY3Rpb24sXG4gICAgcXVlcnk/OiBWMVF1ZXJ5LFxuICAgIGN1c3RvbU9wdGlvbnM/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfSxcbiAgICBjYW5jZWxsYXRpb24/OiBDYW5jZWxsYXRpb25cbiAgKTogQXN5bmNJdGVyYWJsZTxURGF0YT4ge1xuICAgIGNvbnN0IHJlcG8gPSB0aGlzO1xuICAgIGxldCBlcnJvcjogYW55ID0gbnVsbDtcbiAgICBsZXQgaXRlbXM6IFREYXRhW118bnVsbCA9IG51bGw7XG4gICAgbGV0IGluZGV4ID0gMDtcbiAgICByZXR1cm4ge1xuICAgICAgW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSgpOiBBc3luY0l0ZXJhdG9yPFREYXRhPiB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgYXN5bmMgbmV4dCgpOiBQcm9taXNlPEl0ZXJhdG9yUmVzdWx0PFREYXRhPj4ge1xuICAgICAgICAgICAgaWYgKGNhbmNlbGxhdGlvbikge1xuICAgICAgICAgICAgICBjYW5jZWxsYXRpb24udGhyb3dJZkNhbmNlbGxlZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG51bGwgIT09IGVycm9yKSB7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFpdGVtcykge1xuICAgICAgICAgICAgICAvLyBFbHPFkSBuZXh0KCkgbWVnaMOtdsOhc2Frb3IgZXogZnV0IGxlLlxuICAgICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLU9mZnNldCcsIFN0cmluZyhvZmZzZXQpKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtQ291bnQnLCBTdHJpbmcoY291bnQpKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtRmlsdGVyJywgcHJlZGljYXRlKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU29ydC1CeScsIHNvcnRCeSB8fCAnJyk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNvcnQtQnktRGlyZWN0aW9uJywgc29ydEJ5RGlyZWN0aW9uIHx8ICcnKTtcbiAgICAgICAgICAgICAgaWYgKHF1ZXJ5ICYmIHF1ZXJ5LnF1ZXJ5KSB7XG4gICAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtUXVlcnknLCBxdWVyeS5xdWVyeSk7XG4gICAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU2VhcmNoVHlwZScsIHF1ZXJ5LnR5cGUgfHwgJ3BhcnRpYWwnKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBjb25zdCBjdXN0b21LZXlzID0gT2JqZWN0LmtleXMoY3VzdG9tT3B0aW9ucyB8fCB7fSk7XG4gICAgICAgICAgICAgIGN1c3RvbUtleXMuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdmFsID0gKGN1c3RvbU9wdGlvbnMgfHwge30pW2tleV07XG4gICAgICAgICAgICAgICAgaWYgKHZhbCkge1xuICAgICAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoa2V5LCB2YWwpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIC8vIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2gocmVwby5jb2xsZWN0aW9uRW5kcG9pbnQsIHsgaGVhZGVycywgc2lnbmFsOiBhYm9ydGlvbi5zaWduYWwgfSk7XG4gICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVwby5jbGllbnRGYWN0b3J5KCkuc2VuZCh7XG4gICAgICAgICAgICAgICAgdXJpOiBVcmkuZnJvbShyZXBvLmNvbGxlY3Rpb25FbmRwb2ludCksXG4gICAgICAgICAgICAgICAgaGVhZGVyc1xuICAgICAgICAgICAgICB9LCBjYW5jZWxsYXRpb24pO1xuICAgICAgICAgICAgICBpZiAocmVzcG9uc2Uub2sgJiYgcmVzcG9uc2UuY29udGVudCkge1xuICAgICAgICAgICAgICAgIGl0ZW1zID0gYXdhaXQgcmVzcG9uc2UuY29udGVudC5qc29uKCk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoYEhpYmEgbMOpcGV0dCBmZWwgYWRhdG9rIGxla8OpcmRlesOpc2Uga8O2emJlbjogJHtyZXNwb25zZS5zdGF0dXNUZXh0fWApO1xuICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWl0ZW1zKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignc2hvdWxkIG5ldmVyIGhhcHBlbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGluZGV4ID49IGl0ZW1zLmxlbmd0aCkge1xuICAgICAgICAgICAgICByZXR1cm4geyBkb25lOiB0cnVlLCB2YWx1ZTogPGFueT4gdW5kZWZpbmVkIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGl0ZW1zW2luZGV4XTtcbiAgICAgICAgICAgICsraW5kZXg7XG4gICAgICAgICAgICByZXR1cm4geyBkb25lOiBmYWxzZSwgdmFsdWUgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfTtcbiAgfVxufVxuXG5jb25zdCByZWdleCA9IC9bXFwwLVxceDA4XFxuLVxceDFGXFx4N0YtXFx1RkZGRl0vZztcblxuZXhwb3J0IGNsYXNzIFJlc3RRdWVyeTxUPiBleHRlbmRzIFF1ZXJ5PFQ+IHtcbiAgc3RhdGljIGRlZmF1bHRDb3VudCA9IDEwMDAwMDtcbiAgcmVhZG9ubHkgcmVwbzogUmVzdFJlcG9zaXRvcnk8VD47XG4gIHJlYWRvbmx5IG9mZnNldDogbnVtYmVyO1xuICByZWFkb25seSBjb3VudDogbnVtYmVyO1xuICByZWFkb25seSBwcmVkaWNhdGU6IFEuTGFtYmRhfG51bGw7XG4gIHJlYWRvbmx5IHNvcnRCeTogc3RyaW5nO1xuICByZWFkb25seSBzb3J0QnlEaXJlY3Rpb246IFF1ZXJ5U29ydERpcmVjdGlvbjtcbiAgcmVhZG9ubHkgcHJvdG9jb2xWZXJzaW9uOiBudW1iZXI7XG4gIHJlYWRvbmx5IGN1c3RvbU9wdGlvbnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9O1xuICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bWF4LWxpbmUtbGVuZ3RoXG4gIGNvbnN0cnVjdG9yKHJlcG86IFJlc3RSZXBvc2l0b3J5PFQ+LCBvZmZzZXQ6IG51bWJlciwgY291bnQ6IG51bWJlciwgcHJlZGljYXRlPzogUS5MYW1iZGF8bnVsbCwgc29ydEJ5Pzogc3RyaW5nLCBzb3J0QnlEaXJlY3Rpb24/OiBRdWVyeVNvcnREaXJlY3Rpb24sIGN1c3RvbU9wdGlvbnM/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfSwgcHJvdG9jb2xWZXJzaW9uPzogbnVtYmVyKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlcG8gPSByZXBvO1xuICAgIHRoaXMub2Zmc2V0ID0gb2Zmc2V0IHx8IDA7XG4gICAgdGhpcy5jb3VudCA9IDAgPT09IGNvdW50ID8gY291bnQgOiAoY291bnQgfHwgUmVzdFF1ZXJ5LmRlZmF1bHRDb3VudCk7XG4gICAgdGhpcy5wcmVkaWNhdGUgPSBwcmVkaWNhdGUgfHwgbnVsbDtcbiAgICB0aGlzLnNvcnRCeSA9IHNvcnRCeSB8fCAnJztcbiAgICB0aGlzLnNvcnRCeURpcmVjdGlvbiA9IHNvcnRCeURpcmVjdGlvbiB8fCBRdWVyeVNvcnREaXJlY3Rpb24uQXNjO1xuICAgIHRoaXMuY3VzdG9tT3B0aW9ucyA9IGN1c3RvbU9wdGlvbnMgfHwge307XG4gICAgdGhpcy5wcm90b2NvbFZlcnNpb24gPSBwcm90b2NvbFZlcnNpb24gfHwgMjtcbiAgfVxuICBwcml2YXRlIGVzY2FwZShpbnB1dDogc3RyaW5nfFEuRXhwcnxudWxsKSB7XG4gICAgaWYgKCFpbnB1dCkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgICBjb25zdCBpbnAgPSBpbnB1dCBpbnN0YW5jZW9mIFEuRXhwciA/IHRoaXMuYXBwbHlQcm90b2NvbChpbnB1dCkudG9TdHJpbmcoKSA6IGlucHV0O1xuICAgIHJldHVybiB1dGY4XG4gICAgICAudXRmOGVuY29kZShpbnApXG4gICAgICAucmVwbGFjZShyZWdleCwgKG0pID0+ICclJyArICgnMCcgKyBtLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkpLnNsaWNlKC0yKSk7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5UHJvdG9jb2woZXhwcjogUS5FeHByKSB7XG4gICAgaWYgKHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMiAmJiBleHByIGluc3RhbmNlb2YgUS5MYW1iZGEpIHtcbiAgICAgIGNvbnN0IHBhcmFtID0gZXhwci5wYXJhbTtcbiAgICAgIHJldHVybiBleHByLmJvZHkuYWNjZXB0PFEuRXhwcj4oe1xuICAgICAgICB2aXNpdENvbnN0KGMpIHsgcmV0dXJuIGM7IH0sXG4gICAgICAgIHZpc2l0UGFyYW0ocCkgeyByZXR1cm4gcDsgfSxcbiAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICAgICAgICB2aXNpdFByb3AocCkgeyByZXR1cm4gcC5pbnN0YW5jZS5lcShwYXJhbSkgPyBuZXcgUS5QYXJhbSg8YW55PiBwLm5hbWUpIDogbmV3IFEuUHJvcChwLmluc3RhbmNlLmFjY2VwdCh0aGlzKSwgcC5uYW1lKTsgfSxcbiAgICAgICAgdmlzaXRCaW5hcnkoYikgeyByZXR1cm4gbmV3IFEuQmluT3AoYi5sZWZ0LmFjY2VwdCh0aGlzKSwgYi5vcCwgYi5yaWdodC5hY2NlcHQodGhpcykpOyB9LFxuICAgICAgICB2aXNpdFVuYXJ5KHUpIHsgcmV0dXJuIG5ldyBRLlVuT3AodS5vcCwgdS5vcGVyYW5kLmFjY2VwdCh0aGlzKSk7IH0sXG4gICAgICAgIHZpc2l0Q2FsbChjKSB7IHJldHVybiBuZXcgUS5DYWxsKGMubmFtZSwgYy5hcmdzLm1hcCgoYXJnKSA9PiBhcmcuYWNjZXB0KHRoaXMpKSk7IH0sXG4gICAgICAgIHZpc2l0TGFtYmRhKGwpIHsgcmV0dXJuIG5ldyBRLkxhbWJkYShsLmJvZHkuYWNjZXB0KHRoaXMpLCBsLnBhcmFtKTsgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBleHByO1xuICB9XG5cbiAgcHJpdmF0ZSBleHRyYWN0VjFRdWVyeShleHByOiBRLkV4cHIpIHtcbiAgICBjb25zdCBxOiB7IHF1ZXJ5Pzogc3RyaW5nIH0gPSB7fTtcbiAgICBjb25zdCB2MUV4cHIgPSBleHByLmFjY2VwdDxRLkV4cHI+KHtcbiAgICAgIHZpc2l0Q29uc3QoYykgeyByZXR1cm4gYzsgfSxcbiAgICAgIHZpc2l0UGFyYW0ocCkgeyByZXR1cm4gcDsgfSxcbiAgICAgIHZpc2l0UHJvcChwKSB7IHJldHVybiBuZXcgUS5Qcm9wKHAuaW5zdGFuY2UuYWNjZXB0KHRoaXMpLCBwLm5hbWUpOyB9LFxuICAgICAgdmlzaXRCaW5hcnkoYikge1xuICAgICAgICBjb25zdCBsID0gYi5sZWZ0LmFjY2VwdCh0aGlzKTtcbiAgICAgICAgY29uc3QgciA9IGIucmlnaHQuYWNjZXB0KHRoaXMpO1xuICAgICAgICBpZiAobCBpbnN0YW5jZW9mIFEuQ29uc3QgJiYgKDxhbnk+IGwudmFsdWUgPT09IHRydWUgfHwgPGFueT4gbC52YWx1ZSA9PT0gJ3RydWUnKSkge1xuICAgICAgICAgICAgcmV0dXJuIHI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHIgaW5zdGFuY2VvZiBRLkNvbnN0ICYmICg8YW55PiByLnZhbHVlID09PSB0cnVlIHx8IDxhbnk+IHIudmFsdWUgPT09ICd0cnVlJykpIHtcbiAgICAgICAgICAgIHJldHVybiBsO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgUS5CaW5PcChsLCBiLm9wLCByKTtcbiAgICAgIH0sXG4gICAgICB2aXNpdFVuYXJ5KHUpIHsgcmV0dXJuIG5ldyBRLlVuT3AodS5vcCwgdS5vcGVyYW5kLmFjY2VwdCh0aGlzKSk7IH0sXG4gICAgICB2aXNpdENhbGwoYykge1xuICAgICAgICBpZiAoJ3BhcnRpYWxNYXRjaCcgPT09IGMubmFtZSAmJiAyID09PSBjLmFyZ3MubGVuZ3RoKSB7XG4gICAgICAgICAgY29uc3QgYXJnID0gYy5hcmdzWzFdO1xuICAgICAgICAgIGlmIChhcmcgaW5zdGFuY2VvZiBRLkNvbnN0ICYmIGFyZy52YWx1ZSkge1xuICAgICAgICAgICAgcS5xdWVyeSA9IGFyZy52YWx1ZTtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUS5Db25zdCg8YW55PiB0cnVlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdub3Qgc3VwcG9ydGVkIHBhcnRpYWwgbWF0Y2ggaW4gcHJvdG9jb2wgdjEnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFEuQ2FsbChjLm5hbWUsIGMuYXJncy5tYXAoKGFyZykgPT4gYXJnLmFjY2VwdCh0aGlzKSkpO1xuICAgICAgfSxcbiAgICAgIHZpc2l0TGFtYmRhKGwpIHsgcmV0dXJuIG5ldyBRLkxhbWJkYShsLmJvZHkuYWNjZXB0KHRoaXMpLCBsLnBhcmFtKTsgfVxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICAgIGV4cHI6IHYxRXhwcixcbiAgICAgICAgcXVlcnk6IHFcbiAgICB9O1xuICB9XG5cbiAgZ2V0IGVzY2FwZWRQcmVkaWNhdGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuZXNjYXBlKHRoaXMucHJlZGljYXRlKTtcbiAgfVxuICBnZXQgZXNjYXBlZFNvcnRCeSgpIHtcbiAgICByZXR1cm4gdGhpcy5lc2NhcGUodGhpcy5zb3J0QnkpO1xuICB9XG4gIGZpbHRlcihwcmVkaWNhdGU6IHN0cmluZ3xRLkxhbWJkYSkge1xuICAgIGNvbnN0IHAgPSAnc3RyaW5nJyA9PT0gdHlwZW9mIHByZWRpY2F0ZSA/IFEucGFyc2UocHJlZGljYXRlKSA6IHByZWRpY2F0ZTtcbiAgICBpZiAoIShwIGluc3RhbmNlb2YgUS5MYW1iZGEpKSB7XG4gICAgICB0aHJvdyBUeXBlRXJyb3IoJ3ByZWRpY2F0ZSBtdXN0IGJlIGEgbGFtYmRhIGV4cHJlc3Npb24nKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICB0aGlzLm9mZnNldCxcbiAgICAgIHRoaXMuY291bnQsXG4gICAgICB0aGlzLnByZWRpY2F0ZSA/IHRoaXMucHJlZGljYXRlLmFuZChwKSA6IHAsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgdGhpcy5jdXN0b21PcHRpb25zLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb25cbiAgICApO1xuICB9XG4gIHNraXAobjogbnVtYmVyKTogUXVlcnk8VD4ge1xuICAgIGlmICgwID09PSBuKSB7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgY2hlY2tOdW0obiwgJ3NraXAgcGFyYW1ldGVyIG11c3QgYmUgbm9uLW5lZ2F0aXZlIHdob2xlIG51bWJlci4nKTtcbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIG4sIC8vIFRPRE86IEV6dCB2w6lnaWcga2VsbCBnb25kb2xuaSwgbWVydCBsZWhldCAodGhpcy5vZmZzZXQgKyBuKSBrZWxsZW5lIGlkZT9cbiAgICAgIHRoaXMuY291bnQsXG4gICAgICB0aGlzLnByZWRpY2F0ZSxcbiAgICAgIHRoaXMuc29ydEJ5LFxuICAgICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24sXG4gICAgICB0aGlzLmN1c3RvbU9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvblxuICAgICk7XG4gIH1cbiAgdGFrZShuOiBudW1iZXIpOiBRdWVyeTxUPiB7XG4gICAgY2hlY2tOdW0obiwgJ3Rha2UgcGFyYW1ldGVyIG11c3QgYmUgbm9uLW5lZ2F0aXZlIHdob2xlIG51bWJlci4nKTtcbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIHRoaXMub2Zmc2V0LFxuICAgICAgbixcbiAgICAgIHRoaXMucHJlZGljYXRlLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIHRoaXMuY3VzdG9tT3B0aW9ucyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uKTtcbiAgfVxuICBvcmRlckJ5KHNlbGVjdG9yOiBzdHJpbmcsIGRpcmVjdGlvbj86IFF1ZXJ5U29ydERpcmVjdGlvbik6IFF1ZXJ5PFQ+IHtcbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIHRoaXMub2Zmc2V0LFxuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlLFxuICAgICAgc2VsZWN0b3IsXG4gICAgICBkaXJlY3Rpb24gfHwgUXVlcnlTb3J0RGlyZWN0aW9uLkFzYyxcbiAgICAgIHRoaXMuY3VzdG9tT3B0aW9ucyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uKTtcbiAgfVxuICBzZXRDdXN0b21PcHRpb25zKG9wdGlvbnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LCByZXBsYWNlPzogYm9vbGVhbik6IFF1ZXJ5PFQ+IHtcbiAgICBjb25zdCBvcHRzID0gcmVwbGFjZSA/IChvcHRpb25zIHx8IHt9KSA6IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuY3VzdG9tT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICB0aGlzLm9mZnNldCxcbiAgICAgIHRoaXMuY291bnQsXG4gICAgICB0aGlzLnByZWRpY2F0ZSxcbiAgICAgIHRoaXMuc29ydEJ5LFxuICAgICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24sXG4gICAgICBvcHRzLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIGFzeW5jIHRvdGFsKGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBsZXQgcHJlZGljYXRlOiBzdHJpbmc7XG4gICAgbGV0IHYxUXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkO1xuICAgIGlmICghdGhpcy5wcmVkaWNhdGUpIHtcbiAgICAgIHByZWRpY2F0ZSA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5wcm90b2NvbFZlcnNpb24gPCAyKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLmV4dHJhY3RWMVF1ZXJ5KHRoaXMucHJlZGljYXRlKTtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUoZGF0YS5leHByKTtcbiAgICAgICAgdjFRdWVyeSA9IGRhdGEucXVlcnk7XG4gICAgICAgIGlmIChwcmVkaWNhdGUgJiYgcHJlZGljYXRlLnN0YXJ0c1dpdGgoJygnKSAmJiBwcmVkaWNhdGUuZW5kc1dpdGgoJyknKSkge1xuICAgICAgICAgIHByZWRpY2F0ZSA9IHByZWRpY2F0ZS5zdWJzdHIoMSwgcHJlZGljYXRlLmxlbmd0aCAtIDIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcmVkaWNhdGUgPSB0aGlzLmVzY2FwZSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJlcG8udG90YWwocHJlZGljYXRlLCB2MVF1ZXJ5LCB0aGlzLmN1c3RvbU9wdGlvbnMsIGNhbmNlbGxhdGlvbik7XG4gIH1cbiAgZXhlYygpOiBBc3luY0l0ZXJhYmxlPFQ+IHtcbiAgICBsZXQgcHJlZGljYXRlOiBzdHJpbmc7XG4gICAgbGV0IHYxUXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkO1xuICAgIGlmICghdGhpcy5wcmVkaWNhdGUpIHtcbiAgICAgIHByZWRpY2F0ZSA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5wcm90b2NvbFZlcnNpb24gPCAyKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLmV4dHJhY3RWMVF1ZXJ5KHRoaXMucHJlZGljYXRlKTtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUoZGF0YS5leHByKTtcbiAgICAgICAgdjFRdWVyeSA9IGRhdGEucXVlcnk7XG4gICAgICAgIGlmIChwcmVkaWNhdGUgJiYgcHJlZGljYXRlLnN0YXJ0c1dpdGgoJygnKSAmJiBwcmVkaWNhdGUuZW5kc1dpdGgoJyknKSkge1xuICAgICAgICAgIHByZWRpY2F0ZSA9IHByZWRpY2F0ZS5zdWJzdHIoMSwgcHJlZGljYXRlLmxlbmd0aCAtIDIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcmVkaWNhdGUgPSB0aGlzLmVzY2FwZSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTptYXgtbGluZS1sZW5ndGhcbiAgICByZXR1cm4gdGhpcy5yZXBvLmV4ZWModGhpcy5vZmZzZXQsIHRoaXMuY291bnQsIHByZWRpY2F0ZSwgdGhpcy5zb3J0QnksIHRoaXMuc29ydEJ5RGlyZWN0aW9uLCB2MVF1ZXJ5LCB0aGlzLmN1c3RvbU9wdGlvbnMpO1xuICB9XG59XG4iXX0=