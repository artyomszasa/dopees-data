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
            headers.append('X-Query', encodeURIComponent(query.query));
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
                                headers.append('X-Query', encodeURIComponent(query.query));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxLQUFLLEVBQWMsa0JBQWtCLEVBQWlCLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEYsT0FBTyxLQUFLLENBQUMsTUFBTSxZQUFZLENBQUM7QUFDaEMsT0FBTyxFQUEyQixTQUFTLEVBQWdCLE1BQU0sdUJBQXVCLENBQUM7QUFDekYsT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsQ0FBQztBQUU3QyxPQUFPLEVBQUUsVUFBVSxFQUFFLHVCQUF1QixFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDM0UsT0FBTyxFQUFFLEdBQUcsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBRTFDLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxHQUFXLEVBQUUsRUFBRTtJQUN2Qyw2RUFBNkU7SUFDN0UsT0FBTyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxVQUFTLENBQUM7UUFDeEQsT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNqRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNmLENBQUMsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBUyxFQUFFLE9BQWUsRUFBRSxFQUFFO0lBQzlDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6QixNQUFNLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0tBQzlCO0FBQ0gsQ0FBQyxDQUFDO0FBb0NGLE1BQU0s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QUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2FBQ3pDO1NBQ0Y7UUFDRCwyQ0FBMkM7UUFDM0MsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLGVBQWUsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzVILENBQUM7O0FBcE1NLHNCQUFZLEdBQUcsTUFBTSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUXVlcnksIFJlcG9zaXRvcnksIFF1ZXJ5U29ydERpcmVjdGlvbiwgS2V5UmVwb3NpdG9yeSB9IGZyb20gJy4vcmVwb3NpdG9yaWVzJztcbmltcG9ydCAqIGFzIFEgZnJvbSAnLi9wcm90b2NvbCc7XG5pbXBvcnQgeyBkZWNvcmF0ZWRGZXRjaCBhcyBmZXRjaCwgSHR0cEVycm9yLCBSZXNwb25zZUxpa2UgfSBmcm9tICdkb3BlZXMtY29yZS9saWIvZmV0Y2gnO1xuaW1wb3J0ICogYXMgdXRmOCBmcm9tICdkb3BlZXMtY29yZS9saWIvdXRmOCc7XG5pbXBvcnQgeyBDYW5jZWxsYXRpb24gfSBmcm9tICdkb3BlZXMtY29yZS9saWIvY2FuY2VsbGF0aW9uJztcbmltcG9ydCB7IEh0dHBDbGllbnQsIGh0dHBDbGllbnRDb25maWd1cmF0aW9uIH0gZnJvbSAnZG9wZWVzLWNvcmUvbGliL2h0dHAnO1xuaW1wb3J0IHsgVXJpIH0gZnJvbSAnZG9wZWVzLWNvcmUvbGliL3VyaSc7XG5cbmNvbnN0IGI2NERlY29kZVVuaWNvZGUgPSAoc3RyOiBzdHJpbmcpID0+IHtcbiAgLy8gR29pbmcgYmFja3dhcmRzOiBmcm9tIGJ5dGVzdHJlYW0sIHRvIHBlcmNlbnQtZW5jb2RpbmcsIHRvIG9yaWdpbmFsIHN0cmluZy5cbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChhdG9iKHN0cikuc3BsaXQoJycpLm1hcChmdW5jdGlvbihjKSB7XG4gICAgICByZXR1cm4gJyUnICsgKCcwMCcgKyBjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpKS5zbGljZSgtMik7XG4gIH0pLmpvaW4oJycpKTtcbn07XG5cbmNvbnN0IGNoZWNrTnVtID0gKG46IG51bWJlciwgbWVzc2FnZTogc3RyaW5nKSA9PiB7XG4gIGlmIChuICUgMSAhPT0gMCB8fCBuIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKG1lc3NhZ2UpO1xuICB9XG59O1xuXG5pbnRlcmZhY2UgUmVzdFJlcG9zaXRvcnlPcHRpb25zIHtcbiAgdHlwZTogc3RyaW5nO1xuICBlbmRwb2ludDogc3RyaW5nO1xuICBrZXlQcm9wZXJ0eT86IHN0cmluZztcbiAgcHJvdG9jb2xWZXJzaW9uPzogbnVtYmVyO1xuICBjb25maWd1cmF0aW9uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFYxUXVlcnkge1xuICBxdWVyeT86IHN0cmluZztcbiAgdHlwZT86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXN0UmVwb3NpdG9yeTxUPiBleHRlbmRzIFJlcG9zaXRvcnk8VD4ge1xuICBleGVjKFxuICAgIG9mZnNldDogbnVtYmVyLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgcHJlZGljYXRlOiBzdHJpbmcsXG4gICAgc29ydEJ5Pzogc3RyaW5nLFxuICAgIHNvcnRCeURpcmVjdGlvbj86XG4gICAgUXVlcnlTb3J0RGlyZWN0aW9uLFxuICAgIHF1ZXJ5PzogVjFRdWVyeSxcbiAgICBjdXN0b21PcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sXG4gICAgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uXG4gICk6IEFzeW5jSXRlcmFibGU8VD47XG5cbiAgdG90YWwoXG4gICAgcHJlZGljYXRlOiBzdHJpbmcsXG4gICAgcXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkLFxuICAgIGN1c3RvbU9wdGlvbnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LFxuICAgIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uXG4gICk6IFByb21pc2U8bnVtYmVyPjtcbn1cblxuZXhwb3J0IGNsYXNzIEtleVJlc3RSZXBvc2l0b3J5PFREYXRhLCBUS2V5PiBpbXBsZW1lbnRzIEtleVJlcG9zaXRvcnk8VERhdGEsIFRLZXk+LCBSZXN0UmVwb3NpdG9yeTxURGF0YT4ge1xuICByZWFkb25seSBjbGllbnRGYWN0b3J5OiAoKSA9PiBIdHRwQ2xpZW50O1xuICByZWFkb25seSBvcHRpb25zOiBSZXN0UmVwb3NpdG9yeU9wdGlvbnM7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUmVzdFJlcG9zaXRvcnlPcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICBjb25zdCByZXN0TWVzc2FnZUhhbmRsZXIgPSBodHRwQ2xpZW50Q29uZmlndXJhdGlvbi5nZXRIYW5kbGVyKChvcHRpb25zICYmIG9wdGlvbnMuY29uZmlndXJhdGlvbikgfHwgJ3Jlc3QnKTtcbiAgICB0aGlzLmNsaWVudEZhY3RvcnkgPSAoKSA9PiBuZXcgSHR0cENsaWVudChyZXN0TWVzc2FnZUhhbmRsZXIpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgY29sbGVjdGlvbkVuZHBvaW50KCkge1xuICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX1gO1xuICB9XG5cbiAgZ2V0IHByb3RvY29sVmVyc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLnByb3RvY29sVmVyc2lvbiB8fCAyO1xuICB9XG5cbiAgZ2V0IHR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy50eXBlO1xuICB9XG5cbiAgZ2V0IGVuZHBvaW50KCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMuZW5kcG9pbnQ7XG4gIH1cblxuICBnZXQga2V5UHJvcGVydHkoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5rZXlQcm9wZXJ0eSB8fCAnaWQnO1xuICB9XG5cbiAgZ2V0IGl0ZW1zKCk6IFF1ZXJ5PFREYXRhPiB7XG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFREYXRhPih0aGlzLCAwLCBSZXN0UXVlcnkuZGVmYXVsdENvdW50LCBudWxsLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwge30sIHRoaXMub3B0aW9ucy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEtleShpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiAoaXRlbSBhcyBhbnkpW3RoaXMua2V5UHJvcGVydHldIGFzIFRLZXk7XG4gIH1cblxuICBwcml2YXRlIGhhc0tleShpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiAhIXRoaXMuZ2V0S2V5KGl0ZW0pO1xuICB9XG5cbiAgcHJpdmF0ZSBpdGVtRW5kcG9pbnQoaXRlbTogVERhdGEpIHtcbiAgICByZXR1cm4gYCR7dGhpcy5lbmRwb2ludH0vJHt0aGlzLnR5cGV9LyR7dGhpcy5nZXRLZXkoaXRlbSl9YDtcbiAgfVxuXG4gIHByaXZhdGUgX19nZXRFcnJvcihyZXNwb25zZTogUmVzcG9uc2VMaWtlKTogSHR0cEVycm9yIHtcbiAgICBjb25zdCBtZXNzYWdlcyA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdYLU1lc3NhZ2UnKTtcbiAgICBpZiAobWVzc2FnZXMpIHtcbiAgICAgIGxldCB0ZXh0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICB0ZXh0ID0gYjY0RGVjb2RlVW5pY29kZShtZXNzYWdlcyk7XG4gICAgICB9IGNhdGNoIChleG4pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB0ZXh0ID0gZGVjb2RlVVJJQ29tcG9uZW50KG1lc3NhZ2VzKTtcbiAgICAgICAgfSBjYXRjaCAoZXhuKSB7XG4gICAgICAgICAgdGV4dCA9IG1lc3NhZ2VzO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IEh0dHBFcnJvcihyZXNwb25zZSwgdGV4dCk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgSHR0cEVycm9yKHJlc3BvbnNlKTtcbiAgfVxuXG4gIGFzeW5jIGxvb2t1cChrZXk6IFRLZXksIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8VERhdGE+IHtcbiAgICBjb25zdCB1cmkgPSBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX0vJHtrZXl9YDtcbiAgICByZXR1cm4gdGhpcy5jbGllbnRGYWN0b3J5KCkuZ2V0SnNvbih1cmksIGNhbmNlbGxhdGlvbik7XG4gIH1cblxuICBhc3luYyB1cGRhdGUoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8VERhdGE+IHtcbiAgICBpZiAoIWl0ZW0pIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VuYWJsZSB0byB1cGRhdGUgZW1wdHkgdmFsdWUnKTtcbiAgICB9XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNsaWVudEZhY3RvcnkoKS5wdXQodGhpcy5pdGVtRW5kcG9pbnQoaXRlbSksIDxhbnk+IGl0ZW0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb29rdXAodGhpcy5nZXRLZXkoaXRlbSksIGNhbmNlbGxhdGlvbik7XG4gICAgfVxuICAgIHRocm93IHRoaXMuX19nZXRFcnJvcihyZXNwb25zZSk7XG4gIH1cblxuICBhc3luYyBpbnNlcnQoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGlmICghaXRlbSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndW5hYmxlIHRvIGluc2VydCBlbXB0eSB2YWx1ZScpO1xuICAgIH1cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2xpZW50RmFjdG9yeSgpLnBvc3QodGhpcy5jb2xsZWN0aW9uRW5kcG9pbnQsIDxhbnk+IGl0ZW0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCB1cmkgPSByZXNwb25zZS5oZWFkZXJzLmdldCgnTG9jYXRpb24nKTtcbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcigncmVzdCBpbnNlcnQgZGlkIG5vdCByZXR1cm4gYSBsb2NhdGlvbicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuY2xpZW50RmFjdG9yeSgpLmdldEpzb24odXJpLCBjYW5jZWxsYXRpb24pO1xuICAgIH1cbiAgICB0aHJvdyB0aGlzLl9fZ2V0RXJyb3IocmVzcG9uc2UpO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlKGl0ZW06IFREYXRhLCBjYW5jZWxsYXRpb246IENhbmNlbGxhdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnRGYWN0b3J5KCkuZGVsZXRlKHRoaXMuaXRlbUVuZHBvaW50KGl0ZW0pLCBjYW5jZWxsYXRpb24pO1xuICAgIGlmICgyMDAgPT09IHJlc3BvbnNlLnN0YXR1cyB8fCAyMDIgPT09IHJlc3BvbnNlLnN0YXR1cyB8fCAyMDQgPT09IHJlc3BvbnNlLnN0YXR1cykge1xuICAgICAgLy8gc3VjY2VzcztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhyb3cgdGhpcy5fX2dldEVycm9yKHJlc3BvbnNlKTtcbiAgfVxuXG4gIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTptYXgtbGluZS1sZW5ndGhcbiAgYXN5bmMgdG90YWwocHJlZGljYXRlOiBzdHJpbmcsIHF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZCwgY3VzdG9tT3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgICBoZWFkZXJzLmFwcGVuZCgnQWNjZXB0JywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcbiAgICBoZWFkZXJzLmFwcGVuZCgnWC1GaWx0ZXInLCBwcmVkaWNhdGUpO1xuICAgIGhlYWRlcnMuYXBwZW5kKCdYLUNvdW50JywgJzAnKTtcbiAgICBpZiAocXVlcnkgJiYgcXVlcnkucXVlcnkpIHtcbiAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVF1ZXJ5JywgZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5LnF1ZXJ5KSk7XG4gICAgICBoZWFkZXJzLmFwcGVuZCgnWC1TZWFyY2hUeXBlJywgcXVlcnkudHlwZSB8fCAncGFydGlhbCcpO1xuICAgIH1cbiAgICBjb25zdCBjdXN0b21LZXlzID0gT2JqZWN0LmtleXMoY3VzdG9tT3B0aW9ucyB8fCB7fSk7XG4gICAgY3VzdG9tS2V5cy5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gY3VzdG9tT3B0aW9uc1trZXldO1xuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIGhlYWRlcnMuYXBwZW5kKGtleSwgdmFsdWUpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnRGYWN0b3J5KCkuc2VuZCh7XG4gICAgICB1cmk6IG5ldyBVcmkodGhpcy5jb2xsZWN0aW9uRW5kcG9pbnQpLFxuICAgICAgaGVhZGVyc1xuICAgIH0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSByZXNwb25zZS5oZWFkZXJzLmdldCgnWC1Ub3RhbC1Db3VudCcpO1xuICAgICAgcmV0dXJuIGhlYWRlciA/IChwYXJzZUludChoZWFkZXIsIDEwKSB8fCAwKSA6IDA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSGliYSBsw6lwZXR0IGZlbCBhZGF0b2sgbGVrw6lyZGV6w6lzZSBrw7Z6YmVuOiAke3Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gICAgfVxuICB9XG5cbiAgZXhlYyhcbiAgICBvZmZzZXQ6IG51bWJlcixcbiAgICBjb3VudDogbnVtYmVyLFxuICAgIHByZWRpY2F0ZTogc3RyaW5nLFxuICAgIHNvcnRCeT86IHN0cmluZyxcbiAgICBzb3J0QnlEaXJlY3Rpb24/OiBRdWVyeVNvcnREaXJlY3Rpb24sXG4gICAgcXVlcnk/OiBWMVF1ZXJ5LFxuICAgIGN1c3RvbU9wdGlvbnM/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfSxcbiAgICBjYW5jZWxsYXRpb24/OiBDYW5jZWxsYXRpb25cbiAgKTogQXN5bmNJdGVyYWJsZTxURGF0YT4ge1xuICAgIGNvbnN0IHJlcG8gPSB0aGlzO1xuICAgIGxldCBlcnJvcjogYW55ID0gbnVsbDtcbiAgICBsZXQgaXRlbXM6IFREYXRhW118bnVsbCA9IG51bGw7XG4gICAgbGV0IGluZGV4ID0gMDtcbiAgICByZXR1cm4ge1xuICAgICAgW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSgpOiBBc3luY0l0ZXJhdG9yPFREYXRhPiB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgYXN5bmMgbmV4dCgpOiBQcm9taXNlPEl0ZXJhdG9yUmVzdWx0PFREYXRhPj4ge1xuICAgICAgICAgICAgaWYgKGNhbmNlbGxhdGlvbikge1xuICAgICAgICAgICAgICBjYW5jZWxsYXRpb24udGhyb3dJZkNhbmNlbGxlZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG51bGwgIT09IGVycm9yKSB7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFpdGVtcykge1xuICAgICAgICAgICAgICAvLyBFbHPFkSBuZXh0KCkgbWVnaMOtdsOhc2Frb3IgZXogZnV0IGxlLlxuICAgICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLU9mZnNldCcsIFN0cmluZyhvZmZzZXQpKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtQ291bnQnLCBTdHJpbmcoY291bnQpKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtRmlsdGVyJywgcHJlZGljYXRlKTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU29ydC1CeScsIHNvcnRCeSB8fCAnJyk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNvcnQtQnktRGlyZWN0aW9uJywgc29ydEJ5RGlyZWN0aW9uIHx8ICcnKTtcbiAgICAgICAgICAgICAgaWYgKHF1ZXJ5ICYmIHF1ZXJ5LnF1ZXJ5KSB7XG4gICAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtUXVlcnknLCBlbmNvZGVVUklDb21wb25lbnQocXVlcnkucXVlcnkpKTtcbiAgICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1TZWFyY2hUeXBlJywgcXVlcnkudHlwZSB8fCAncGFydGlhbCcpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNvbnN0IGN1c3RvbUtleXMgPSBPYmplY3Qua2V5cyhjdXN0b21PcHRpb25zIHx8IHt9KTtcbiAgICAgICAgICAgICAgY3VzdG9tS2V5cy5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2YWwgPSAoY3VzdG9tT3B0aW9ucyB8fCB7fSlba2V5XTtcbiAgICAgICAgICAgICAgICBpZiAodmFsKSB7XG4gICAgICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZChrZXksIHZhbCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgLy8gY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChyZXBvLmNvbGxlY3Rpb25FbmRwb2ludCwgeyBoZWFkZXJzLCBzaWduYWw6IGFib3J0aW9uLnNpZ25hbCB9KTtcbiAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXBvLmNsaWVudEZhY3RvcnkoKS5zZW5kKHtcbiAgICAgICAgICAgICAgICB1cmk6IFVyaS5mcm9tKHJlcG8uY29sbGVjdGlvbkVuZHBvaW50KSxcbiAgICAgICAgICAgICAgICBoZWFkZXJzXG4gICAgICAgICAgICAgIH0sIGNhbmNlbGxhdGlvbik7XG4gICAgICAgICAgICAgIGlmIChyZXNwb25zZS5vayAmJiByZXNwb25zZS5jb250ZW50KSB7XG4gICAgICAgICAgICAgICAgaXRlbXMgPSBhd2FpdCByZXNwb25zZS5jb250ZW50Lmpzb24oKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBlcnJvciA9IG5ldyBFcnJvcihgSGliYSBsw6lwZXR0IGZlbCBhZGF0b2sgbGVrw6lyZGV6w6lzZSBrw7Z6YmVuOiAke3Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghaXRlbXMpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdzaG91bGQgbmV2ZXIgaGFwcGVuJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaW5kZXggPj0gaXRlbXMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgIHJldHVybiB7IGRvbmU6IHRydWUsIHZhbHVlOiA8YW55PiB1bmRlZmluZWQgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gaXRlbXNbaW5kZXhdO1xuICAgICAgICAgICAgKytpbmRleDtcbiAgICAgICAgICAgIHJldHVybiB7IGRvbmU6IGZhbHNlLCB2YWx1ZSB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9O1xuICB9XG59XG5cbmNvbnN0IHJlZ2V4ID0gL1tcXDAtXFx4MDhcXG4tXFx4MUZcXHg3Ri1cXHVGRkZGXS9nO1xuXG5leHBvcnQgY2xhc3MgUmVzdFF1ZXJ5PFQ+IGV4dGVuZHMgUXVlcnk8VD4ge1xuICBzdGF0aWMgZGVmYXVsdENvdW50ID0gMTAwMDAwO1xuICByZWFkb25seSByZXBvOiBSZXN0UmVwb3NpdG9yeTxUPjtcbiAgcmVhZG9ubHkgb2Zmc2V0OiBudW1iZXI7XG4gIHJlYWRvbmx5IGNvdW50OiBudW1iZXI7XG4gIHJlYWRvbmx5IHByZWRpY2F0ZTogUS5MYW1iZGF8bnVsbDtcbiAgcmVhZG9ubHkgc29ydEJ5OiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNvcnRCeURpcmVjdGlvbjogUXVlcnlTb3J0RGlyZWN0aW9uO1xuICByZWFkb25seSBwcm90b2NvbFZlcnNpb246IG51bWJlcjtcbiAgcmVhZG9ubHkgY3VzdG9tT3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH07XG4gIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTptYXgtbGluZS1sZW5ndGhcbiAgY29uc3RydWN0b3IocmVwbzogUmVzdFJlcG9zaXRvcnk8VD4sIG9mZnNldDogbnVtYmVyLCBjb3VudDogbnVtYmVyLCBwcmVkaWNhdGU/OiBRLkxhbWJkYXxudWxsLCBzb3J0Qnk/OiBzdHJpbmcsIHNvcnRCeURpcmVjdGlvbj86IFF1ZXJ5U29ydERpcmVjdGlvbiwgY3VzdG9tT3B0aW9ucz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LCBwcm90b2NvbFZlcnNpb24/OiBudW1iZXIpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVwbyA9IHJlcG87XG4gICAgdGhpcy5vZmZzZXQgPSBvZmZzZXQgfHwgMDtcbiAgICB0aGlzLmNvdW50ID0gMCA9PT0gY291bnQgPyBjb3VudCA6IChjb3VudCB8fCBSZXN0UXVlcnkuZGVmYXVsdENvdW50KTtcbiAgICB0aGlzLnByZWRpY2F0ZSA9IHByZWRpY2F0ZSB8fCBudWxsO1xuICAgIHRoaXMuc29ydEJ5ID0gc29ydEJ5IHx8ICcnO1xuICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uID0gc29ydEJ5RGlyZWN0aW9uIHx8IFF1ZXJ5U29ydERpcmVjdGlvbi5Bc2M7XG4gICAgdGhpcy5jdXN0b21PcHRpb25zID0gY3VzdG9tT3B0aW9ucyB8fCB7fTtcbiAgICB0aGlzLnByb3RvY29sVmVyc2lvbiA9IHByb3RvY29sVmVyc2lvbiB8fCAyO1xuICB9XG4gIHByaXZhdGUgZXNjYXBlKGlucHV0OiBzdHJpbmd8US5FeHByfG51bGwpIHtcbiAgICBpZiAoIWlucHV0KSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICAgIGNvbnN0IGlucCA9IGlucHV0IGluc3RhbmNlb2YgUS5FeHByID8gdGhpcy5hcHBseVByb3RvY29sKGlucHV0KS50b1N0cmluZygpIDogaW5wdXQ7XG4gICAgcmV0dXJuIHV0ZjhcbiAgICAgIC51dGY4ZW5jb2RlKGlucClcbiAgICAgIC5yZXBsYWNlKHJlZ2V4LCAobSkgPT4gJyUnICsgKCcwJyArIG0uY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKSkuc2xpY2UoLTIpKTtcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlQcm90b2NvbChleHByOiBRLkV4cHIpIHtcbiAgICBpZiAodGhpcy5wcm90b2NvbFZlcnNpb24gPCAyICYmIGV4cHIgaW5zdGFuY2VvZiBRLkxhbWJkYSkge1xuICAgICAgY29uc3QgcGFyYW0gPSBleHByLnBhcmFtO1xuICAgICAgcmV0dXJuIGV4cHIuYm9keS5hY2NlcHQ8US5FeHByPih7XG4gICAgICAgIHZpc2l0Q29uc3QoYykgeyByZXR1cm4gYzsgfSxcbiAgICAgICAgdmlzaXRQYXJhbShwKSB7IHJldHVybiBwOyB9LFxuICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bWF4LWxpbmUtbGVuZ3RoXG4gICAgICAgIHZpc2l0UHJvcChwKSB7IHJldHVybiBwLmluc3RhbmNlLmVxKHBhcmFtKSA/IG5ldyBRLlBhcmFtKDxhbnk+IHAubmFtZSkgOiBuZXcgUS5Qcm9wKHAuaW5zdGFuY2UuYWNjZXB0KHRoaXMpLCBwLm5hbWUpOyB9LFxuICAgICAgICB2aXNpdEJpbmFyeShiKSB7IHJldHVybiBuZXcgUS5CaW5PcChiLmxlZnQuYWNjZXB0KHRoaXMpLCBiLm9wLCBiLnJpZ2h0LmFjY2VwdCh0aGlzKSk7IH0sXG4gICAgICAgIHZpc2l0VW5hcnkodSkgeyByZXR1cm4gbmV3IFEuVW5PcCh1Lm9wLCB1Lm9wZXJhbmQuYWNjZXB0KHRoaXMpKTsgfSxcbiAgICAgICAgdmlzaXRDYWxsKGMpIHsgcmV0dXJuIG5ldyBRLkNhbGwoYy5uYW1lLCBjLmFyZ3MubWFwKChhcmcpID0+IGFyZy5hY2NlcHQodGhpcykpKTsgfSxcbiAgICAgICAgdmlzaXRMYW1iZGEobCkgeyByZXR1cm4gbmV3IFEuTGFtYmRhKGwuYm9keS5hY2NlcHQodGhpcyksIGwucGFyYW0pOyB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cHI7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RWMVF1ZXJ5KGV4cHI6IFEuRXhwcikge1xuICAgIGNvbnN0IHE6IHsgcXVlcnk/OiBzdHJpbmcgfSA9IHt9O1xuICAgIGNvbnN0IHYxRXhwciA9IGV4cHIuYWNjZXB0PFEuRXhwcj4oe1xuICAgICAgdmlzaXRDb25zdChjKSB7IHJldHVybiBjOyB9LFxuICAgICAgdmlzaXRQYXJhbShwKSB7IHJldHVybiBwOyB9LFxuICAgICAgdmlzaXRQcm9wKHApIHsgcmV0dXJuIG5ldyBRLlByb3AocC5pbnN0YW5jZS5hY2NlcHQodGhpcyksIHAubmFtZSk7IH0sXG4gICAgICB2aXNpdEJpbmFyeShiKSB7XG4gICAgICAgIGNvbnN0IGwgPSBiLmxlZnQuYWNjZXB0KHRoaXMpO1xuICAgICAgICBjb25zdCByID0gYi5yaWdodC5hY2NlcHQodGhpcyk7XG4gICAgICAgIGlmIChsIGluc3RhbmNlb2YgUS5Db25zdCAmJiAoPGFueT4gbC52YWx1ZSA9PT0gdHJ1ZSB8fCA8YW55PiBsLnZhbHVlID09PSAndHJ1ZScpKSB7XG4gICAgICAgICAgICByZXR1cm4gcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAociBpbnN0YW5jZW9mIFEuQ29uc3QgJiYgKDxhbnk+IHIudmFsdWUgPT09IHRydWUgfHwgPGFueT4gci52YWx1ZSA9PT0gJ3RydWUnKSkge1xuICAgICAgICAgICAgcmV0dXJuIGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBRLkJpbk9wKGwsIGIub3AsIHIpO1xuICAgICAgfSxcbiAgICAgIHZpc2l0VW5hcnkodSkgeyByZXR1cm4gbmV3IFEuVW5PcCh1Lm9wLCB1Lm9wZXJhbmQuYWNjZXB0KHRoaXMpKTsgfSxcbiAgICAgIHZpc2l0Q2FsbChjKSB7XG4gICAgICAgIGlmICgncGFydGlhbE1hdGNoJyA9PT0gYy5uYW1lICYmIDIgPT09IGMuYXJncy5sZW5ndGgpIHtcbiAgICAgICAgICBjb25zdCBhcmcgPSBjLmFyZ3NbMV07XG4gICAgICAgICAgaWYgKGFyZyBpbnN0YW5jZW9mIFEuQ29uc3QgJiYgYXJnLnZhbHVlKSB7XG4gICAgICAgICAgICBxLnF1ZXJ5ID0gYXJnLnZhbHVlO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBRLkNvbnN0KDxhbnk+IHRydWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ25vdCBzdXBwb3J0ZWQgcGFydGlhbCBtYXRjaCBpbiBwcm90b2NvbCB2MScpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgUS5DYWxsKGMubmFtZSwgYy5hcmdzLm1hcCgoYXJnKSA9PiBhcmcuYWNjZXB0KHRoaXMpKSk7XG4gICAgICB9LFxuICAgICAgdmlzaXRMYW1iZGEobCkgeyByZXR1cm4gbmV3IFEuTGFtYmRhKGwuYm9keS5hY2NlcHQodGhpcyksIGwucGFyYW0pOyB9XG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgZXhwcjogdjFFeHByLFxuICAgICAgICBxdWVyeTogcVxuICAgIH07XG4gIH1cblxuICBnZXQgZXNjYXBlZFByZWRpY2F0ZSgpIHtcbiAgICByZXR1cm4gdGhpcy5lc2NhcGUodGhpcy5wcmVkaWNhdGUpO1xuICB9XG4gIGdldCBlc2NhcGVkU29ydEJ5KCkge1xuICAgIHJldHVybiB0aGlzLmVzY2FwZSh0aGlzLnNvcnRCeSk7XG4gIH1cbiAgZmlsdGVyKHByZWRpY2F0ZTogc3RyaW5nfFEuTGFtYmRhKSB7XG4gICAgY29uc3QgcCA9ICdzdHJpbmcnID09PSB0eXBlb2YgcHJlZGljYXRlID8gUS5wYXJzZShwcmVkaWNhdGUpIDogcHJlZGljYXRlO1xuICAgIGlmICghKHAgaW5zdGFuY2VvZiBRLkxhbWJkYSkpIHtcbiAgICAgIHRocm93IFR5cGVFcnJvcigncHJlZGljYXRlIG11c3QgYmUgYSBsYW1iZGEgZXhwcmVzc2lvbicpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIHRoaXMub2Zmc2V0LFxuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlID8gdGhpcy5wcmVkaWNhdGUuYW5kKHApIDogcCxcbiAgICAgIHRoaXMuc29ydEJ5LFxuICAgICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24sXG4gICAgICB0aGlzLmN1c3RvbU9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvblxuICAgICk7XG4gIH1cbiAgc2tpcChuOiBudW1iZXIpOiBRdWVyeTxUPiB7XG4gICAgaWYgKDAgPT09IG4pIHtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICBjaGVja051bShuLCAnc2tpcCBwYXJhbWV0ZXIgbXVzdCBiZSBub24tbmVnYXRpdmUgd2hvbGUgbnVtYmVyLicpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgbiwgLy8gVE9ETzogRXp0IHbDqWdpZyBrZWxsIGdvbmRvbG5pLCBtZXJ0IGxlaGV0ICh0aGlzLm9mZnNldCArIG4pIGtlbGxlbmUgaWRlP1xuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIHRoaXMuY3VzdG9tT3B0aW9ucyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uXG4gICAgKTtcbiAgfVxuICB0YWtlKG46IG51bWJlcik6IFF1ZXJ5PFQ+IHtcbiAgICBjaGVja051bShuLCAndGFrZSBwYXJhbWV0ZXIgbXVzdCBiZSBub24tbmVnYXRpdmUgd2hvbGUgbnVtYmVyLicpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICBuLFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgdGhpcy5jdXN0b21PcHRpb25zLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIG9yZGVyQnkoc2VsZWN0b3I6IHN0cmluZywgZGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uKTogUXVlcnk8VD4ge1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICBzZWxlY3RvcixcbiAgICAgIGRpcmVjdGlvbiB8fCBRdWVyeVNvcnREaXJlY3Rpb24uQXNjLFxuICAgICAgdGhpcy5jdXN0b21PcHRpb25zLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIHNldEN1c3RvbU9wdGlvbnMob3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIHJlcGxhY2U/OiBib29sZWFuKTogUXVlcnk8VD4ge1xuICAgIGNvbnN0IG9wdHMgPSByZXBsYWNlID8gKG9wdGlvbnMgfHwge30pIDogT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5jdXN0b21PcHRpb25zLCBvcHRpb25zKTtcbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIHRoaXMub2Zmc2V0LFxuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIG9wdHMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvbik7XG4gIH1cbiAgYXN5bmMgdG90YWwoY2FuY2VsbGF0aW9uOiBDYW5jZWxsYXRpb24pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGxldCBwcmVkaWNhdGU6IHN0cmluZztcbiAgICBsZXQgdjFRdWVyeTogVjFRdWVyeXx1bmRlZmluZWQ7XG4gICAgaWYgKCF0aGlzLnByZWRpY2F0ZSkge1xuICAgICAgcHJlZGljYXRlID0gJyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLnByb3RvY29sVmVyc2lvbiA8IDIpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHRoaXMuZXh0cmFjdFYxUXVlcnkodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgICBwcmVkaWNhdGUgPSB0aGlzLmVzY2FwZShkYXRhLmV4cHIpO1xuICAgICAgICB2MVF1ZXJ5ID0gZGF0YS5xdWVyeTtcbiAgICAgICAgaWYgKHByZWRpY2F0ZSAmJiBwcmVkaWNhdGUuc3RhcnRzV2l0aCgnKCcpICYmIHByZWRpY2F0ZS5lbmRzV2l0aCgnKScpKSB7XG4gICAgICAgICAgcHJlZGljYXRlID0gcHJlZGljYXRlLnN1YnN0cigxLCBwcmVkaWNhdGUubGVuZ3RoIC0gMik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKHRoaXMucHJlZGljYXRlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucmVwby50b3RhbChwcmVkaWNhdGUsIHYxUXVlcnksIHRoaXMuY3VzdG9tT3B0aW9ucywgY2FuY2VsbGF0aW9uKTtcbiAgfVxuICBleGVjKCk6IEFzeW5jSXRlcmFibGU8VD4ge1xuICAgIGxldCBwcmVkaWNhdGU6IHN0cmluZztcbiAgICBsZXQgdjFRdWVyeTogVjFRdWVyeXx1bmRlZmluZWQ7XG4gICAgaWYgKCF0aGlzLnByZWRpY2F0ZSkge1xuICAgICAgcHJlZGljYXRlID0gJyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLnByb3RvY29sVmVyc2lvbiA8IDIpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHRoaXMuZXh0cmFjdFYxUXVlcnkodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgICBwcmVkaWNhdGUgPSB0aGlzLmVzY2FwZShkYXRhLmV4cHIpO1xuICAgICAgICB2MVF1ZXJ5ID0gZGF0YS5xdWVyeTtcbiAgICAgICAgaWYgKHByZWRpY2F0ZSAmJiBwcmVkaWNhdGUuc3RhcnRzV2l0aCgnKCcpICYmIHByZWRpY2F0ZS5lbmRzV2l0aCgnKScpKSB7XG4gICAgICAgICAgcHJlZGljYXRlID0gcHJlZGljYXRlLnN1YnN0cigxLCBwcmVkaWNhdGUubGVuZ3RoIC0gMik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKHRoaXMucHJlZGljYXRlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICAgIHJldHVybiB0aGlzLnJlcG8uZXhlYyh0aGlzLm9mZnNldCwgdGhpcy5jb3VudCwgcHJlZGljYXRlLCB0aGlzLnNvcnRCeSwgdGhpcy5zb3J0QnlEaXJlY3Rpb24sIHYxUXVlcnksIHRoaXMuY3VzdG9tT3B0aW9ucyk7XG4gIH1cbn1cbiJdfQ==