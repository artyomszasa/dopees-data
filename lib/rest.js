import { Query, QuerySortDirection } from "./repositories";
import * as Q from './protocol';
import { decoratedFetch as fetch } from 'dopees-core/lib/fetch';
import * as utf8 from 'dopees-core/lib/utf8';
const checkNum = (n, message) => {
    if (n % 1 !== 0 || n <= 0) {
        throw new TypeError(message);
    }
};
const supportsAbortController = (function () {
    if (window.AbortController) {
        return true;
    }
    return false;
}());
function linkAbortion(cancellation) {
    let signal;
    let subscription;
    if (undefined !== cancellation && supportsAbortController) {
        const abortController = new AbortController();
        signal = abortController.signal;
        subscription = cancellation.subscribe(() => abortController.abort());
    }
    else {
        signal = undefined;
        subscription = { remove() { } };
    }
    return { signal, subscription };
}
export class KeyRestRepository {
    constructor(options) {
        this.options = options;
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
        return new RestQuery(this, 0, RestQuery.defaultCount, null, undefined, undefined, this.options.protocolVersion);
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
    __getErrors(response) {
        const messages = response.headers.get('X-Message');
        if (messages) {
            const msgs = messages.split(',').map(decodeURIComponent);
            if (msgs.length === 1) {
                return msgs[0];
            }
            return msgs;
        }
        return response.statusText;
    }
    async lookup(key, cancellation) {
        const abortion = linkAbortion(cancellation);
        try {
            const uri = `${this.endpoint}/${this.type}/${key}`;
            const response = await fetch(uri, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: abortion.signal
            });
            if (response.ok) {
                return await response.json();
            }
            throw this.__getErrors(response);
        }
        finally {
            abortion.subscription.remove();
        }
    }
    async update(item, cancellation) {
        const abortion = linkAbortion(cancellation);
        try {
            const response = await fetch(this.itemEndpoint(item), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(item),
                signal: abortion.signal
            });
            if (response.ok) {
                return await this.lookup(this.getKey(item), cancellation);
            }
            throw this.__getErrors(response);
        }
        finally {
            abortion.subscription.remove();
        }
    }
    async insert(item, cancellation) {
        const abortion = linkAbortion(cancellation);
        try {
            const response = await fetch(this.collectionEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item),
                signal: abortion.signal
            });
            if (response.ok) {
                const uri = response.headers.get('Location');
                if (!uri) {
                    throw new Error('rest insert did not return a location');
                }
                const lookupAbortion = linkAbortion(cancellation);
                try {
                    const resp = await fetch(uri, {
                        method: 'GET',
                        headers: { 'Accept': 'application/json' },
                        signal: lookupAbortion.signal
                    });
                    if (resp.ok) {
                        return await resp.json();
                    }
                    throw this.__getErrors(resp);
                }
                finally {
                    lookupAbortion.subscription.remove();
                }
            }
            throw this.__getErrors(response);
        }
        finally {
            abortion.subscription.remove();
        }
    }
    remove(item, cancellation) {
        throw new Error("Method not implemented.");
    }
    async total(predicate, query, cancellation) {
        const abortion = linkAbortion(cancellation);
        try {
            const headers = new Headers();
            headers.append('Accept', 'application/json');
            headers.append('X-Filter', predicate);
            if (query && query.query) {
                headers.append('X-Query', query.query);
                headers.append('X-SearchType', query.type || 'partial');
            }
            const response = await fetch(this.collectionEndpoint, { headers, signal: abortion.signal });
            if (response.ok) {
                const header = response.headers.get('X-Total-Count');
                return header ? (parseInt(header, 10) || 0) : 0;
            }
            else {
                throw new Error(`Hiba lépett fel adatok lekérdezése közben: ${response.statusText}`);
            }
        }
        finally {
            abortion.subscription.remove();
        }
    }
    exec(offset, count, predicate, sortBy, sortByDirection, query) {
        const repo = this;
        let error = null;
        let items = null;
        let index = 0;
        return {
            async next(cancellation) {
                cancellation && cancellation.throwIfCancelled();
                if (null !== error) {
                    throw error;
                }
                if (!items) {
                    // Első next() meghívásakor ez fut le.
                    const abortion = linkAbortion(cancellation);
                    try {
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
                        const response = await fetch(repo.collectionEndpoint, { headers, signal: abortion.signal });
                        if (response.ok) {
                            items = await response.json();
                        }
                        else {
                            error = new Error(`Hiba lépett fel adatok lekérdezése közben: ${response.statusText}`);
                            throw error;
                        }
                    }
                    finally {
                        abortion.subscription.remove();
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
                return {
                    done: false,
                    value: value
                };
            },
            cancel() {
                //FIXME: implement
            }
        };
    }
}
const regex = /[\0-\x08\n-\x1F\x7F-\uFFFF]/g;
class RestQuery extends Query {
    constructor(repo, offset, count, predicate, sortBy, sortByDirection, protocolVersion) {
        super();
        this.repo = repo;
        this.offset = offset || 0;
        this.count = 0 === count ? count : (count || RestQuery.defaultCount);
        this.predicate = predicate || null;
        this.sortBy = sortBy || '';
        this.sortByDirection = sortByDirection || QuerySortDirection.Asc;
        this.protocolVersion = protocolVersion || 2;
    }
    escape(input) {
        if (!input) {
            return '';
        }
        const inp = input instanceof Q.Expr ? this.applyProtocol(input).toString() : input;
        return utf8.utf8encode(inp).replace(regex, m => '%' + ('0' + m.charCodeAt(0).toString(16).toUpperCase()).slice(-2));
    }
    applyProtocol(expr) {
        if (this.protocolVersion < 2 && expr instanceof Q.Lambda) {
            const param = expr.param;
            return expr.body.accept({
                visitConst(c) { return c; },
                visitParam(p) { return p; },
                visitProp(p) { return p.instance.eq(param) ? new Q.Param(p.name) : new Q.Prop(p.instance.accept(this), p.name); },
                visitBinary(b) { return new Q.BinOp(b.left.accept(this), b.op, b.right.accept(this)); },
                visitUnary(u) { return new Q.UnOp(u.op, u.operand.accept(this)); },
                visitCall(c) { return new Q.Call(c.name, c.args.map(arg => arg.accept(this))); },
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
                return new Q.Call(c.name, c.args.map(arg => arg.accept(this)));
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
        return new RestQuery(this.repo, this.offset, this.count, this.predicate ? this.predicate.and(p) : p, this.sortBy, this.sortByDirection, this.protocolVersion);
    }
    skip(n) {
        if (0 === n) {
            return this;
        }
        checkNum(n, 'skip parameter must be non-negative whole number.');
        return new RestQuery(this.repo, n, // TODO: Ezt végig kell gondolni, mert lehet (this.offset + n) kellene ide?
        this.count, this.predicate, this.sortBy, this.sortByDirection, this.protocolVersion);
    }
    take(n) {
        checkNum(n, 'take parameter must be non-negative whole number.');
        return new RestQuery(this.repo, this.offset, n, this.predicate, this.sortBy, this.sortByDirection, this.protocolVersion);
    }
    orderBy(selector, direction) {
        return new RestQuery(this.repo, this.offset, this.count, this.predicate, selector, direction || QuerySortDirection.Asc, this.protocolVersion);
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
        return this.repo.total(predicate, v1Query, cancellation);
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
        return this.repo.exec(this.offset, this.count, predicate, this.sortBy, this.sortByDirection, v1Query);
    }
}
RestQuery.defaultCount = 100000;
;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxLQUFLLEVBQXdDLGtCQUFrQixFQUErQixNQUFNLGdCQUFnQixDQUFBO0FBQzdILE9BQU8sS0FBSyxDQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9CLE9BQU8sRUFBRSxjQUFjLElBQUksS0FBSyxFQUFFLE1BQU0sdUJBQXVCLENBQUM7QUFDaEUsT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsQ0FBQztBQUc3QyxNQUFNLFFBQVEsR0FBRyxDQUFDLENBQVMsRUFBRSxPQUFlLEVBQUUsRUFBRTtJQUM5QyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDekIsTUFBTSxJQUFJLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztLQUM5QjtBQUNILENBQUMsQ0FBQTtBQVNELE1BQU0sdUJBQXVCLEdBQUcsQ0FBQztJQUMvQixJQUFLLE1BQWMsQ0FBQyxlQUFlLEVBQUU7UUFDbkMsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQU9MLFNBQVMsWUFBWSxDQUFDLFlBQTJCO0lBQy9DLElBQUksTUFBNkIsQ0FBQztJQUNsQyxJQUFJLFlBQWdDLENBQUM7SUFDckMsSUFBSSxTQUFTLEtBQUssWUFBWSxJQUFJLHVCQUF1QixFQUFFO1FBQ3pELE1BQU0sZUFBZSxHQUFHLElBQUksZUFBZSxFQUFFLENBQUM7UUFDOUMsTUFBTSxHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUM7UUFDaEMsWUFBWSxHQUFHLFlBQVksQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLENBQUMsZUFBZSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7S0FDdEU7U0FBTTtRQUNMLE1BQU0sR0FBRyxTQUFTLENBQUM7UUFDbkIsWUFB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QyxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztnQkFDckIsSUFBSSxTQUFTLElBQUksU0FBUyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFO29CQUNyRSxTQUFTLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztpQkFDdkQ7YUFDRjtpQkFBTTtnQkFDTCxTQUFTLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7YUFDekM7U0FDRjtRQUNELE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxlQUFlLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDeEcsQ0FBQzs7QUE3S00sc0JBQVksR0FBRyxNQUFNLENBQUM7QUE4SzlCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBRdWVyeSwgUmVwb3NpdG9yeSwgQ2FuY2VsbGFibGVBc3luY0l0ZXJhdG9yLCBRdWVyeVNvcnREaXJlY3Rpb24sIEtleVJlcG9zaXRvcnksIENhbmNlbGxhdGlvbiB9IGZyb20gXCIuL3JlcG9zaXRvcmllc1wiXG5pbXBvcnQgKiBhcyBRIGZyb20gJy4vcHJvdG9jb2wnXG5pbXBvcnQgeyBkZWNvcmF0ZWRGZXRjaCBhcyBmZXRjaCB9IGZyb20gJ2RvcGVlcy1jb3JlL2xpYi9mZXRjaCc7XG5pbXBvcnQgKiBhcyB1dGY4IGZyb20gJ2RvcGVlcy1jb3JlL2xpYi91dGY4JztcblxuXG5jb25zdCBjaGVja051bSA9IChuOiBudW1iZXIsIG1lc3NhZ2U6IHN0cmluZykgPT4ge1xuICBpZiAobiAlIDEgIT09IDAgfHwgbiA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihtZXNzYWdlKTtcbiAgfVxufVxuXG5pbnRlcmZhY2UgUmVzdFJlcG9zaXRvcnlPcHRpb25zIHtcbiAgdHlwZTogc3RyaW5nO1xuICBlbmRwb2ludDogc3RyaW5nO1xuICBrZXlQcm9wZXJ0eT86IHN0cmluZztcbiAgcHJvdG9jb2xWZXJzaW9uPzogbnVtYmVyO1xufVxuXG5jb25zdCBzdXBwb3J0c0Fib3J0Q29udHJvbGxlciA9IChmdW5jdGlvbiAoKSB7XG4gIGlmICgod2luZG93IGFzIGFueSkuQWJvcnRDb250cm9sbGVyKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufSgpKTtcblxuaW50ZXJmYWNlIEFib3J0aW9uIHtcbiAgc2lnbmFsOiBBYm9ydFNpZ25hbHx1bmRlZmluZWRcbiAgc3Vic2NyaXB0aW9uOiB7IHJlbW92ZSgpOiB2b2lkIH1cbn1cblxuZnVuY3Rpb24gbGlua0Fib3J0aW9uKGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IEFib3J0aW9uIHtcbiAgbGV0IHNpZ25hbDogQWJvcnRTaWduYWx8dW5kZWZpbmVkO1xuICBsZXQgc3Vic2NyaXB0aW9uOiB7IHJlbW92ZSgpOiB2b2lkIH07XG4gIGlmICh1bmRlZmluZWQgIT09IGNhbmNlbGxhdGlvbiAmJiBzdXBwb3J0c0Fib3J0Q29udHJvbGxlcikge1xuICAgIGNvbnN0IGFib3J0Q29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBzaWduYWwgPSBhYm9ydENvbnRyb2xsZXIuc2lnbmFsO1xuICAgIHN1YnNjcmlwdGlvbiA9IGNhbmNlbGxhdGlvbi5zdWJzY3JpYmUoKCkgPT4gYWJvcnRDb250cm9sbGVyLmFib3J0KCkpO1xuICB9IGVsc2Uge1xuICAgIHNpZ25hbCA9IHVuZGVmaW5lZDtcbiAgICBzdWJzY3JpcHRpb24gPSB7IHJlbW92ZSgpIHsgfSB9O1xuICB9XG4gIHJldHVybiB7IHNpZ25hbCwgc3Vic2NyaXB0aW9uIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVjFRdWVyeSB7XG4gIHF1ZXJ5Pzogc3RyaW5nLFxuICB0eXBlPzogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzdFJlcG9zaXRvcnk8VD4gZXh0ZW5kcyBSZXBvc2l0b3J5PFQ+IHtcbiAgZXhlYyhvZmZzZXQ6IG51bWJlciwgY291bnQ6IG51bWJlciwgcHJlZGljYXRlOiBzdHJpbmcsIHNvcnRCeT86IHN0cmluZywgc29ydEJ5RGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uLCBxdWVyeT86IFYxUXVlcnkpOiBDYW5jZWxsYWJsZUFzeW5jSXRlcmF0b3I8VD47XG4gIHRvdGFsKHByZWRpY2F0ZTogc3RyaW5nLCBxdWVyeTogVjFRdWVyeXx1bmRlZmluZWQsIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxudW1iZXI+O1xufVxuXG5leHBvcnQgY2xhc3MgS2V5UmVzdFJlcG9zaXRvcnk8VERhdGEsIFRLZXk+IGltcGxlbWVudHMgS2V5UmVwb3NpdG9yeTxURGF0YSwgVEtleT4sIFJlc3RSZXBvc2l0b3J5PFREYXRhPiB7XG4gIHJlYWRvbmx5IG9wdGlvbnMgOiBSZXN0UmVwb3NpdG9yeU9wdGlvbnNcbiAgY29uc3RydWN0b3Iob3B0aW9uczogUmVzdFJlcG9zaXRvcnlPcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgfVxuICBwcml2YXRlIGdldCBjb2xsZWN0aW9uRW5kcG9pbnQgKCkge1xuICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX1gO1xuICB9XG4gIGdldCBwcm90b2NvbFZlcnNpb24gKCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMucHJvdG9jb2xWZXJzaW9uIHx8IDI7XG4gIH1cbiAgZ2V0IHR5cGUgKCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMudHlwZTtcbiAgfVxuICBnZXQgZW5kcG9pbnQgKCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMuZW5kcG9pbnQ7XG4gIH1cbiAgZ2V0IGtleVByb3BlcnR5ICgpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLmtleVByb3BlcnR5IHx8ICdpZCc7XG4gIH1cbiAgZ2V0IGl0ZW1zKCk6IFF1ZXJ5PFREYXRhPiB7XG4gICAgcmV0dXJuIG5ldyBSZXN0UXVlcnk8VERhdGE+KHRoaXMsIDAsIFJlc3RRdWVyeS5kZWZhdWx0Q291bnQsIG51bGwsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB0aGlzLm9wdGlvbnMucHJvdG9jb2xWZXJzaW9uKTtcbiAgfVxuICBwcml2YXRlIGdldEtleShpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiAoaXRlbSBhcyBhbnkpW3RoaXMua2V5UHJvcGVydHldIGFzIFRLZXk7XG4gIH1cbiAgcHJpdmF0ZSBoYXNLZXkoaXRlbTogVERhdGEpIHtcbiAgICByZXR1cm4gISF0aGlzLmdldEtleShpdGVtKTtcbiAgfVxuICBwcml2YXRlIGl0ZW1FbmRwb2ludChpdGVtOiBURGF0YSkge1xuICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX0vJHt0aGlzLmdldEtleShpdGVtKX1gO1xuICB9XG4gIHByaXZhdGUgX19nZXRFcnJvcnMgKHJlc3BvbnNlOiBSZXNwb25zZSkge1xuICAgIGNvbnN0IG1lc3NhZ2VzID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoJ1gtTWVzc2FnZScpO1xuICAgIGlmIChtZXNzYWdlcykge1xuICAgICAgY29uc3QgbXNncyA9IG1lc3NhZ2VzLnNwbGl0KCcsJykubWFwKGRlY29kZVVSSUNvbXBvbmVudCk7XG4gICAgICBpZiAobXNncy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgcmV0dXJuIG1zZ3NbMF07XG4gICAgICB9XG4gICAgICByZXR1cm4gbXNncztcbiAgICB9XG4gICAgcmV0dXJuIHJlc3BvbnNlLnN0YXR1c1RleHQ7XG4gIH1cbiAgYXN5bmMgbG9va3VwKGtleTogVEtleSwgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGNvbnN0IGFib3J0aW9uID0gbGlua0Fib3J0aW9uKGNhbmNlbGxhdGlvbik7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHVyaSA9IGAke3RoaXMuZW5kcG9pbnR9LyR7dGhpcy50eXBlfS8ke2tleX1gO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmksIHtcbiAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgaGVhZGVyczogeyAnQWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgIHNpZ25hbDogYWJvcnRpb24uc2lnbmFsXG4gICAgICB9KTtcbiAgICAgIGlmIChyZXNwb25zZS5vaykge1xuICAgICAgICByZXR1cm4gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xuICAgICAgfVxuICAgICAgdGhyb3cgdGhpcy5fX2dldEVycm9ycyhyZXNwb25zZSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGFib3J0aW9uLnN1YnNjcmlwdGlvbi5yZW1vdmUoKTtcbiAgICB9XG4gIH1cbiAgYXN5bmMgdXBkYXRlKGl0ZW06IFREYXRhLCBjYW5jZWxsYXRpb24/OiBDYW5jZWxsYXRpb24pOiBQcm9taXNlPFREYXRhPiB7XG4gICAgY29uc3QgYWJvcnRpb24gPSBsaW5rQWJvcnRpb24oY2FuY2VsbGF0aW9uKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh0aGlzLml0ZW1FbmRwb2ludChpdGVtKSwge1xuICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShpdGVtKSxcbiAgICAgICAgc2lnbmFsOiBhYm9ydGlvbi5zaWduYWxcbiAgICAgIH0pO1xuICAgICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvb2t1cCh0aGlzLmdldEtleShpdGVtKSwgY2FuY2VsbGF0aW9uKTtcbiAgICAgIH1cbiAgICAgIHRocm93IHRoaXMuX19nZXRFcnJvcnMocmVzcG9uc2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhYm9ydGlvbi5zdWJzY3JpcHRpb24ucmVtb3ZlKCk7XG4gICAgfVxuICB9XG4gIGFzeW5jIGluc2VydChpdGVtOiBURGF0YSwgY2FuY2VsbGF0aW9uOiBDYW5jZWxsYXRpb24pOiBQcm9taXNlPFREYXRhPiB7XG4gICAgY29uc3QgYWJvcnRpb24gPSBsaW5rQWJvcnRpb24oY2FuY2VsbGF0aW9uKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh0aGlzLmNvbGxlY3Rpb25FbmRwb2ludCwge1xuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGl0ZW0pLFxuICAgICAgICBzaWduYWw6IGFib3J0aW9uLnNpZ25hbFxuICAgICAgfSk7XG4gICAgICBpZiAocmVzcG9uc2Uub2spIHtcbiAgICAgICAgY29uc3QgdXJpID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoJ0xvY2F0aW9uJyk7XG4gICAgICAgIGlmICghdXJpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdyZXN0IGluc2VydCBkaWQgbm90IHJldHVybiBhIGxvY2F0aW9uJyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgbG9va3VwQWJvcnRpb24gPSBsaW5rQWJvcnRpb24oY2FuY2VsbGF0aW9uKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXNwID0gYXdhaXQgZmV0Y2godXJpLCB7XG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgaGVhZGVyczogeyAnQWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgICAgICBzaWduYWw6IGxvb2t1cEFib3J0aW9uLnNpZ25hbFxuICAgICAgICAgIH0pXG4gICAgICAgICAgaWYgKHJlc3Aub2spIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCByZXNwLmpzb24oKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgdGhpcy5fX2dldEVycm9ycyhyZXNwKTtcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBsb29rdXBBYm9ydGlvbi5zdWJzY3JpcHRpb24ucmVtb3ZlKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRocm93IHRoaXMuX19nZXRFcnJvcnMocmVzcG9uc2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhYm9ydGlvbi5zdWJzY3JpcHRpb24ucmVtb3ZlKCk7XG4gICAgfVxuICB9XG4gIHJlbW92ZShpdGVtOiBURGF0YSwgY2FuY2VsbGF0aW9uOiBDYW5jZWxsYXRpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBhc3luYyB0b3RhbChwcmVkaWNhdGU6IHN0cmluZywgcXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkLCBjYW5jZWxsYXRpb246IENhbmNlbGxhdGlvbik6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgY29uc3QgYWJvcnRpb24gPSBsaW5rQWJvcnRpb24oY2FuY2VsbGF0aW9uKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgaGVhZGVycyA9IG5ldyBIZWFkZXJzKCk7XG4gICAgICBoZWFkZXJzLmFwcGVuZCgnQWNjZXB0JywgJ2FwcGxpY2F0aW9uL2pzb24nKTtcbiAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLUZpbHRlcicsIHByZWRpY2F0ZSk7XG4gICAgICBpZiAocXVlcnkgJiYgcXVlcnkucXVlcnkpIHtcbiAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtUXVlcnknLCBxdWVyeS5xdWVyeSk7XG4gICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNlYXJjaFR5cGUnLCBxdWVyeS50eXBlIHx8ICdwYXJ0aWFsJyk7XG4gICAgICB9XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHRoaXMuY29sbGVjdGlvbkVuZHBvaW50LCB7IGhlYWRlcnMsIHNpZ25hbDogYWJvcnRpb24uc2lnbmFsIH0pO1xuICAgICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICAgIGNvbnN0IGhlYWRlciA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdYLVRvdGFsLUNvdW50Jyk7XG4gICAgICAgIHJldHVybiBoZWFkZXIgPyAocGFyc2VJbnQoaGVhZGVyLCAxMCkgfHwgMCkgOiAwO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIaWJhIGzDqXBldHQgZmVsIGFkYXRvayBsZWvDqXJkZXrDqXNlIGvDtnpiZW46ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYWJvcnRpb24uc3Vic2NyaXB0aW9uLnJlbW92ZSgpO1xuICAgIH1cbiAgfVxuICBleGVjKG9mZnNldDogbnVtYmVyLCBjb3VudDogbnVtYmVyLCBwcmVkaWNhdGU6IHN0cmluZywgc29ydEJ5Pzogc3RyaW5nLCBzb3J0QnlEaXJlY3Rpb24/OiBRdWVyeVNvcnREaXJlY3Rpb24sIHF1ZXJ5PzogVjFRdWVyeSk6IENhbmNlbGxhYmxlQXN5bmNJdGVyYXRvcjxURGF0YT4ge1xuICAgIGNvbnN0IHJlcG8gPSB0aGlzO1xuICAgIGxldCBlcnJvciA6IGFueSA9IG51bGw7XG4gICAgbGV0IGl0ZW1zIDogVERhdGFbXXxudWxsID0gbnVsbDtcbiAgICBsZXQgaW5kZXggPSAwO1xuICAgIHJldHVybiB7XG4gICAgICBhc3luYyBuZXh0KGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8SXRlcmF0b3JSZXN1bHQ8VERhdGE+PiB7XG4gICAgICAgIGNhbmNlbGxhdGlvbiAmJiBjYW5jZWxsYXRpb24udGhyb3dJZkNhbmNlbGxlZCgpO1xuICAgICAgICBpZiAobnVsbCAhPT0gZXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIWl0ZW1zKSB7XG4gICAgICAgICAgLy8gRWxzxZEgbmV4dCgpIG1lZ2jDrXbDoXNha29yIGV6IGZ1dCBsZS5cbiAgICAgICAgICBjb25zdCBhYm9ydGlvbiA9IGxpbmtBYm9ydGlvbihjYW5jZWxsYXRpb24pO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdBY2NlcHQnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtT2Zmc2V0JywgU3RyaW5nKG9mZnNldCkpO1xuICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtQ291bnQnLCBTdHJpbmcoY291bnQpKTtcbiAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLUZpbHRlcicsIHByZWRpY2F0ZSk7XG4gICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1Tb3J0LUJ5Jywgc29ydEJ5IHx8ICcnKTtcbiAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNvcnQtQnktRGlyZWN0aW9uJywgc29ydEJ5RGlyZWN0aW9uIHx8ICcnKTtcbiAgICAgICAgICAgIGlmIChxdWVyeSAmJiBxdWVyeS5xdWVyeSkge1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1RdWVyeScsIHF1ZXJ5LnF1ZXJ5KTtcbiAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU2VhcmNoVHlwZScsIHF1ZXJ5LnR5cGUgfHwgJ3BhcnRpYWwnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2gocmVwby5jb2xsZWN0aW9uRW5kcG9pbnQsIHsgaGVhZGVycywgc2lnbmFsOiBhYm9ydGlvbi5zaWduYWwgfSk7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2Uub2spIHtcbiAgICAgICAgICAgICAgaXRlbXMgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBlcnJvciA9IG5ldyBFcnJvcihgSGliYSBsw6lwZXR0IGZlbCBhZGF0b2sgbGVrw6lyZGV6w6lzZSBrw7Z6YmVuOiAke3Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBhYm9ydGlvbi5zdWJzY3JpcHRpb24ucmVtb3ZlKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICghaXRlbXMpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3Nob3VsZCBuZXZlciBoYXBwZW4nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoaW5kZXggPj0gaXRlbXMubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuIHsgZG9uZTogdHJ1ZSwgdmFsdWU6IDxURGF0YT48dW5rbm93bj51bmRlZmluZWQgfVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhbHVlID0gaXRlbXNbaW5kZXhdO1xuICAgICAgICArK2luZGV4O1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRvbmU6IGZhbHNlLFxuICAgICAgICAgIHZhbHVlOiB2YWx1ZVxuICAgICAgICB9O1xuICAgICAgfSxcbiAgICAgIGNhbmNlbCgpIHtcbiAgICAgICAgICAvL0ZJWE1FOiBpbXBsZW1lbnRcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuY29uc3QgcmVnZXggPSAvW1xcMC1cXHgwOFxcbi1cXHgxRlxceDdGLVxcdUZGRkZdL2c7XG5cbmNsYXNzIFJlc3RRdWVyeTxUPiBleHRlbmRzIFF1ZXJ5PFQ+IHtcbiAgc3RhdGljIGRlZmF1bHRDb3VudCA9IDEwMDAwMDtcbiAgcmVhZG9ubHkgcmVwbzogUmVzdFJlcG9zaXRvcnk8VD47XG4gIHJlYWRvbmx5IG9mZnNldDogbnVtYmVyO1xuICByZWFkb25seSBjb3VudDogbnVtYmVyO1xuICByZWFkb25seSBwcmVkaWNhdGU6IFEuTGFtYmRhfG51bGw7XG4gIHJlYWRvbmx5IHNvcnRCeTogc3RyaW5nO1xuICByZWFkb25seSBzb3J0QnlEaXJlY3Rpb246IFF1ZXJ5U29ydERpcmVjdGlvbjtcbiAgcmVhZG9ubHkgcHJvdG9jb2xWZXJzaW9uOiBudW1iZXI7XG4gIGNvbnN0cnVjdG9yIChyZXBvOiBSZXN0UmVwb3NpdG9yeTxUPiwgb2Zmc2V0OiBudW1iZXIsIGNvdW50OiBudW1iZXIsIHByZWRpY2F0ZT86IFEuTGFtYmRhfG51bGwsIHNvcnRCeT86IHN0cmluZywgc29ydEJ5RGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uLCBwcm90b2NvbFZlcnNpb24/OiBudW1iZXIpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVwbyA9IHJlcG87XG4gICAgdGhpcy5vZmZzZXQgPSBvZmZzZXQgfHwgMDtcbiAgICB0aGlzLmNvdW50ID0gMCA9PT0gY291bnQgPyBjb3VudCA6IChjb3VudCB8fCBSZXN0UXVlcnkuZGVmYXVsdENvdW50KTtcbiAgICB0aGlzLnByZWRpY2F0ZSA9IHByZWRpY2F0ZSB8fCBudWxsO1xuICAgIHRoaXMuc29ydEJ5ID0gc29ydEJ5IHx8ICcnO1xuICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uID0gc29ydEJ5RGlyZWN0aW9uIHx8IFF1ZXJ5U29ydERpcmVjdGlvbi5Bc2M7XG4gICAgdGhpcy5wcm90b2NvbFZlcnNpb24gPSBwcm90b2NvbFZlcnNpb24gfHwgMjtcbiAgfVxuICBwcml2YXRlIGVzY2FwZSAoaW5wdXQ6IHN0cmluZ3xRLkV4cHJ8bnVsbCkge1xuICAgIGlmICghaW5wdXQpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG4gICAgY29uc3QgaW5wID0gaW5wdXQgaW5zdGFuY2VvZiBRLkV4cHIgPyB0aGlzLmFwcGx5UHJvdG9jb2woaW5wdXQpLnRvU3RyaW5nKCkgOiBpbnB1dDtcbiAgICByZXR1cm4gdXRmOC51dGY4ZW5jb2RlKGlucCkucmVwbGFjZShyZWdleCwgbSA9PiAnJScgKyAoJzAnICsgbS5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpKS5zbGljZSgtMikpO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseVByb3RvY29sKGV4cHI6IFEuRXhwcikge1xuICAgIGlmICh0aGlzLnByb3RvY29sVmVyc2lvbiA8IDIgJiYgZXhwciBpbnN0YW5jZW9mIFEuTGFtYmRhKSB7XG4gICAgICBjb25zdCBwYXJhbSA9IGV4cHIucGFyYW07XG4gICAgICByZXR1cm4gZXhwci5ib2R5LmFjY2VwdDxRLkV4cHI+KHtcbiAgICAgICAgdmlzaXRDb25zdChjKSB7IHJldHVybiBjOyB9LFxuICAgICAgICB2aXNpdFBhcmFtKHApIHsgcmV0dXJuIHA7IH0sXG4gICAgICAgIHZpc2l0UHJvcChwKSB7IHJldHVybiBwLmluc3RhbmNlLmVxKHBhcmFtKSA/IG5ldyBRLlBhcmFtKDxhbnk+IHAubmFtZSkgOiBuZXcgUS5Qcm9wKHAuaW5zdGFuY2UuYWNjZXB0KHRoaXMpLCBwLm5hbWUpOyB9LFxuICAgICAgICB2aXNpdEJpbmFyeShiKSB7IHJldHVybiBuZXcgUS5CaW5PcChiLmxlZnQuYWNjZXB0KHRoaXMpLCBiLm9wLCBiLnJpZ2h0LmFjY2VwdCh0aGlzKSk7IH0sXG4gICAgICAgIHZpc2l0VW5hcnkodSkgeyByZXR1cm4gbmV3IFEuVW5PcCh1Lm9wLCB1Lm9wZXJhbmQuYWNjZXB0KHRoaXMpKTsgfSxcbiAgICAgICAgdmlzaXRDYWxsKGMpIHsgcmV0dXJuIG5ldyBRLkNhbGwoYy5uYW1lLCBjLmFyZ3MubWFwKGFyZyA9PiBhcmcuYWNjZXB0KHRoaXMpKSk7IH0sXG4gICAgICAgIHZpc2l0TGFtYmRhKGwpIHsgcmV0dXJuIG5ldyBRLkxhbWJkYShsLmJvZHkuYWNjZXB0KHRoaXMpLCBsLnBhcmFtKTsgfVxuICAgICAgfSlcbiAgICB9XG4gICAgcmV0dXJuIGV4cHI7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RWMVF1ZXJ5KGV4cHI6IFEuRXhwcikge1xuICAgIGNvbnN0IHE6IHsgcXVlcnk/OiBzdHJpbmcgfSA9IHt9O1xuICAgIGNvbnN0IHYxRXhwciA9IGV4cHIuYWNjZXB0PFEuRXhwcj4oe1xuICAgICAgdmlzaXRDb25zdChjKSB7IHJldHVybiBjOyB9LFxuICAgICAgdmlzaXRQYXJhbShwKSB7IHJldHVybiBwOyB9LFxuICAgICAgdmlzaXRQcm9wKHApIHsgcmV0dXJuIG5ldyBRLlByb3AocC5pbnN0YW5jZS5hY2NlcHQodGhpcyksIHAubmFtZSk7IH0sXG4gICAgICB2aXNpdEJpbmFyeShiKSB7XG4gICAgICAgIGNvbnN0IGwgPSBiLmxlZnQuYWNjZXB0KHRoaXMpO1xuICAgICAgICBjb25zdCByID0gYi5yaWdodC5hY2NlcHQodGhpcyk7XG4gICAgICAgIGlmIChsIGluc3RhbmNlb2YgUS5Db25zdCAmJiAoPGFueT4gbC52YWx1ZSA9PT0gdHJ1ZSB8fCA8YW55PiBsLnZhbHVlID09PSAndHJ1ZScpKSB7XG4gICAgICAgICAgICByZXR1cm4gcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAociBpbnN0YW5jZW9mIFEuQ29uc3QgJiYgKDxhbnk+IHIudmFsdWUgPT09IHRydWUgfHwgPGFueT4gci52YWx1ZSA9PT0gJ3RydWUnKSkge1xuICAgICAgICAgICAgcmV0dXJuIGw7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBRLkJpbk9wKGwsIGIub3AsIHIpO1xuICAgICAgfSxcbiAgICAgIHZpc2l0VW5hcnkodSkgeyByZXR1cm4gbmV3IFEuVW5PcCh1Lm9wLCB1Lm9wZXJhbmQuYWNjZXB0KHRoaXMpKTsgfSxcbiAgICAgIHZpc2l0Q2FsbCAoYykge1xuICAgICAgICBpZiAoJ3BhcnRpYWxNYXRjaCcgPT09IGMubmFtZSAmJiAyID09PSBjLmFyZ3MubGVuZ3RoKSB7XG4gICAgICAgICAgY29uc3QgYXJnID0gYy5hcmdzWzFdO1xuICAgICAgICAgIGlmIChhcmcgaW5zdGFuY2VvZiBRLkNvbnN0ICYmIGFyZy52YWx1ZSkge1xuICAgICAgICAgICAgcS5xdWVyeSA9IGFyZy52YWx1ZTtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUS5Db25zdCg8YW55PiB0cnVlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdub3Qgc3VwcG9ydGVkIHBhcnRpYWwgbWF0Y2ggaW4gcHJvdG9jb2wgdjEnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFEuQ2FsbChjLm5hbWUsIGMuYXJncy5tYXAoYXJnID0+IGFyZy5hY2NlcHQodGhpcykpKTtcbiAgICAgIH0sXG4gICAgICB2aXNpdExhbWJkYShsKSB7IHJldHVybiBuZXcgUS5MYW1iZGEobC5ib2R5LmFjY2VwdCh0aGlzKSwgbC5wYXJhbSk7IH1cbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgICBleHByOiB2MUV4cHIsXG4gICAgICAgIHF1ZXJ5OiBxXG4gICAgfTtcbiAgfVxuXG4gIGdldCBlc2NhcGVkUHJlZGljYXRlICgpIHtcbiAgICByZXR1cm4gdGhpcy5lc2NhcGUodGhpcy5wcmVkaWNhdGUpO1xuICB9XG4gIGdldCBlc2NhcGVkU29ydEJ5ICgpIHtcbiAgICByZXR1cm4gdGhpcy5lc2NhcGUodGhpcy5zb3J0QnkpO1xuICB9XG4gIGZpbHRlciAocHJlZGljYXRlOiBzdHJpbmd8US5MYW1iZGEpOiBRdWVyeTxUPiB7XG4gICAgY29uc3QgcCA9ICdzdHJpbmcnID09PSB0eXBlb2YgcHJlZGljYXRlID8gUS5wYXJzZShwcmVkaWNhdGUpIDogcHJlZGljYXRlO1xuICAgIGlmICghKHAgaW5zdGFuY2VvZiBRLkxhbWJkYSkpIHtcbiAgICAgIHRocm93IFR5cGVFcnJvcigncHJlZGljYXRlIG11c3QgYmUgYSBsYW1iZGEgZXhwcmVzc2lvbicpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIHRoaXMub2Zmc2V0LFxuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlID8gdGhpcy5wcmVkaWNhdGUuYW5kKHApIDogcCxcbiAgICAgIHRoaXMuc29ydEJ5LFxuICAgICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24sXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvblxuICAgICk7XG4gIH1cbiAgc2tpcChuOiBudW1iZXIpOiBRdWVyeTxUPiB7XG4gICAgaWYgKDAgPT09IG4pIHtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICBjaGVja051bShuLCAnc2tpcCBwYXJhbWV0ZXIgbXVzdCBiZSBub24tbmVnYXRpdmUgd2hvbGUgbnVtYmVyLicpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgbiwgLy8gVE9ETzogRXp0IHbDqWdpZyBrZWxsIGdvbmRvbG5pLCBtZXJ0IGxlaGV0ICh0aGlzLm9mZnNldCArIG4pIGtlbGxlbmUgaWRlP1xuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uXG4gICAgKTtcbiAgfVxuICB0YWtlKG46IG51bWJlcik6IFF1ZXJ5PFQ+IHtcbiAgICBjaGVja051bShuLCAndGFrZSBwYXJhbWV0ZXIgbXVzdCBiZSBub24tbmVnYXRpdmUgd2hvbGUgbnVtYmVyLicpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICBuLFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIG9yZGVyQnkoc2VsZWN0b3I6IHN0cmluZywgZGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uKTogUXVlcnk8VD4ge1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICBzZWxlY3RvcixcbiAgICAgIGRpcmVjdGlvbiB8fCBRdWVyeVNvcnREaXJlY3Rpb24uQXNjLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIGFzeW5jIHRvdGFsKGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBsZXQgcHJlZGljYXRlOiBzdHJpbmc7XG4gICAgbGV0IHYxUXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkO1xuICAgIGlmICghdGhpcy5wcmVkaWNhdGUpIHtcbiAgICAgIHByZWRpY2F0ZSA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5wcm90b2NvbFZlcnNpb24gPCAyKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLmV4dHJhY3RWMVF1ZXJ5KHRoaXMucHJlZGljYXRlKTtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUoZGF0YS5leHByKTtcbiAgICAgICAgdjFRdWVyeSA9IGRhdGEucXVlcnk7XG4gICAgICAgIGlmIChwcmVkaWNhdGUgJiYgcHJlZGljYXRlLnN0YXJ0c1dpdGgoJygnKSAmJiBwcmVkaWNhdGUuZW5kc1dpdGgoJyknKSkge1xuICAgICAgICAgIHByZWRpY2F0ZSA9IHByZWRpY2F0ZS5zdWJzdHIoMSwgcHJlZGljYXRlLmxlbmd0aCAtIDIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcmVkaWNhdGUgPSB0aGlzLmVzY2FwZSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJlcG8udG90YWwocHJlZGljYXRlLCB2MVF1ZXJ5LCBjYW5jZWxsYXRpb24pO1xuICB9XG4gIGV4ZWMoKTogQ2FuY2VsbGFibGVBc3luY0l0ZXJhdG9yPFQ+IHtcbiAgICBsZXQgcHJlZGljYXRlOiBzdHJpbmc7XG4gICAgbGV0IHYxUXVlcnk6IFYxUXVlcnl8dW5kZWZpbmVkO1xuICAgIGlmICghdGhpcy5wcmVkaWNhdGUpIHtcbiAgICAgIHByZWRpY2F0ZSA9ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAodGhpcy5wcm90b2NvbFZlcnNpb24gPCAyKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSB0aGlzLmV4dHJhY3RWMVF1ZXJ5KHRoaXMucHJlZGljYXRlKTtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUoZGF0YS5leHByKTtcbiAgICAgICAgdjFRdWVyeSA9IGRhdGEucXVlcnk7XG4gICAgICAgIGlmIChwcmVkaWNhdGUgJiYgcHJlZGljYXRlLnN0YXJ0c1dpdGgoJygnKSAmJiBwcmVkaWNhdGUuZW5kc1dpdGgoJyknKSkge1xuICAgICAgICAgIHByZWRpY2F0ZSA9IHByZWRpY2F0ZS5zdWJzdHIoMSwgcHJlZGljYXRlLmxlbmd0aCAtIDIpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcmVkaWNhdGUgPSB0aGlzLmVzY2FwZSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnJlcG8uZXhlYyh0aGlzLm9mZnNldCwgdGhpcy5jb3VudCwgcHJlZGljYXRlLCB0aGlzLnNvcnRCeSwgdGhpcy5zb3J0QnlEaXJlY3Rpb24sIHYxUXVlcnkpO1xuICB9XG59OyJdfQ==