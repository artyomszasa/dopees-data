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
            return new HttpError(response, b64DecodeUnicode(messages));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxLQUFLLEVBQWMsa0JBQWtCLEVBQWlCLE1BQU0sZ0JBQWdCLENBQUM7QUFDdEYsT0FBTyxLQUFLLENBQUMsTUFBTSxZQUFZLENBQUM7QUFDaEMsT0FBTyxFQUEyQixTQUFTLEVBQWdCLE1BQU0sdUJBQXVCLENBQUM7QUFDekYsT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsQ0FBQztBQUU3QyxPQUFPLEVBQUUsVUFBVSxFQUFFLHVCQUF1QixFQUFFLE1BQU0sc0JBQXNCLENBQUM7QUFDM0UsT0FBTyxFQUFFLEdBQUcsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBRTFDLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxHQUFXLEVBQUUsRUFBRTtJQUN2Qyw2RUFBNkU7SUFDN0UsT0FBTyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxVQUFTLENBQUM7UUFDeEQsT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNqRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNmLENBQUMsQ0FBQztBQUVGLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBUyxFQUFFLE9BQWUsRUFBRSxFQUFFO0lBQzlDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6QixNQUFNLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0tBQzlCO0FBQ0gsQ0FBQyxDQUFDO0FBb0NGLE1BQU0s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QUFZLEdBQUcsTUFBTSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUXVlcnksIFJlcG9zaXRvcnksIFF1ZXJ5U29ydERpcmVjdGlvbiwgS2V5UmVwb3NpdG9yeSB9IGZyb20gJy4vcmVwb3NpdG9yaWVzJztcbmltcG9ydCAqIGFzIFEgZnJvbSAnLi9wcm90b2NvbCc7XG5pbXBvcnQgeyBkZWNvcmF0ZWRGZXRjaCBhcyBmZXRjaCwgSHR0cEVycm9yLCBSZXNwb25zZUxpa2UgfSBmcm9tICdkb3BlZXMtY29yZS9saWIvZmV0Y2gnO1xuaW1wb3J0ICogYXMgdXRmOCBmcm9tICdkb3BlZXMtY29yZS9saWIvdXRmOCc7XG5pbXBvcnQgeyBDYW5jZWxsYXRpb24gfSBmcm9tICdkb3BlZXMtY29yZS9saWIvY2FuY2VsbGF0aW9uJztcbmltcG9ydCB7IEh0dHBDbGllbnQsIGh0dHBDbGllbnRDb25maWd1cmF0aW9uIH0gZnJvbSAnZG9wZWVzLWNvcmUvbGliL2h0dHAnO1xuaW1wb3J0IHsgVXJpIH0gZnJvbSAnZG9wZWVzLWNvcmUvbGliL3VyaSc7XG5cbmNvbnN0IGI2NERlY29kZVVuaWNvZGUgPSAoc3RyOiBzdHJpbmcpID0+IHtcbiAgLy8gR29pbmcgYmFja3dhcmRzOiBmcm9tIGJ5dGVzdHJlYW0sIHRvIHBlcmNlbnQtZW5jb2RpbmcsIHRvIG9yaWdpbmFsIHN0cmluZy5cbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChhdG9iKHN0cikuc3BsaXQoJycpLm1hcChmdW5jdGlvbihjKSB7XG4gICAgICByZXR1cm4gJyUnICsgKCcwMCcgKyBjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpKS5zbGljZSgtMik7XG4gIH0pLmpvaW4oJycpKTtcbn07XG5cbmNvbnN0IGNoZWNrTnVtID0gKG46IG51bWJlciwgbWVzc2FnZTogc3RyaW5nKSA9PiB7XG4gIGlmIChuICUgMSAhPT0gMCB8fCBuIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKG1lc3NhZ2UpO1xuICB9XG59O1xuXG5pbnRlcmZhY2UgUmVzdFJlcG9zaXRvcnlPcHRpb25zIHtcbiAgdHlwZTogc3RyaW5nO1xuICBlbmRwb2ludDogc3RyaW5nO1xuICBrZXlQcm9wZXJ0eT86IHN0cmluZztcbiAgcHJvdG9jb2xWZXJzaW9uPzogbnVtYmVyO1xuICBjb25maWd1cmF0aW9uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFYxUXVlcnkge1xuICBxdWVyeT86IHN0cmluZztcbiAgdHlwZT86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXN0UmVwb3NpdG9yeTxUPiBleHRlbmRzIFJlcG9zaXRvcnk8VD4ge1xuICBleGVjKFxuICAgIG9mZnNldDogbnVtYmVyLFxuICAgIGNvdW50OiBudW1iZXIsXG4gICAgcHJlZGljYXRlOiBzdHJpbmcsXG4gICAgc29ydEJ5Pzogc3RyaW5nLFxuICAgIHNvcnRCeURpcmVjdGlvbj86XG4gICAgUXVlcnlTb3J0RGlyZWN0aW9uLFxuICAgIHF1ZXJ5PzogVjFRdWVyeSxcbiAgICBjdXN0b21PcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sXG4gICAgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uXG4gICk6IEFzeW5jSXRlcmFibGU8VD47XG5cbiAgdG90YWwoXG4gICAgcHJlZGljYXRlOiBzdHJpbmcsXG4gICAgcXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkLFxuICAgIGN1c3RvbU9wdGlvbnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LFxuICAgIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uXG4gICk6IFByb21pc2U8bnVtYmVyPjtcbn1cblxuZXhwb3J0IGNsYXNzIEtleVJlc3RSZXBvc2l0b3J5PFREYXRhLCBUS2V5PiBpbXBsZW1lbnRzIEtleVJlcG9zaXRvcnk8VERhdGEsIFRLZXk+LCBSZXN0UmVwb3NpdG9yeTxURGF0YT4ge1xuICByZWFkb25seSBjbGllbnRGYWN0b3J5OiAoKSA9PiBIdHRwQ2xpZW50O1xuICByZWFkb25seSBvcHRpb25zOiBSZXN0UmVwb3NpdG9yeU9wdGlvbnM7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUmVzdFJlcG9zaXRvcnlPcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICBjb25zdCByZXN0TWVzc2FnZUhhbmRsZXIgPSBodHRwQ2xpZW50Q29uZmlndXJhdGlvbi5nZXRIYW5kbGVyKChvcHRpb25zICYmIG9wdGlvbnMuY29uZmlndXJhdGlvbikgfHwgJ3Jlc3QnKTtcbiAgICB0aGlzLmNsaWVudEZhY3RvcnkgPSAoKSA9PiBuZXcgSHR0cENsaWVudChyZXN0TWVzc2FnZUhhbmRsZXIpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgY29sbGVjdGlvbkVuZHBvaW50KCkge1xuICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX1gO1xuICB9XG5cbiAgZ2V0IHByb3RvY29sVmVyc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLnByb3RvY29sVmVyc2lvbiB8fCAyO1xuICB9XG5cbiAgZ2V0IHR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy50eXBlO1xuICB9XG5cbiAgZ2V0IGVuZHBvaW50KCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMuZW5kcG9pbnQ7XG4gIH1cblxuICBnZXQga2V5UHJvcGVydHkoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5rZXlQcm9wZXJ0eSB8fCAnaWQnO1xuICB9XG5cbiAgZ2V0IGl0ZW1zKCk6IFF1ZXJ5PFREYXRhPiB7XG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFREYXRhPih0aGlzLCAwLCBSZXN0UXVlcnkuZGVmYXVsdENvdW50LCBudWxsLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwge30sIHRoaXMub3B0aW9ucy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEtleShpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiAoaXRlbSBhcyBhbnkpW3RoaXMua2V5UHJvcGVydHldIGFzIFRLZXk7XG4gIH1cblxuICBwcml2YXRlIGhhc0tleShpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiAhIXRoaXMuZ2V0S2V5KGl0ZW0pO1xuICB9XG5cbiAgcHJpdmF0ZSBpdGVtRW5kcG9pbnQoaXRlbTogVERhdGEpIHtcbiAgICByZXR1cm4gYCR7dGhpcy5lbmRwb2ludH0vJHt0aGlzLnR5cGV9LyR7dGhpcy5nZXRLZXkoaXRlbSl9YDtcbiAgfVxuXG4gIHByaXZhdGUgX19nZXRFcnJvcihyZXNwb25zZTogUmVzcG9uc2VMaWtlKTogSHR0cEVycm9yIHtcbiAgICBjb25zdCBtZXNzYWdlcyA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdYLU1lc3NhZ2UnKTtcbiAgICBpZiAobWVzc2FnZXMpIHtcbiAgICAgIHJldHVybiBuZXcgSHR0cEVycm9yKHJlc3BvbnNlLCBiNjREZWNvZGVVbmljb2RlKG1lc3NhZ2VzKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgSHR0cEVycm9yKHJlc3BvbnNlKTtcbiAgfVxuXG4gIGFzeW5jIGxvb2t1cChrZXk6IFRLZXksIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8VERhdGE+IHtcbiAgICBjb25zdCB1cmkgPSBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX0vJHtrZXl9YDtcbiAgICByZXR1cm4gdGhpcy5jbGllbnRGYWN0b3J5KCkuZ2V0SnNvbih1cmksIGNhbmNlbGxhdGlvbik7XG4gIH1cblxuICBhc3luYyB1cGRhdGUoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8VERhdGE+IHtcbiAgICBpZiAoIWl0ZW0pIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VuYWJsZSB0byB1cGRhdGUgZW1wdHkgdmFsdWUnKTtcbiAgICB9XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNsaWVudEZhY3RvcnkoKS5wdXQodGhpcy5pdGVtRW5kcG9pbnQoaXRlbSksIDxhbnk+IGl0ZW0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb29rdXAodGhpcy5nZXRLZXkoaXRlbSksIGNhbmNlbGxhdGlvbik7XG4gICAgfVxuICAgIHRocm93IHRoaXMuX19nZXRFcnJvcihyZXNwb25zZSk7XG4gIH1cblxuICBhc3luYyBpbnNlcnQoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGlmICghaXRlbSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndW5hYmxlIHRvIGluc2VydCBlbXB0eSB2YWx1ZScpO1xuICAgIH1cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2xpZW50RmFjdG9yeSgpLnBvc3QodGhpcy5jb2xsZWN0aW9uRW5kcG9pbnQsIDxhbnk+IGl0ZW0sIGNhbmNlbGxhdGlvbik7XG4gICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICBjb25zdCB1cmkgPSByZXNwb25zZS5oZWFkZXJzLmdldCgnTG9jYXRpb24nKTtcbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcigncmVzdCBpbnNlcnQgZGlkIG5vdCByZXR1cm4gYSBsb2NhdGlvbicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMuY2xpZW50RmFjdG9yeSgpLmdldEpzb24odXJpLCBjYW5jZWxsYXRpb24pO1xuICAgIH1cbiAgICB0aHJvdyB0aGlzLl9fZ2V0RXJyb3IocmVzcG9uc2UpO1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlKGl0ZW06IFREYXRhLCBjYW5jZWxsYXRpb246IENhbmNlbGxhdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnRGYWN0b3J5KCkuZGVsZXRlKHRoaXMuaXRlbUVuZHBvaW50KGl0ZW0pLCBjYW5jZWxsYXRpb24pO1xuICAgIGlmICgyMDAgPT09IHJlc3BvbnNlLnN0YXR1cyB8fCAyMDIgPT09IHJlc3BvbnNlLnN0YXR1cyB8fCAyMDQgPT09IHJlc3BvbnNlLnN0YXR1cykge1xuICAgICAgLy8gc3VjY2VzcztcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhyb3cgdGhpcy5fX2dldEVycm9yKHJlc3BvbnNlKTtcbiAgfVxuXG4gIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTptYXgtbGluZS1sZW5ndGhcbiAgYXN5bmMgdG90YWwocHJlZGljYXRlOiBzdHJpbmcsIHF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZCwgY3VzdG9tT3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgICBoZWFkZXJzLmFwcGVuZCgnQWNjZXB0JywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcbiAgICBoZWFkZXJzLmFwcGVuZCgnWC1GaWx0ZXInLCBwcmVkaWNhdGUpO1xuICAgIGhlYWRlcnMuYXBwZW5kKCdYLUNvdW50JywgJzAnKTtcbiAgICBpZiAocXVlcnkgJiYgcXVlcnkucXVlcnkpIHtcbiAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVF1ZXJ5JywgcXVlcnkucXVlcnkpO1xuICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU2VhcmNoVHlwZScsIHF1ZXJ5LnR5cGUgfHwgJ3BhcnRpYWwnKTtcbiAgICB9XG4gICAgY29uc3QgY3VzdG9tS2V5cyA9IE9iamVjdC5rZXlzKGN1c3RvbU9wdGlvbnMgfHwge30pO1xuICAgIGN1c3RvbUtleXMuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGN1c3RvbU9wdGlvbnNba2V5XTtcbiAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICBoZWFkZXJzLmFwcGVuZChrZXksIHZhbHVlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2xpZW50RmFjdG9yeSgpLnNlbmQoe1xuICAgICAgdXJpOiBuZXcgVXJpKHRoaXMuY29sbGVjdGlvbkVuZHBvaW50KSxcbiAgICAgIGhlYWRlcnNcbiAgICB9LCBjYW5jZWxsYXRpb24pO1xuICAgIGlmIChyZXNwb25zZS5vaykge1xuICAgICAgY29uc3QgaGVhZGVyID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoJ1gtVG90YWwtQ291bnQnKTtcbiAgICAgIHJldHVybiBoZWFkZXIgPyAocGFyc2VJbnQoaGVhZGVyLCAxMCkgfHwgMCkgOiAwO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEhpYmEgbMOpcGV0dCBmZWwgYWRhdG9rIGxla8OpcmRlesOpc2Uga8O2emJlbjogJHtyZXNwb25zZS5zdGF0dXNUZXh0fWApO1xuICAgIH1cbiAgfVxuXG4gIGV4ZWMoXG4gICAgb2Zmc2V0OiBudW1iZXIsXG4gICAgY291bnQ6IG51bWJlcixcbiAgICBwcmVkaWNhdGU6IHN0cmluZyxcbiAgICBzb3J0Qnk/OiBzdHJpbmcsXG4gICAgc29ydEJ5RGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uLFxuICAgIHF1ZXJ5PzogVjFRdWVyeSxcbiAgICBjdXN0b21PcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sXG4gICAgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uXG4gICk6IEFzeW5jSXRlcmFibGU8VERhdGE+IHtcbiAgICBjb25zdCByZXBvID0gdGhpcztcbiAgICBsZXQgZXJyb3I6IGFueSA9IG51bGw7XG4gICAgbGV0IGl0ZW1zOiBURGF0YVtdfG51bGwgPSBudWxsO1xuICAgIGxldCBpbmRleCA9IDA7XG4gICAgcmV0dXJuIHtcbiAgICAgIFtTeW1ib2wuYXN5bmNJdGVyYXRvcl0oKTogQXN5bmNJdGVyYXRvcjxURGF0YT4ge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGFzeW5jIG5leHQoKTogUHJvbWlzZTxJdGVyYXRvclJlc3VsdDxURGF0YT4+IHtcbiAgICAgICAgICAgIGlmIChjYW5jZWxsYXRpb24pIHtcbiAgICAgICAgICAgICAgY2FuY2VsbGF0aW9uLnRocm93SWZDYW5jZWxsZWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChudWxsICE9PSBlcnJvcikge1xuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghaXRlbXMpIHtcbiAgICAgICAgICAgICAgLy8gRWxzxZEgbmV4dCgpIG1lZ2jDrXbDoXNha29yIGV6IGZ1dCBsZS5cbiAgICAgICAgICAgICAgY29uc3QgaGVhZGVycyA9IG5ldyBIZWFkZXJzKCk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdBY2NlcHQnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1PZmZzZXQnLCBTdHJpbmcob2Zmc2V0KSk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLUNvdW50JywgU3RyaW5nKGNvdW50KSk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLUZpbHRlcicsIHByZWRpY2F0ZSk7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNvcnQtQnknLCBzb3J0QnkgfHwgJycpO1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1Tb3J0LUJ5LURpcmVjdGlvbicsIHNvcnRCeURpcmVjdGlvbiB8fCAnJyk7XG4gICAgICAgICAgICAgIGlmIChxdWVyeSAmJiBxdWVyeS5xdWVyeSkge1xuICAgICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVF1ZXJ5JywgcXVlcnkucXVlcnkpO1xuICAgICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNlYXJjaFR5cGUnLCBxdWVyeS50eXBlIHx8ICdwYXJ0aWFsJyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY29uc3QgY3VzdG9tS2V5cyA9IE9iamVjdC5rZXlzKGN1c3RvbU9wdGlvbnMgfHwge30pO1xuICAgICAgICAgICAgICBjdXN0b21LZXlzLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHZhbCA9IChjdXN0b21PcHRpb25zIHx8IHt9KVtrZXldO1xuICAgICAgICAgICAgICAgIGlmICh2YWwpIHtcbiAgICAgICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKGtleSwgdmFsKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAvLyBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHJlcG8uY29sbGVjdGlvbkVuZHBvaW50LCB7IGhlYWRlcnMsIHNpZ25hbDogYWJvcnRpb24uc2lnbmFsIH0pO1xuICAgICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcG8uY2xpZW50RmFjdG9yeSgpLnNlbmQoe1xuICAgICAgICAgICAgICAgIHVyaTogVXJpLmZyb20ocmVwby5jb2xsZWN0aW9uRW5kcG9pbnQpLFxuICAgICAgICAgICAgICAgIGhlYWRlcnNcbiAgICAgICAgICAgICAgfSwgY2FuY2VsbGF0aW9uKTtcbiAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlLm9rICYmIHJlc3BvbnNlLmNvbnRlbnQpIHtcbiAgICAgICAgICAgICAgICBpdGVtcyA9IGF3YWl0IHJlc3BvbnNlLmNvbnRlbnQuanNvbigpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGVycm9yID0gbmV3IEVycm9yKGBIaWJhIGzDqXBldHQgZmVsIGFkYXRvayBsZWvDqXJkZXrDqXNlIGvDtnpiZW46ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFpdGVtcykge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3Nob3VsZCBuZXZlciBoYXBwZW4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpbmRleCA+PSBpdGVtcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgZG9uZTogdHJ1ZSwgdmFsdWU6IDxhbnk+IHVuZGVmaW5lZCB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBpdGVtc1tpbmRleF07XG4gICAgICAgICAgICArK2luZGV4O1xuICAgICAgICAgICAgcmV0dXJuIHsgZG9uZTogZmFsc2UsIHZhbHVlIH07XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH07XG4gIH1cbn1cblxuY29uc3QgcmVnZXggPSAvW1xcMC1cXHgwOFxcbi1cXHgxRlxceDdGLVxcdUZGRkZdL2c7XG5cbmV4cG9ydCBjbGFzcyBSZXN0UXVlcnk8VD4gZXh0ZW5kcyBRdWVyeTxUPiB7XG4gIHN0YXRpYyBkZWZhdWx0Q291bnQgPSAxMDAwMDA7XG4gIHJlYWRvbmx5IHJlcG86IFJlc3RSZXBvc2l0b3J5PFQ+O1xuICByZWFkb25seSBvZmZzZXQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgY291bnQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgcHJlZGljYXRlOiBRLkxhbWJkYXxudWxsO1xuICByZWFkb25seSBzb3J0Qnk6IHN0cmluZztcbiAgcmVhZG9ubHkgc29ydEJ5RGlyZWN0aW9uOiBRdWVyeVNvcnREaXJlY3Rpb247XG4gIHJlYWRvbmx5IHByb3RvY29sVmVyc2lvbjogbnVtYmVyO1xuICByZWFkb25seSBjdXN0b21PcHRpb25zOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfTtcbiAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm1heC1saW5lLWxlbmd0aFxuICBjb25zdHJ1Y3RvcihyZXBvOiBSZXN0UmVwb3NpdG9yeTxUPiwgb2Zmc2V0OiBudW1iZXIsIGNvdW50OiBudW1iZXIsIHByZWRpY2F0ZT86IFEuTGFtYmRhfG51bGwsIHNvcnRCeT86IHN0cmluZywgc29ydEJ5RGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uLCBjdXN0b21PcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIHByb3RvY29sVmVyc2lvbj86IG51bWJlcikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5yZXBvID0gcmVwbztcbiAgICB0aGlzLm9mZnNldCA9IG9mZnNldCB8fCAwO1xuICAgIHRoaXMuY291bnQgPSAwID09PSBjb3VudCA/IGNvdW50IDogKGNvdW50IHx8IFJlc3RRdWVyeS5kZWZhdWx0Q291bnQpO1xuICAgIHRoaXMucHJlZGljYXRlID0gcHJlZGljYXRlIHx8IG51bGw7XG4gICAgdGhpcy5zb3J0QnkgPSBzb3J0QnkgfHwgJyc7XG4gICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24gPSBzb3J0QnlEaXJlY3Rpb24gfHwgUXVlcnlTb3J0RGlyZWN0aW9uLkFzYztcbiAgICB0aGlzLmN1c3RvbU9wdGlvbnMgPSBjdXN0b21PcHRpb25zIHx8IHt9O1xuICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uID0gcHJvdG9jb2xWZXJzaW9uIHx8IDI7XG4gIH1cbiAgcHJpdmF0ZSBlc2NhcGUoaW5wdXQ6IHN0cmluZ3xRLkV4cHJ8bnVsbCkge1xuICAgIGlmICghaW5wdXQpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gICAgY29uc3QgaW5wID0gaW5wdXQgaW5zdGFuY2VvZiBRLkV4cHIgPyB0aGlzLmFwcGx5UHJvdG9jb2woaW5wdXQpLnRvU3RyaW5nKCkgOiBpbnB1dDtcbiAgICByZXR1cm4gdXRmOFxuICAgICAgLnV0ZjhlbmNvZGUoaW5wKVxuICAgICAgLnJlcGxhY2UocmVnZXgsIChtKSA9PiAnJScgKyAoJzAnICsgbS5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpKS5zbGljZSgtMikpO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseVByb3RvY29sKGV4cHI6IFEuRXhwcikge1xuICAgIGlmICh0aGlzLnByb3RvY29sVmVyc2lvbiA8IDIgJiYgZXhwciBpbnN0YW5jZW9mIFEuTGFtYmRhKSB7XG4gICAgICBjb25zdCBwYXJhbSA9IGV4cHIucGFyYW07XG4gICAgICByZXR1cm4gZXhwci5ib2R5LmFjY2VwdDxRLkV4cHI+KHtcbiAgICAgICAgdmlzaXRDb25zdChjKSB7IHJldHVybiBjOyB9LFxuICAgICAgICB2aXNpdFBhcmFtKHApIHsgcmV0dXJuIHA7IH0sXG4gICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTptYXgtbGluZS1sZW5ndGhcbiAgICAgICAgdmlzaXRQcm9wKHApIHsgcmV0dXJuIHAuaW5zdGFuY2UuZXEocGFyYW0pID8gbmV3IFEuUGFyYW0oPGFueT4gcC5uYW1lKSA6IG5ldyBRLlByb3AocC5pbnN0YW5jZS5hY2NlcHQodGhpcyksIHAubmFtZSk7IH0sXG4gICAgICAgIHZpc2l0QmluYXJ5KGIpIHsgcmV0dXJuIG5ldyBRLkJpbk9wKGIubGVmdC5hY2NlcHQodGhpcyksIGIub3AsIGIucmlnaHQuYWNjZXB0KHRoaXMpKTsgfSxcbiAgICAgICAgdmlzaXRVbmFyeSh1KSB7IHJldHVybiBuZXcgUS5Vbk9wKHUub3AsIHUub3BlcmFuZC5hY2NlcHQodGhpcykpOyB9LFxuICAgICAgICB2aXNpdENhbGwoYykgeyByZXR1cm4gbmV3IFEuQ2FsbChjLm5hbWUsIGMuYXJncy5tYXAoKGFyZykgPT4gYXJnLmFjY2VwdCh0aGlzKSkpOyB9LFxuICAgICAgICB2aXNpdExhbWJkYShsKSB7IHJldHVybiBuZXcgUS5MYW1iZGEobC5ib2R5LmFjY2VwdCh0aGlzKSwgbC5wYXJhbSk7IH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gZXhwcjtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdFYxUXVlcnkoZXhwcjogUS5FeHByKSB7XG4gICAgY29uc3QgcTogeyBxdWVyeT86IHN0cmluZyB9ID0ge307XG4gICAgY29uc3QgdjFFeHByID0gZXhwci5hY2NlcHQ8US5FeHByPih7XG4gICAgICB2aXNpdENvbnN0KGMpIHsgcmV0dXJuIGM7IH0sXG4gICAgICB2aXNpdFBhcmFtKHApIHsgcmV0dXJuIHA7IH0sXG4gICAgICB2aXNpdFByb3AocCkgeyByZXR1cm4gbmV3IFEuUHJvcChwLmluc3RhbmNlLmFjY2VwdCh0aGlzKSwgcC5uYW1lKTsgfSxcbiAgICAgIHZpc2l0QmluYXJ5KGIpIHtcbiAgICAgICAgY29uc3QgbCA9IGIubGVmdC5hY2NlcHQodGhpcyk7XG4gICAgICAgIGNvbnN0IHIgPSBiLnJpZ2h0LmFjY2VwdCh0aGlzKTtcbiAgICAgICAgaWYgKGwgaW5zdGFuY2VvZiBRLkNvbnN0ICYmICg8YW55PiBsLnZhbHVlID09PSB0cnVlIHx8IDxhbnk+IGwudmFsdWUgPT09ICd0cnVlJykpIHtcbiAgICAgICAgICAgIHJldHVybiByO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyIGluc3RhbmNlb2YgUS5Db25zdCAmJiAoPGFueT4gci52YWx1ZSA9PT0gdHJ1ZSB8fCA8YW55PiByLnZhbHVlID09PSAndHJ1ZScpKSB7XG4gICAgICAgICAgICByZXR1cm4gbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFEuQmluT3AobCwgYi5vcCwgcik7XG4gICAgICB9LFxuICAgICAgdmlzaXRVbmFyeSh1KSB7IHJldHVybiBuZXcgUS5Vbk9wKHUub3AsIHUub3BlcmFuZC5hY2NlcHQodGhpcykpOyB9LFxuICAgICAgdmlzaXRDYWxsKGMpIHtcbiAgICAgICAgaWYgKCdwYXJ0aWFsTWF0Y2gnID09PSBjLm5hbWUgJiYgMiA9PT0gYy5hcmdzLmxlbmd0aCkge1xuICAgICAgICAgIGNvbnN0IGFyZyA9IGMuYXJnc1sxXTtcbiAgICAgICAgICBpZiAoYXJnIGluc3RhbmNlb2YgUS5Db25zdCAmJiBhcmcudmFsdWUpIHtcbiAgICAgICAgICAgIHEucXVlcnkgPSBhcmcudmFsdWU7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFEuQ29uc3QoPGFueT4gdHJ1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignbm90IHN1cHBvcnRlZCBwYXJ0aWFsIG1hdGNoIGluIHByb3RvY29sIHYxJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBRLkNhbGwoYy5uYW1lLCBjLmFyZ3MubWFwKChhcmcpID0+IGFyZy5hY2NlcHQodGhpcykpKTtcbiAgICAgIH0sXG4gICAgICB2aXNpdExhbWJkYShsKSB7IHJldHVybiBuZXcgUS5MYW1iZGEobC5ib2R5LmFjY2VwdCh0aGlzKSwgbC5wYXJhbSk7IH1cbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgICBleHByOiB2MUV4cHIsXG4gICAgICAgIHF1ZXJ5OiBxXG4gICAgfTtcbiAgfVxuXG4gIGdldCBlc2NhcGVkUHJlZGljYXRlKCkge1xuICAgIHJldHVybiB0aGlzLmVzY2FwZSh0aGlzLnByZWRpY2F0ZSk7XG4gIH1cbiAgZ2V0IGVzY2FwZWRTb3J0QnkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZXNjYXBlKHRoaXMuc29ydEJ5KTtcbiAgfVxuICBmaWx0ZXIocHJlZGljYXRlOiBzdHJpbmd8US5MYW1iZGEpIHtcbiAgICBjb25zdCBwID0gJ3N0cmluZycgPT09IHR5cGVvZiBwcmVkaWNhdGUgPyBRLnBhcnNlKHByZWRpY2F0ZSkgOiBwcmVkaWNhdGU7XG4gICAgaWYgKCEocCBpbnN0YW5jZW9mIFEuTGFtYmRhKSkge1xuICAgICAgdGhyb3cgVHlwZUVycm9yKCdwcmVkaWNhdGUgbXVzdCBiZSBhIGxhbWJkYSBleHByZXNzaW9uJyk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUgPyB0aGlzLnByZWRpY2F0ZS5hbmQocCkgOiBwLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIHRoaXMuY3VzdG9tT3B0aW9ucyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uXG4gICAgKTtcbiAgfVxuICBza2lwKG46IG51bWJlcik6IFF1ZXJ5PFQ+IHtcbiAgICBpZiAoMCA9PT0gbikge1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIGNoZWNrTnVtKG4sICdza2lwIHBhcmFtZXRlciBtdXN0IGJlIG5vbi1uZWdhdGl2ZSB3aG9sZSBudW1iZXIuJyk7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICBuLCAvLyBUT0RPOiBFenQgdsOpZ2lnIGtlbGwgZ29uZG9sbmksIG1lcnQgbGVoZXQgKHRoaXMub2Zmc2V0ICsgbikga2VsbGVuZSBpZGU/XG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgdGhpcy5jdXN0b21PcHRpb25zLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb25cbiAgICApO1xuICB9XG4gIHRha2UobjogbnVtYmVyKTogUXVlcnk8VD4ge1xuICAgIGNoZWNrTnVtKG4sICd0YWtlIHBhcmFtZXRlciBtdXN0IGJlIG5vbi1uZWdhdGl2ZSB3aG9sZSBudW1iZXIuJyk7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICB0aGlzLm9mZnNldCxcbiAgICAgIG4sXG4gICAgICB0aGlzLnByZWRpY2F0ZSxcbiAgICAgIHRoaXMuc29ydEJ5LFxuICAgICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24sXG4gICAgICB0aGlzLmN1c3RvbU9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvbik7XG4gIH1cbiAgb3JkZXJCeShzZWxlY3Rvcjogc3RyaW5nLCBkaXJlY3Rpb24/OiBRdWVyeVNvcnREaXJlY3Rpb24pOiBRdWVyeTxUPiB7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VD4oXG4gICAgICB0aGlzLnJlcG8sXG4gICAgICB0aGlzLm9mZnNldCxcbiAgICAgIHRoaXMuY291bnQsXG4gICAgICB0aGlzLnByZWRpY2F0ZSxcbiAgICAgIHNlbGVjdG9yLFxuICAgICAgZGlyZWN0aW9uIHx8IFF1ZXJ5U29ydERpcmVjdGlvbi5Bc2MsXG4gICAgICB0aGlzLmN1c3RvbU9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvbik7XG4gIH1cbiAgc2V0Q3VzdG9tT3B0aW9ucyhvcHRpb25zOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZ3x1bmRlZmluZWQgfSwgcmVwbGFjZT86IGJvb2xlYW4pOiBRdWVyeTxUPiB7XG4gICAgY29uc3Qgb3B0cyA9IHJlcGxhY2UgPyAob3B0aW9ucyB8fCB7fSkgOiBPYmplY3QuYXNzaWduKHt9LCB0aGlzLmN1c3RvbU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgb3B0cyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uKTtcbiAgfVxuICBhc3luYyB0b3RhbChjYW5jZWxsYXRpb246IENhbmNlbGxhdGlvbik6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgbGV0IHByZWRpY2F0ZTogc3RyaW5nO1xuICAgIGxldCB2MVF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZDtcbiAgICBpZiAoIXRoaXMucHJlZGljYXRlKSB7XG4gICAgICBwcmVkaWNhdGUgPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMikge1xuICAgICAgICBjb25zdCBkYXRhID0gdGhpcy5leHRyYWN0VjFRdWVyeSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKGRhdGEuZXhwcik7XG4gICAgICAgIHYxUXVlcnkgPSBkYXRhLnF1ZXJ5O1xuICAgICAgICBpZiAocHJlZGljYXRlICYmIHByZWRpY2F0ZS5zdGFydHNXaXRoKCcoJykgJiYgcHJlZGljYXRlLmVuZHNXaXRoKCcpJykpIHtcbiAgICAgICAgICBwcmVkaWNhdGUgPSBwcmVkaWNhdGUuc3Vic3RyKDEsIHByZWRpY2F0ZS5sZW5ndGggLSAyKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5yZXBvLnRvdGFsKHByZWRpY2F0ZSwgdjFRdWVyeSwgdGhpcy5jdXN0b21PcHRpb25zLCBjYW5jZWxsYXRpb24pO1xuICB9XG4gIGV4ZWMoKTogQXN5bmNJdGVyYWJsZTxUPiB7XG4gICAgbGV0IHByZWRpY2F0ZTogc3RyaW5nO1xuICAgIGxldCB2MVF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZDtcbiAgICBpZiAoIXRoaXMucHJlZGljYXRlKSB7XG4gICAgICBwcmVkaWNhdGUgPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMikge1xuICAgICAgICBjb25zdCBkYXRhID0gdGhpcy5leHRyYWN0VjFRdWVyeSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKGRhdGEuZXhwcik7XG4gICAgICAgIHYxUXVlcnkgPSBkYXRhLnF1ZXJ5O1xuICAgICAgICBpZiAocHJlZGljYXRlICYmIHByZWRpY2F0ZS5zdGFydHNXaXRoKCcoJykgJiYgcHJlZGljYXRlLmVuZHNXaXRoKCcpJykpIHtcbiAgICAgICAgICBwcmVkaWNhdGUgPSBwcmVkaWNhdGUuc3Vic3RyKDEsIHByZWRpY2F0ZS5sZW5ndGggLSAyKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bWF4LWxpbmUtbGVuZ3RoXG4gICAgcmV0dXJuIHRoaXMucmVwby5leGVjKHRoaXMub2Zmc2V0LCB0aGlzLmNvdW50LCBwcmVkaWNhdGUsIHRoaXMuc29ydEJ5LCB0aGlzLnNvcnRCeURpcmVjdGlvbiwgdjFRdWVyeSwgdGhpcy5jdXN0b21PcHRpb25zKTtcbiAgfVxufVxuIl19