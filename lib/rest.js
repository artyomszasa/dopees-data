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
const rquoted = /"((?:[^"\\]|.)*)"/;
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
    escapeV1Query(query) {
        const m = rquoted.exec(query);
        if (m) {
            return query.substr(0, m.index) + '"' + encodeURIComponent(m[1]) + '"' + query.substr(m.index + m.length, 0);
        }
        return encodeURIComponent(query);
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
            headers.append('X-Query', this.escapeV1Query(query.query));
            headers.append('X-SearchType', query.type || 'partial');
        }
        const customKeys = Object.keys(customOptions || {});
        customKeys.forEach((key) => {
            const value = customOptions[key];
            if (value) {
                headers.append(key, value);
            }
        });
        if (this.protocolVersion > 2) {
            const responseV3 = await this.clientFactory().send({
                uri: new Uri(this.collectionEndpoint + '/count'),
                headers
            }, cancellation);
            if (responseV3.ok) {
                const content = await responseV3.content.text();
                return parseInt(content, 10) || 0;
            }
            throw new Error(`Hiba lépett fel adatok lekérdezése közben: ${responseV3.statusText}`);
        }
        const response = await this.clientFactory().send({
            uri: new Uri(this.collectionEndpoint),
            headers
        }, cancellation);
        if (response.ok) {
            const header = response.headers.get('X-Total-Count');
            return header ? (parseInt(header, 10) || 0) : 0;
        }
        throw new Error(`Hiba lépett fel adatok lekérdezése közben: ${response.statusText}`);
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
                                headers.append('X-Query', repo.escapeV1Query(query.query));
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
                if ('exactMatch' === c.name && 2 === c.args.length) {
                    const arg = c.args[1];
                    if (arg instanceof Q.Const && arg.value) {
                        q.query = arg.value;
                        q.type = 'exact';
                        return new Q.Const(true);
                    }
                    throw new Error('not supported exact match in protocol v1');
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
        return new RestQuery(this.repo, this.offset, this.count, this.predicate, this.protocolVersion < 2 ? this.escape(Q.parse(selector)) : selector, direction || QuerySortDirection.Asc, this.customOptions, this.protocolVersion);
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
                if (predicate === 'true') {
                    predicate = '';
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
                if (predicate === 'true') {
                    predicate = '';
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxLQUFLLEVBQWMsa0JBQWtCLEVBQWlCLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEYsT0FBTyxLQUFLLENBQUMsTUFBTSxZQUFZLENBQUM7QUFDaEMsT0FBTyxFQUEyQixTQUFTLEVBQWdCLE1BQU0sdUJBQXVCLENBQUM7QUFDekYsT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsQ0FBQztBQUU3QyxPQUFPLEVBQUUsVUFBVSxFQUFFLHVCQUF1QixFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDM0UsT0FBTyxFQUFFLEdBQUcsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBRTFDLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxHQUFXLEVBQUUsRUFBRTtJQUN2Qyw2RUFBNkU7SUFDN0UsT0FBTyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxVQUFTLENBQUM7UUFDeEQsT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNqRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNmLENBQUMsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBUyxFQUFFLE9BQWUsRUFBRSxFQUFFO0lBQzlDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6QixNQUFNLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0tBQzlCO0FBQ0gsQ0FBQyxDQUFDO0FBb0NGLE1BQU0s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QUFJLENBQUMsU0FBUyxFQUFFO1lBQ25CLFNBQVMsR0FBRyxFQUFFLENBQUM7U0FDaEI7YUFBTTtZQUNMLElBQUksSUFBSSxDQUFDLGVBQWUsR0FBRyxDQUFDLEVBQUU7Z0JBQzVCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNqRCxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ25DLE9BQU8sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO2dCQUNyQixJQUFJLFNBQVMsSUFBSSxTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUU7b0JBQ3JFLFNBQVMsR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDO2lCQUN2RDtnQkFDRCxJQUFJLFNBQVMsS0FBSyxNQUFNLEVBQUU7b0JBQ3hCLFNBQVMsR0FBRyxFQUFFLENBQUM7aUJBQ2hCO2FBQ0Y7aUJBQU07Z0JBQ0wsU0FBUyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2FBQ3pDO1NBQ0Y7UUFDRCwyQ0FBMkM7UUFDM0MsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLGVBQWUsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzVILENBQUM7O0FBbk5NLHNCQUFZLEdBQUcsTUFBTSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUXVlcnksIFJlcG9zaXRvcnksIFF1ZXJ5U29ydERpcmVjdGlvbiwgS2V5UmVwb3NpdG9yeSB9IGZyb20gJy4vcmVwb3NpdG9yaWVzJztcbmltcG9ydCAqIGFzIFEgZnJvbSAnLi9wcm90b2NvbCc7XG5pbXBvcnQgeyBkZWNvcmF0ZWRGZXRjaCBhcyBmZXRjaCwgSHR0cEVycm9yLCBSZXNwb25zZUxpa2UgfSBmcm9tICdkb3BlZXMtY29yZS9saWIvZmV0Y2gnO1xuaW1wb3J0ICogYXMgdXRmOCBmcm9tICdkb3BlZXMtY29yZS9saWIvdXRmOCc7XG5pbXBvcnQgeyBDYW5jZWxsYXRpb24gfSBmcm9tICdkb3BlZXMtY29yZS9saWIvY2FuY2VsbGF0aW9uJztcbmltcG9ydCB7IEh0dHBDbGllbnQsIGh0dHBDbGllbnRDb25maWd1cmF0aW9uIH0gZnJvbSAnZG9wZWVzLWNvcmUvbGliL2h0dHAnO1xuaW1wb3J0IHsgVXJpIH0gZnJvbSAnZG9wZWVzLWNvcmUvbGliL3VyaSc7XG5cbmNvbnN0IGI2NERlY29kZVVuaWNvZGUgPSAoc3RyOiBzdHJpbmcpID0+IHtcbiAgLy8gR29pbmcgYmFja3dhcmRzOiBmcm9tIGJ5dGVzdHJlYW0sIHRvIHBlcmNlbnQtZW5jb2RpbmcsIHRvIG9yaWdpbmFsIHN0cmluZy5cbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChhdG9iKHN0cikuc3BsaXQoJycpLm1hcChmdW5jdGlvbihjKSB7XG4gICAgICByZXR1cm4gJyUnICsgKCcwMCcgKyBjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpKS5zbGljZSgtMik7XG4gIH0pLmpvaW4oJycpKTtcbn07XG5cbmNvbnN0IGNoZWNrTnVtID0gKG46IG51bWJlciwgbWVzc2FnZTogc3RyaW5nKSA9PiB7XG4gIGlmIChuICUgMSAhPT0gMCB8fCBuIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKG1lc3NhZ2UpO1xuICB9XG59O1xuXG5pbnRlcmZhY2UgUmVzdFJlcG9zaXRvcnlPcHRpb25zIHtcbiAgdHlwZTogc3RyaW5nO1xuICBlbmRwb2ludDogc3RyaW5nO1xuICBrZXlQcm9wZXJ0eT86IHN0cmluZztcbiAgcHJvdG9jb2xWZXJzaW9uPzogbnVtYmVyO1xuICBjb25maWd1cmF0aW9uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFYxUXVlcnkge1xuICBxdWVyeT86IHN0cmluZztcbiAgdHlwZT86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXN0UmVwb3NpdG9yeTxUPiBleHRlbmRzIFJlcG9zaXRvcnk8VD4ge1xuICBleGVjKFxuICAgIG9mZnNldDogbnVtYmVyLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgcHJlZGljYXRlOiBzdHJpbmcsXG4gICAgc29ydEJ5Pzogc3RyaW5nLFxuICAgIHNvcnRCeURpcmVjdGlvbj86XG4gICAgUXVlcnlTb3J0RGlyZWN0aW9uLFxuICAgIHF1ZXJ5PzogVjFRdWVyeSxcbiAgICBjdXN0b21PcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sXG4gICAgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uXG4gICk6IEFzeW5jSXRlcmFibGU8VD47XG5cbiAgdG90YWwoXG4gICAgcHJlZGljYXRlOiBzdHJpbmcsXG4gICAgcXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkLFxuICAgIGN1c3RvbU9wdGlvbnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LFxuICAgIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uXG4gICk6IFByb21pc2U8bnVtYmVyPjtcbn1cblxuY29uc3QgcnF1b3RlZCA9IC9cIigoPzpbXlwiXFxcXF18LikqKVwiLztcblxuZXhwb3J0IGNsYXNzIEtleVJlc3RSZXBvc2l0b3J5PFREYXRhLCBUS2V5PiBpbXBsZW1lbnRzIEtleVJlcG9zaXRvcnk8VERhdGEsIFRLZXk+LCBSZXN0UmVwb3NpdG9yeTxURGF0YT4ge1xuICByZWFkb25seSBjbGllbnRGYWN0b3J5OiAoKSA9PiBIdHRwQ2xpZW50O1xuICByZWFkb25seSBvcHRpb25zOiBSZXN0UmVwb3NpdG9yeU9wdGlvbnM7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUmVzdFJlcG9zaXRvcnlPcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICBjb25zdCByZXN0TWVzc2FnZUhhbmRsZXIgPSBodHRwQ2xpZW50Q29uZmlndXJhdGlvbi5nZXRIYW5kbGVyKChvcHRpb25zICYmIG9wdGlvbnMuY29uZmlndXJhdGlvbikgfHwgJ3Jlc3QnKTtcbiAgICB0aGlzLmNsaWVudEZhY3RvcnkgPSAoKSA9PiBuZXcgSHR0cENsaWVudChyZXN0TWVzc2FnZUhhbmRsZXIpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgY29sbGVjdGlvbkVuZHBvaW50KCkge1xuICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX1gO1xuICB9XG5cbiAgZ2V0IHByb3RvY29sVmVyc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLnByb3RvY29sVmVyc2lvbiB8fCAyO1xuICB9XG5cbiAgZ2V0IHR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy50eXBlO1xuICB9XG5cbiAgZ2V0IGVuZHBvaW50KCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMuZW5kcG9pbnQ7XG4gIH1cblxuICBnZXQga2V5UHJvcGVydHkoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5rZXlQcm9wZXJ0eSB8fCAnaWQnO1xuICB9XG5cbiAgZ2V0IGl0ZW1zKCk6IFF1ZXJ5PFREYXRhPiB7XG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFREYXRhPih0aGlzLCAwLCBSZXN0UXVlcnkuZGVmYXVsdENvdW50LCBudWxsLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwge30sIHRoaXMub3B0aW9ucy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEtleShpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiAoaXRlbSBhcyBhbnkpW3RoaXMua2V5UHJvcGVydHldIGFzIFRLZXk7XG4gIH1cblxuICBwcml2YXRlIGhhc0tleShpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiAhIXRoaXMuZ2V0S2V5KGl0ZW0pO1xuICB9XG5cbiAgcHJpdmF0ZSBpdGVtRW5kcG9pbnQoaXRlbTogVERhdGEpIHtcbiAgICByZXR1cm4gYCR7dGhpcy5lbmRwb2ludH0vJHt0aGlzLnR5cGV9LyR7dGhpcy5nZXRLZXkoaXRlbSl9YDtcbiAgfVxuXG4gIHByaXZhdGUgX19nZXRFcnJvcihyZXNwb25zZTogUmVzcG9uc2VMaWtlKTogSHR0cEVycm9yIHtcbiAgICBjb25zdCBtZXNzYWdlcyA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdYLU1lc3NhZ2UnKTtcbiAgICBpZiAobWVzc2FnZXMpIHtcbiAgICAgIGxldCB0ZXh0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICB0ZXh0ID0gYjY0RGVjb2RlVW5pY29kZShtZXNzYWdlcyk7XG4gICAgICB9IGNhdGNoIChleG4pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0ZXh0ID0gZGVjb2RlVVJJQ29tcG9uZW50KG1lc3NhZ2VzKTtcbiAgICAgICAgfSBjYXRjaCAoZXhuKSB7XG4gICAgICAgICAgdGV4dCA9IG1lc3NhZ2VzO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IEh0dHBFcnJvcihyZXNwb25zZSwgdGV4dCk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgSHR0cEVycm9yKHJlc3BvbnNlKTtcbiAgfVxuXG4gIHByaXZhdGUgZXNjYXBlVjFRdWVyeShxdWVyeTogc3RyaW5nKSB7XG4gICAgY29uc3QgbSA9IHJxdW90ZWQuZXhlYyhxdWVyeSk7XG4gICAgaWYgKG0pIHtcbiAgICAgIHJldHVybiBxdWVyeS5zdWJzdHIoMCwgbS5pbmRleCkgKyAnXCInICsgZW5jb2RlVVJJQ29tcG9uZW50KG1bMV0pICsgJ1wiJyArIHF1ZXJ5LnN1YnN0cihtLmluZGV4ICsgbS5sZW5ndGgsIDApO1xuICAgIH1cbiAgICByZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5KTtcbiAgfVxuXG4gIGFzeW5jIGxvb2t1cChrZXk6IFRLZXksIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8VERhdGE+IHtcbiAgICBjb25zdCB1cmkgPSBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX0vJHtrZXl9YDtcbiAgICByZXR1cm4gdGhpcy5jbGllbnRGYWN0b3J5KCkuZ2V0SnNvbih1cmksIGNhbmNlbGxhdGlvbik7XG4gIH1cblxuICBhc3luYyB1cGRhdGUoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8VERhdGE+IHtcbiAgICBpZiAoIWl0ZW0pIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VuYWJsZSB0byB1cGRhdGUgZW1wdHkgdmFsdWUnKTtcbiAgICB9XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNsaWVudEZhY3RvcnkoKS5wdXQodGhpcy5pdGVtRW5kcG9pbnQoaXRlbSksIDxhbnk+IGl0ZW0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb29rdXAodGhpcy5nZXRLZXkoaXRlbSksIGNhbmNlbGxhdGlvbik7XG4gICAgfVxuICAgIHRocm93IHRoaXMuX19nZXRFcnJvcihyZXNwb25zZSk7XG4gIH1cblxuICBhc3luYyBpbnNlcnQoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGlmICghaXRlbSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndW5hYmxlIHRvIGluc2VydCBlbXB0eSB2YWx1ZScpO1xuICAgIH1cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2xpZW50RmFjdG9yeSgpLnBvc3QodGhpcy5jb2xsZWN0aW9uRW5kcG9pbnQsIDxhbnk+IGl0ZW0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCB1cmkgPSByZXNwb25zZS5oZWFkZXJzLmdldCgnTG9jYXRpb24nKTtcbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcigncmVzdCBpbnNlcnQgZGlkIG5vdCByZXR1cm4gYSBsb2NhdGlvbicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuY2xpZW50RmFjdG9yeSgpLmdldEpzb24odXJpLCBjYW5jZWxsYXRpb24pO1xuICAgIH1cbiAgICB0aHJvdyB0aGlzLl9fZ2V0RXJyb3IocmVzcG9uc2UpO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlKGl0ZW06IFREYXRhLCBjYW5jZWxsYXRpb246IENhbmNlbGxhdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnRGYWN0b3J5KCkuZGVsZXRlKHRoaXMuaXRlbUVuZHBvaW50KGl0ZW0pLCBjYW5jZWxsYXRpb24pO1xuICAgIGlmICgyMDAgPT09IHJlc3BvbnNlLnN0YXR1cyB8fCAyMDIgPT09IHJlc3BvbnNlLnN0YXR1cyB8fCAyMDQgPT09IHJlc3BvbnNlLnN0YXR1cykge1xuICAgICAgLy8gc3VjY2VzcztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhyb3cgdGhpcy5fX2dldEVycm9yKHJlc3BvbnNlKTtcbiAgfVxuXG4gIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTptYXgtbGluZS1sZW5ndGhcbiAgYXN5bmMgdG90YWwocHJlZGljYXRlOiBzdHJpbmcsIHF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZCwgY3VzdG9tT3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgICBoZWFkZXJzLmFwcGVuZCgnQWNjZXB0JywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcbiAgICBoZWFkZXJzLmFwcGVuZCgnWC1GaWx0ZXInLCBwcmVkaWNhdGUpO1xuICAgIGhlYWRlcnMuYXBwZW5kKCdYLUNvdW50JywgJzAnKTtcbiAgICBpZiAocXVlcnkgJiYgcXVlcnkucXVlcnkpIHtcbiAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVF1ZXJ5JywgdGhpcy5lc2NhcGVWMVF1ZXJ5KHF1ZXJ5LnF1ZXJ5KSk7XG4gICAgICBoZWFkZXJzLmFwcGVuZCgnWC1TZWFyY2hUeXBlJywgcXVlcnkudHlwZSB8fCAncGFydGlhbCcpO1xuICAgIH1cbiAgICBjb25zdCBjdXN0b21LZXlzID0gT2JqZWN0LmtleXMoY3VzdG9tT3B0aW9ucyB8fCB7fSk7XG4gICAgY3VzdG9tS2V5cy5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gY3VzdG9tT3B0aW9uc1trZXldO1xuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIGhlYWRlcnMuYXBwZW5kKGtleSwgdmFsdWUpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmICh0aGlzLnByb3RvY29sVmVyc2lvbiA+IDIpIHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlVjMgPSBhd2FpdCB0aGlzLmNsaWVudEZhY3RvcnkoKS5zZW5kKHtcbiAgICAgICAgdXJpOiBuZXcgVXJpKHRoaXMuY29sbGVjdGlvbkVuZHBvaW50ICsgJy9jb3VudCcpLFxuICAgICAgICBoZWFkZXJzXG4gICAgICB9LCBjYW5jZWxsYXRpb24pO1xuICAgICAgaWYgKHJlc3BvbnNlVjMub2spIHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHJlc3BvbnNlVjMuY29udGVudCEudGV4dCgpO1xuICAgICAgICByZXR1cm4gcGFyc2VJbnQoY29udGVudCwgMTApIHx8IDA7XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEhpYmEgbMOpcGV0dCBmZWwgYWRhdG9rIGxla8OpcmRlesOpc2Uga8O2emJlbjogJHtyZXNwb25zZVYzLnN0YXR1c1RleHR9YCk7XG4gICAgfVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnRGYWN0b3J5KCkuc2VuZCh7XG4gICAgICB1cmk6IG5ldyBVcmkodGhpcy5jb2xsZWN0aW9uRW5kcG9pbnQpLFxuICAgICAgaGVhZGVyc1xuICAgIH0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSByZXNwb25zZS5oZWFkZXJzLmdldCgnWC1Ub3RhbC1Db3VudCcpO1xuICAgICAgcmV0dXJuIGhlYWRlciA/IChwYXJzZUludChoZWFkZXIsIDEwKSB8fCAwKSA6IDA7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgSGliYSBsw6lwZXR0IGZlbCBhZGF0b2sgbGVrw6lyZGV6w6lzZSBrw7Z6YmVuOiAke3Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gIH1cblxuICBleGVjKFxuICAgIG9mZnNldDogbnVtYmVyLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgcHJlZGljYXRlOiBzdHJpbmcsXG4gICAgc29ydEJ5Pzogc3RyaW5nLFxuICAgIHNvcnRCeURpcmVjdGlvbj86IFF1ZXJ5U29ydERpcmVjdGlvbixcbiAgICBxdWVyeT86IFYxUXVlcnksXG4gICAgY3VzdG9tT3B0aW9ucz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LFxuICAgIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvblxuICApOiBBc3luY0l0ZXJhYmxlPFREYXRhPiB7XG4gICAgY29uc3QgcmVwbyA9IHRoaXM7XG4gICAgbGV0IGVycm9yOiBhbnkgPSBudWxsO1xuICAgIGxldCBpdGVtczogVERhdGFbXXxudWxsID0gbnVsbDtcbiAgICBsZXQgaW5kZXggPSAwO1xuICAgIHJldHVybiB7XG4gICAgICBbU3ltYm9sLmFzeW5jSXRlcmF0b3JdKCk6IEFzeW5jSXRlcmF0b3I8VERhdGE+IHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBhc3luYyBuZXh0KCk6IFByb21pc2U8SXRlcmF0b3JSZXN1bHQ8VERhdGE+PiB7XG4gICAgICAgICAgICBpZiAoY2FuY2VsbGF0aW9uKSB7XG4gICAgICAgICAgICAgIGNhbmNlbGxhdGlvbi50aHJvd0lmQ2FuY2VsbGVkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobnVsbCAhPT0gZXJyb3IpIHtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWl0ZW1zKSB7XG4gICAgICAgICAgICAgIC8vIEVsc8WRIG5leHQoKSBtZWdow612w6FzYWtvciBleiBmdXQgbGUuXG4gICAgICAgICAgICAgIGNvbnN0IGhlYWRlcnMgPSBuZXcgSGVhZGVycygpO1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnQWNjZXB0JywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtT2Zmc2V0JywgU3RyaW5nKG9mZnNldCkpO1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1Db3VudCcsIFN0cmluZyhjb3VudCkpO1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1GaWx0ZXInLCBwcmVkaWNhdGUpO1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1Tb3J0LUJ5Jywgc29ydEJ5IHx8ICcnKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU29ydC1CeS1EaXJlY3Rpb24nLCBzb3J0QnlEaXJlY3Rpb24gfHwgJycpO1xuICAgICAgICAgICAgICBpZiAocXVlcnkgJiYgcXVlcnkucXVlcnkpIHtcbiAgICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1RdWVyeScsIHJlcG8uZXNjYXBlVjFRdWVyeShxdWVyeS5xdWVyeSkpO1xuICAgICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNlYXJjaFR5cGUnLCBxdWVyeS50eXBlIHx8ICdwYXJ0aWFsJyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY29uc3QgY3VzdG9tS2V5cyA9IE9iamVjdC5rZXlzKGN1c3RvbU9wdGlvbnMgfHwge30pO1xuICAgICAgICAgICAgICBjdXN0b21LZXlzLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHZhbCA9IChjdXN0b21PcHRpb25zIHx8IHt9KVtrZXldO1xuICAgICAgICAgICAgICAgIGlmICh2YWwpIHtcbiAgICAgICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKGtleSwgdmFsKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAvLyBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHJlcG8uY29sbGVjdGlvbkVuZHBvaW50LCB7IGhlYWRlcnMsIHNpZ25hbDogYWJvcnRpb24uc2lnbmFsIH0pO1xuICAgICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcG8uY2xpZW50RmFjdG9yeSgpLnNlbmQoe1xuICAgICAgICAgICAgICAgIHVyaTogVXJpLmZyb20ocmVwby5jb2xsZWN0aW9uRW5kcG9pbnQpLFxuICAgICAgICAgICAgICAgIGhlYWRlcnNcbiAgICAgICAgICAgICAgfSwgY2FuY2VsbGF0aW9uKTtcbiAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlLm9rICYmIHJlc3BvbnNlLmNvbnRlbnQpIHtcbiAgICAgICAgICAgICAgICBpdGVtcyA9IGF3YWl0IHJlc3BvbnNlLmNvbnRlbnQuanNvbigpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGVycm9yID0gbmV3IEVycm9yKGBIaWJhIGzDqXBldHQgZmVsIGFkYXRvayBsZWvDqXJkZXrDqXNlIGvDtnpiZW46ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFpdGVtcykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3Nob3VsZCBuZXZlciBoYXBwZW4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpbmRleCA+PSBpdGVtcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgZG9uZTogdHJ1ZSwgdmFsdWU6IDxhbnk+IHVuZGVmaW5lZCB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBpdGVtc1tpbmRleF07XG4gICAgICAgICAgICArK2luZGV4O1xuICAgICAgICAgICAgcmV0dXJuIHsgZG9uZTogZmFsc2UsIHZhbHVlIH07XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH07XG4gIH1cbn1cblxuY29uc3QgcmVnZXggPSAvW1xcMC1cXHgwOFxcbi1cXHgxRlxceDdGLVxcdUZGRkZdL2c7XG5cbmV4cG9ydCBjbGFzcyBSZXN0UXVlcnk8VD4gZXh0ZW5kcyBRdWVyeTxUPiB7XG4gIHN0YXRpYyBkZWZhdWx0Q291bnQgPSAxMDAwMDA7XG4gIHJlYWRvbmx5IHJlcG86IFJlc3RSZXBvc2l0b3J5PFQ+O1xuICByZWFkb25seSBvZmZzZXQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgY291bnQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgcHJlZGljYXRlOiBRLkxhbWJkYXxudWxsO1xuICByZWFkb25seSBzb3J0Qnk6IHN0cmluZztcbiAgcmVhZG9ubHkgc29ydEJ5RGlyZWN0aW9uOiBRdWVyeVNvcnREaXJlY3Rpb247XG4gIHJlYWRvbmx5IHByb3RvY29sVmVyc2lvbjogbnVtYmVyO1xuICByZWFkb25seSBjdXN0b21PcHRpb25zOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfTtcbiAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICBjb25zdHJ1Y3RvcihyZXBvOiBSZXN0UmVwb3NpdG9yeTxUPiwgb2Zmc2V0OiBudW1iZXIsIGNvdW50OiBudW1iZXIsIHByZWRpY2F0ZT86IFEuTGFtYmRhfG51bGwsIHNvcnRCeT86IHN0cmluZywgc29ydEJ5RGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uLCBjdXN0b21PcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIHByb3RvY29sVmVyc2lvbj86IG51bWJlcikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5yZXBvID0gcmVwbztcbiAgICB0aGlzLm9mZnNldCA9IG9mZnNldCB8fCAwO1xuICAgIHRoaXMuY291bnQgPSAwID09PSBjb3VudCA/IGNvdW50IDogKGNvdW50IHx8IFJlc3RRdWVyeS5kZWZhdWx0Q291bnQpO1xuICAgIHRoaXMucHJlZGljYXRlID0gcHJlZGljYXRlIHx8IG51bGw7XG4gICAgdGhpcy5zb3J0QnkgPSBzb3J0QnkgfHwgJyc7XG4gICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24gPSBzb3J0QnlEaXJlY3Rpb24gfHwgUXVlcnlTb3J0RGlyZWN0aW9uLkFzYztcbiAgICB0aGlzLmN1c3RvbU9wdGlvbnMgPSBjdXN0b21PcHRpb25zIHx8IHt9O1xuICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uID0gcHJvdG9jb2xWZXJzaW9uIHx8IDI7XG4gIH1cbiAgcHJpdmF0ZSBlc2NhcGUoaW5wdXQ6IHN0cmluZ3xRLkV4cHJ8bnVsbCkge1xuICAgIGlmICghaW5wdXQpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gICAgY29uc3QgaW5wID0gaW5wdXQgaW5zdGFuY2VvZiBRLkV4cHIgPyB0aGlzLmFwcGx5UHJvdG9jb2woaW5wdXQpLnRvU3RyaW5nKCkgOiBpbnB1dDtcbiAgICByZXR1cm4gdXRmOFxuICAgICAgLnV0ZjhlbmNvZGUoaW5wKVxuICAgICAgLnJlcGxhY2UocmVnZXgsIChtKSA9PiAnJScgKyAoJzAnICsgbS5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpKS5zbGljZSgtMikpO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseVByb3RvY29sKGV4cHI6IFEuRXhwcikge1xuICAgIGlmICh0aGlzLnByb3RvY29sVmVyc2lvbiA8IDIgJiYgZXhwciBpbnN0YW5jZW9mIFEuTGFtYmRhKSB7XG4gICAgICBjb25zdCBwYXJhbSA9IGV4cHIucGFyYW07XG4gICAgICByZXR1cm4gZXhwci5ib2R5LmFjY2VwdDxRLkV4cHI+KHtcbiAgICAgICAgdmlzaXRDb25zdChjKSB7IHJldHVybiBjOyB9LFxuICAgICAgICB2aXNpdFBhcmFtKHApIHsgcmV0dXJuIHA7IH0sXG4gICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTptYXgtbGluZS1sZW5ndGhcbiAgICAgICAgdmlzaXRQcm9wKHApIHsgcmV0dXJuIHAuaW5zdGFuY2UuZXEocGFyYW0pID8gbmV3IFEuUGFyYW0oPGFueT4gcC5uYW1lKSA6IG5ldyBRLlByb3AocC5pbnN0YW5jZS5hY2NlcHQodGhpcyksIHAubmFtZSk7IH0sXG4gICAgICAgIHZpc2l0QmluYXJ5KGIpIHsgcmV0dXJuIG5ldyBRLkJpbk9wKGIubGVmdC5hY2NlcHQodGhpcyksIGIub3AsIGIucmlnaHQuYWNjZXB0KHRoaXMpKTsgfSxcbiAgICAgICAgdmlzaXRVbmFyeSh1KSB7IHJldHVybiBuZXcgUS5Vbk9wKHUub3AsIHUub3BlcmFuZC5hY2NlcHQodGhpcykpOyB9LFxuICAgICAgICB2aXNpdENhbGwoYykgeyByZXR1cm4gbmV3IFEuQ2FsbChjLm5hbWUsIGMuYXJncy5tYXAoKGFyZykgPT4gYXJnLmFjY2VwdCh0aGlzKSkpOyB9LFxuICAgICAgICB2aXNpdExhbWJkYShsKSB7IHJldHVybiBuZXcgUS5MYW1iZGEobC5ib2R5LmFjY2VwdCh0aGlzKSwgbC5wYXJhbSk7IH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gZXhwcjtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdFYxUXVlcnkoZXhwcjogUS5FeHByKSB7XG4gICAgY29uc3QgcTogeyBxdWVyeT86IHN0cmluZywgdHlwZT86IHN0cmluZyB9ID0ge307XG4gICAgY29uc3QgdjFFeHByID0gZXhwci5hY2NlcHQ8US5FeHByPih7XG4gICAgICB2aXNpdENvbnN0KGMpIHsgcmV0dXJuIGM7IH0sXG4gICAgICB2aXNpdFBhcmFtKHApIHsgcmV0dXJuIHA7IH0sXG4gICAgICB2aXNpdFByb3AocCkgeyByZXR1cm4gbmV3IFEuUHJvcChwLmluc3RhbmNlLmFjY2VwdCh0aGlzKSwgcC5uYW1lKTsgfSxcbiAgICAgIHZpc2l0QmluYXJ5KGIpIHtcbiAgICAgICAgY29uc3QgbCA9IGIubGVmdC5hY2NlcHQodGhpcyk7XG4gICAgICAgIGNvbnN0IHIgPSBiLnJpZ2h0LmFjY2VwdCh0aGlzKTtcbiAgICAgICAgaWYgKGwgaW5zdGFuY2VvZiBRLkNvbnN0ICYmICg8YW55PiBsLnZhbHVlID09PSB0cnVlIHx8IDxhbnk+IGwudmFsdWUgPT09ICd0cnVlJykpIHtcbiAgICAgICAgICAgIHJldHVybiByO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyIGluc3RhbmNlb2YgUS5Db25zdCAmJiAoPGFueT4gci52YWx1ZSA9PT0gdHJ1ZSB8fCA8YW55PiByLnZhbHVlID09PSAndHJ1ZScpKSB7XG4gICAgICAgICAgICByZXR1cm4gbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFEuQmluT3AobCwgYi5vcCwgcik7XG4gICAgICB9LFxuICAgICAgdmlzaXRVbmFyeSh1KSB7IHJldHVybiBuZXcgUS5Vbk9wKHUub3AsIHUub3BlcmFuZC5hY2NlcHQodGhpcykpOyB9LFxuICAgICAgdmlzaXRDYWxsKGMpIHtcbiAgICAgICAgaWYgKCdwYXJ0aWFsTWF0Y2gnID09PSBjLm5hbWUgJiYgMiA9PT0gYy5hcmdzLmxlbmd0aCkge1xuICAgICAgICAgIGNvbnN0IGFyZyA9IGMuYXJnc1sxXTtcbiAgICAgICAgICBpZiAoYXJnIGluc3RhbmNlb2YgUS5Db25zdCAmJiBhcmcudmFsdWUpIHtcbiAgICAgICAgICAgIHEucXVlcnkgPSBhcmcudmFsdWU7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFEuQ29uc3QoPGFueT4gdHJ1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignbm90IHN1cHBvcnRlZCBwYXJ0aWFsIG1hdGNoIGluIHByb3RvY29sIHYxJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCdleGFjdE1hdGNoJyA9PT0gYy5uYW1lICYmIDIgPT09IGMuYXJncy5sZW5ndGgpIHtcbiAgICAgICAgICBjb25zdCBhcmcgPSBjLmFyZ3NbMV07XG4gICAgICAgICAgaWYgKGFyZyBpbnN0YW5jZW9mIFEuQ29uc3QgJiYgYXJnLnZhbHVlKSB7XG4gICAgICAgICAgICBxLnF1ZXJ5ID0gYXJnLnZhbHVlO1xuICAgICAgICAgICAgcS50eXBlID0gJ2V4YWN0JztcbiAgICAgICAgICAgIHJldHVybiBuZXcgUS5Db25zdCg8YW55PiB0cnVlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdub3Qgc3VwcG9ydGVkIGV4YWN0IG1hdGNoIGluIHByb3RvY29sIHYxJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBRLkNhbGwoYy5uYW1lLCBjLmFyZ3MubWFwKChhcmcpID0+IGFyZy5hY2NlcHQodGhpcykpKTtcbiAgICAgIH0sXG4gICAgICB2aXNpdExhbWJkYShsKSB7IHJldHVybiBuZXcgUS5MYW1iZGEobC5ib2R5LmFjY2VwdCh0aGlzKSwgbC5wYXJhbSk7IH1cbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgICBleHByOiB2MUV4cHIsXG4gICAgICAgIHF1ZXJ5OiBxXG4gICAgfTtcbiAgfVxuXG4gIGdldCBlc2NhcGVkUHJlZGljYXRlKCkge1xuICAgIHJldHVybiB0aGlzLmVzY2FwZSh0aGlzLnByZWRpY2F0ZSk7XG4gIH1cbiAgZ2V0IGVzY2FwZWRTb3J0QnkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZXNjYXBlKHRoaXMuc29ydEJ5KTtcbiAgfVxuICBmaWx0ZXIocHJlZGljYXRlOiBzdHJpbmd8US5MYW1iZGEpIHtcbiAgICBjb25zdCBwID0gJ3N0cmluZycgPT09IHR5cGVvZiBwcmVkaWNhdGUgPyBRLnBhcnNlKHByZWRpY2F0ZSkgOiBwcmVkaWNhdGU7XG4gICAgaWYgKCEocCBpbnN0YW5jZW9mIFEuTGFtYmRhKSkge1xuICAgICAgdGhyb3cgVHlwZUVycm9yKCdwcmVkaWNhdGUgbXVzdCBiZSBhIGxhbWJkYSBleHByZXNzaW9uJyk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUgPyB0aGlzLnByZWRpY2F0ZS5hbmQocCkgOiBwLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIHRoaXMuY3VzdG9tT3B0aW9ucyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uXG4gICAgKTtcbiAgfVxuICBza2lwKG46IG51bWJlcik6IFF1ZXJ5PFQ+IHtcbiAgICBpZiAoMCA9PT0gbikge1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIGNoZWNrTnVtKG4sICdza2lwIHBhcmFtZXRlciBtdXN0IGJlIG5vbi1uZWdhdGl2ZSB3aG9sZSBudW1iZXIuJyk7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICBuLCAvLyBUT0RPOiBFenQgdsOpZ2lnIGtlbGwgZ29uZG9sbmksIG1lcnQgbGVoZXQgKHRoaXMub2Zmc2V0ICsgbikga2VsbGVuZSBpZGU/XG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgdGhpcy5jdXN0b21PcHRpb25zLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb25cbiAgICApO1xuICB9XG4gIHRha2UobjogbnVtYmVyKTogUXVlcnk8VD4ge1xuICAgIGNoZWNrTnVtKG4sICd0YWtlIHBhcmFtZXRlciBtdXN0IGJlIG5vbi1uZWdhdGl2ZSB3aG9sZSBudW1iZXIuJyk7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICB0aGlzLm9mZnNldCxcbiAgICAgIG4sXG4gICAgICB0aGlzLnByZWRpY2F0ZSxcbiAgICAgIHRoaXMuc29ydEJ5LFxuICAgICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24sXG4gICAgICB0aGlzLmN1c3RvbU9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvbik7XG4gIH1cbiAgb3JkZXJCeShzZWxlY3Rvcjogc3RyaW5nLCBkaXJlY3Rpb24/OiBRdWVyeVNvcnREaXJlY3Rpb24pOiBRdWVyeTxUPiB7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICB0aGlzLm9mZnNldCxcbiAgICAgIHRoaXMuY291bnQsXG4gICAgICB0aGlzLnByZWRpY2F0ZSxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMiA/IHRoaXMuZXNjYXBlKFEucGFyc2Uoc2VsZWN0b3IpKSA6IHNlbGVjdG9yLFxuICAgICAgZGlyZWN0aW9uIHx8IFF1ZXJ5U29ydERpcmVjdGlvbi5Bc2MsXG4gICAgICB0aGlzLmN1c3RvbU9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvbik7XG4gIH1cbiAgc2V0Q3VzdG9tT3B0aW9ucyhvcHRpb25zOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfSwgcmVwbGFjZT86IGJvb2xlYW4pOiBRdWVyeTxUPiB7XG4gICAgY29uc3Qgb3B0cyA9IHJlcGxhY2UgPyAob3B0aW9ucyB8fCB7fSkgOiBPYmplY3QuYXNzaWduKHt9LCB0aGlzLmN1c3RvbU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgb3B0cyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uKTtcbiAgfVxuICBhc3luYyB0b3RhbChjYW5jZWxsYXRpb246IENhbmNlbGxhdGlvbik6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgbGV0IHByZWRpY2F0ZTogc3RyaW5nO1xuICAgIGxldCB2MVF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZDtcbiAgICBpZiAoIXRoaXMucHJlZGljYXRlKSB7XG4gICAgICBwcmVkaWNhdGUgPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMikge1xuICAgICAgICBjb25zdCBkYXRhID0gdGhpcy5leHRyYWN0VjFRdWVyeSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKGRhdGEuZXhwcik7XG4gICAgICAgIHYxUXVlcnkgPSBkYXRhLnF1ZXJ5O1xuICAgICAgICBpZiAocHJlZGljYXRlICYmIHByZWRpY2F0ZS5zdGFydHNXaXRoKCcoJykgJiYgcHJlZGljYXRlLmVuZHNXaXRoKCcpJykpIHtcbiAgICAgICAgICBwcmVkaWNhdGUgPSBwcmVkaWNhdGUuc3Vic3RyKDEsIHByZWRpY2F0ZS5sZW5ndGggLSAyKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJlZGljYXRlID09PSAndHJ1ZScpIHtcbiAgICAgICAgICBwcmVkaWNhdGUgPSAnJztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5yZXBvLnRvdGFsKHByZWRpY2F0ZSwgdjFRdWVyeSwgdGhpcy5jdXN0b21PcHRpb25zLCBjYW5jZWxsYXRpb24pO1xuICB9XG4gIGV4ZWMoKTogQXN5bmNJdGVyYWJsZTxUPiB7XG4gICAgbGV0IHByZWRpY2F0ZTogc3RyaW5nO1xuICAgIGxldCB2MVF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZDtcbiAgICBpZiAoIXRoaXMucHJlZGljYXRlKSB7XG4gICAgICBwcmVkaWNhdGUgPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMikge1xuICAgICAgICBjb25zdCBkYXRhID0gdGhpcy5leHRyYWN0VjFRdWVyeSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKGRhdGEuZXhwcik7XG4gICAgICAgIHYxUXVlcnkgPSBkYXRhLnF1ZXJ5O1xuICAgICAgICBpZiAocHJlZGljYXRlICYmIHByZWRpY2F0ZS5zdGFydHNXaXRoKCcoJykgJiYgcHJlZGljYXRlLmVuZHNXaXRoKCcpJykpIHtcbiAgICAgICAgICBwcmVkaWNhdGUgPSBwcmVkaWNhdGUuc3Vic3RyKDEsIHByZWRpY2F0ZS5sZW5ndGggLSAyKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocHJlZGljYXRlID09PSAndHJ1ZScpIHtcbiAgICAgICAgICBwcmVkaWNhdGUgPSAnJztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bWF4LWxpbmUtbGVuZ3RoXG4gICAgcmV0dXJuIHRoaXMucmVwby5leGVjKHRoaXMub2Zmc2V0LCB0aGlzLmNvdW50LCBwcmVkaWNhdGUsIHRoaXMuc29ydEJ5LCB0aGlzLnNvcnRCeURpcmVjdGlvbiwgdjFRdWVyeSwgdGhpcy5jdXN0b21PcHRpb25zKTtcbiAgfVxufVxuIl19