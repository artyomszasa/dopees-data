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
    async remove(item, cancellation) {
        const abortion = linkAbortion(cancellation);
        try {
            const response = await fetch(this.itemEndpoint(item), {
                method: 'DELETE',
                signal: abortion.signal
            });
            if (200 === response.status || 202 === response.status || 204 === response.status) {
                // success;
                return;
            }
            throw this.__getErrors(response);
        }
        finally {
            abortion.subscription.remove();
        }
    }
    async total(predicate, query, customOptions, cancellation) {
        const abortion = linkAbortion(cancellation);
        try {
            const headers = new Headers();
            headers.append('Accept', 'application/json');
            headers.append('X-Filter', predicate);
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
    exec(offset, count, predicate, sortBy, sortByDirection, query, customOptions) {
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
                        const customKeys = Object.keys(customOptions || {});
                        customKeys.forEach((key) => {
                            const value = (customOptions || {})[key];
                            if (value) {
                                headers.append(key, value);
                            }
                        });
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
export class RestQuery extends Query {
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
        return new RestQuery(this.repo, this.offset, this.count, this.predicate, this.sortBy, this.sortByDirection, options, this.protocolVersion);
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
        return this.repo.exec(this.offset, this.count, predicate, this.sortBy, this.sortByDirection, v1Query, this.customOptions);
    }
}
RestQuery.defaultCount = 100000;
;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxLQUFLLEVBQXdDLGtCQUFrQixFQUErQixNQUFNLGdCQUFnQixDQUFBO0FBQzdILE9BQU8sS0FBSyxDQUFDLE1BQU0sWUFBWSxDQUFBO0FBQy9CLE9BQU8sRUFBRSxjQUFjLElBQUksS0FBSyxFQUFFLE1BQU0sdUJBQXVCLENBQUM7QUFDaEUsT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsQ0FBQztBQUc3QyxNQUFNLFFBQVEsR0FBRyxDQUFDLENBQVMsRUFBRSxPQUFlLEVBQUUsRUFBRTtJQUM5QyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDekIsTUFBTSxJQUFJLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztLQUM5QjtBQUNILENBQUMsQ0FBQTtBQVNELE1BQU0sdUJBQXVCLEdBQUcsQ0FBQztJQUMvQixJQUFLLE1BQWMsQ0FBQyxlQUFlLEVBQUU7UUFDbkMsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQU9MLFNBQVMsWUFBWSxDQUFDLFlBQTJCO0lBQy9DLElBQUksTUFBNkIsQ0FBQztJQUNsQyxJQUFJLFlBQWdDLENBQUM7SUFDckMsSUFBSSxTQUFTLEtBQUssWUFBWSxJQUFJLHVCQUF1QixFQUFFO1FBQ3pELE1BQU0sZUFBZSxHQUFHLElBQUksZUFBZSxFQUFFLENBQUM7UUFDOUMsTUFBTSxHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUM7UUFDaEMsWUFBWSxHQUFHLFlBQVksQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFLENBQUMsZUFBZSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7S0FDdEU7U0FBTTtRQUNMLE1BQU0sR0FBRyxTQUFTLENBQUM7UUFDbkIsWUFB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O1FBQ0QsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLGVBQWUsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzVILENBQUM7O0FBL0xNLHNCQUFZLEdBQUcsTUFBTSxDQUFDO0FBZ005QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUXVlcnksIFJlcG9zaXRvcnksIENhbmNlbGxhYmxlQXN5bmNJdGVyYXRvciwgUXVlcnlTb3J0RGlyZWN0aW9uLCBLZXlSZXBvc2l0b3J5LCBDYW5jZWxsYXRpb24gfSBmcm9tIFwiLi9yZXBvc2l0b3JpZXNcIlxuaW1wb3J0ICogYXMgUSBmcm9tICcuL3Byb3RvY29sJ1xuaW1wb3J0IHsgZGVjb3JhdGVkRmV0Y2ggYXMgZmV0Y2ggfSBmcm9tICdkb3BlZXMtY29yZS9saWIvZmV0Y2gnO1xuaW1wb3J0ICogYXMgdXRmOCBmcm9tICdkb3BlZXMtY29yZS9saWIvdXRmOCc7XG5cblxuY29uc3QgY2hlY2tOdW0gPSAobjogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpID0+IHtcbiAgaWYgKG4gJSAxICE9PSAwIHx8IG4gPD0gMCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IobWVzc2FnZSk7XG4gIH1cbn1cblxuaW50ZXJmYWNlIFJlc3RSZXBvc2l0b3J5T3B0aW9ucyB7XG4gIHR5cGU6IHN0cmluZztcbiAgZW5kcG9pbnQ6IHN0cmluZztcbiAga2V5UHJvcGVydHk/OiBzdHJpbmc7XG4gIHByb3RvY29sVmVyc2lvbj86IG51bWJlcjtcbn1cblxuY29uc3Qgc3VwcG9ydHNBYm9ydENvbnRyb2xsZXIgPSAoZnVuY3Rpb24gKCkge1xuICBpZiAoKHdpbmRvdyBhcyBhbnkpLkFib3J0Q29udHJvbGxlcikge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn0oKSk7XG5cbmludGVyZmFjZSBBYm9ydGlvbiB7XG4gIHNpZ25hbDogQWJvcnRTaWduYWx8dW5kZWZpbmVkXG4gIHN1YnNjcmlwdGlvbjogeyByZW1vdmUoKTogdm9pZCB9XG59XG5cbmZ1bmN0aW9uIGxpbmtBYm9ydGlvbihjYW5jZWxsYXRpb24/OiBDYW5jZWxsYXRpb24pOiBBYm9ydGlvbiB7XG4gIGxldCBzaWduYWw6IEFib3J0U2lnbmFsfHVuZGVmaW5lZDtcbiAgbGV0IHN1YnNjcmlwdGlvbjogeyByZW1vdmUoKTogdm9pZCB9O1xuICBpZiAodW5kZWZpbmVkICE9PSBjYW5jZWxsYXRpb24gJiYgc3VwcG9ydHNBYm9ydENvbnRyb2xsZXIpIHtcbiAgICBjb25zdCBhYm9ydENvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gICAgc2lnbmFsID0gYWJvcnRDb250cm9sbGVyLnNpZ25hbDtcbiAgICBzdWJzY3JpcHRpb24gPSBjYW5jZWxsYXRpb24uc3Vic2NyaWJlKCgpID0+IGFib3J0Q29udHJvbGxlci5hYm9ydCgpKTtcbiAgfSBlbHNlIHtcbiAgICBzaWduYWwgPSB1bmRlZmluZWQ7XG4gICAgc3Vic2NyaXB0aW9uID0geyByZW1vdmUoKSB7IH0gfTtcbiAgfVxuICByZXR1cm4geyBzaWduYWwsIHN1YnNjcmlwdGlvbiB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFYxUXVlcnkge1xuICBxdWVyeT86IHN0cmluZyxcbiAgdHlwZT86IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc3RSZXBvc2l0b3J5PFQ+IGV4dGVuZHMgUmVwb3NpdG9yeTxUPiB7XG4gIGV4ZWMob2Zmc2V0OiBudW1iZXIsIGNvdW50OiBudW1iZXIsIHByZWRpY2F0ZTogc3RyaW5nLCBzb3J0Qnk/OiBzdHJpbmcsIHNvcnRCeURpcmVjdGlvbj86IFF1ZXJ5U29ydERpcmVjdGlvbiwgcXVlcnk/OiBWMVF1ZXJ5LCBjdXN0b21PcHRpb25zPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0pOiBDYW5jZWxsYWJsZUFzeW5jSXRlcmF0b3I8VD47XG4gIHRvdGFsKHByZWRpY2F0ZTogc3RyaW5nLCBxdWVyeTogVjFRdWVyeXx1bmRlZmluZWQsIGN1c3RvbU9wdGlvbnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LCBjYW5jZWxsYXRpb246IENhbmNlbGxhdGlvbik6IFByb21pc2U8bnVtYmVyPjtcbn1cblxuZXhwb3J0IGNsYXNzIEtleVJlc3RSZXBvc2l0b3J5PFREYXRhLCBUS2V5PiBpbXBsZW1lbnRzIEtleVJlcG9zaXRvcnk8VERhdGEsIFRLZXk+LCBSZXN0UmVwb3NpdG9yeTxURGF0YT4ge1xuICByZWFkb25seSBvcHRpb25zIDogUmVzdFJlcG9zaXRvcnlPcHRpb25zXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFJlc3RSZXBvc2l0b3J5T3B0aW9ucykge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cbiAgcHJpdmF0ZSBnZXQgY29sbGVjdGlvbkVuZHBvaW50ICgpIHtcbiAgICByZXR1cm4gYCR7dGhpcy5lbmRwb2ludH0vJHt0aGlzLnR5cGV9YDtcbiAgfVxuICBnZXQgcHJvdG9jb2xWZXJzaW9uICgpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLnByb3RvY29sVmVyc2lvbiB8fCAyO1xuICB9XG4gIGdldCB0eXBlICgpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLnR5cGU7XG4gIH1cbiAgZ2V0IGVuZHBvaW50ICgpIHtcbiAgICByZXR1cm4gdGhpcy5vcHRpb25zLmVuZHBvaW50O1xuICB9XG4gIGdldCBrZXlQcm9wZXJ0eSAoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5rZXlQcm9wZXJ0eSB8fCAnaWQnO1xuICB9XG4gIGdldCBpdGVtcygpOiBRdWVyeTxURGF0YT4ge1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFREYXRhPih0aGlzLCAwLCBSZXN0UXVlcnkuZGVmYXVsdENvdW50LCBudWxsLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwge30sIHRoaXMub3B0aW9ucy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIHByb3RlY3RlZCBnZXRLZXkoaXRlbTogVERhdGEpIHtcbiAgICByZXR1cm4gKGl0ZW0gYXMgYW55KVt0aGlzLmtleVByb3BlcnR5XSBhcyBUS2V5O1xuICB9XG4gIHByaXZhdGUgaGFzS2V5KGl0ZW06IFREYXRhKSB7XG4gICAgcmV0dXJuICEhdGhpcy5nZXRLZXkoaXRlbSk7XG4gIH1cbiAgcHJpdmF0ZSBpdGVtRW5kcG9pbnQoaXRlbTogVERhdGEpIHtcbiAgICByZXR1cm4gYCR7dGhpcy5lbmRwb2ludH0vJHt0aGlzLnR5cGV9LyR7dGhpcy5nZXRLZXkoaXRlbSl9YDtcbiAgfVxuICBwcml2YXRlIF9fZ2V0RXJyb3JzIChyZXNwb25zZTogUmVzcG9uc2UpIHtcbiAgICBjb25zdCBtZXNzYWdlcyA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdYLU1lc3NhZ2UnKTtcbiAgICBpZiAobWVzc2FnZXMpIHtcbiAgICAgIGNvbnN0IG1zZ3MgPSBtZXNzYWdlcy5zcGxpdCgnLCcpLm1hcChkZWNvZGVVUklDb21wb25lbnQpO1xuICAgICAgaWYgKG1zZ3MubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHJldHVybiBtc2dzWzBdO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1zZ3M7XG4gICAgfVxuICAgIHJldHVybiByZXNwb25zZS5zdGF0dXNUZXh0O1xuICB9XG4gIGFzeW5jIGxvb2t1cChrZXk6IFRLZXksIGNhbmNlbGxhdGlvbj86IENhbmNlbGxhdGlvbik6IFByb21pc2U8VERhdGE+IHtcbiAgICBjb25zdCBhYm9ydGlvbiA9IGxpbmtBYm9ydGlvbihjYW5jZWxsYXRpb24pO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB1cmkgPSBgJHt0aGlzLmVuZHBvaW50fS8ke3RoaXMudHlwZX0vJHtrZXl9YDtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJpLCB7XG4gICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgIGhlYWRlcnM6IHsgJ0FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICBzaWduYWw6IGFib3J0aW9uLnNpZ25hbFxuICAgICAgfSk7XG4gICAgICBpZiAocmVzcG9uc2Uub2spIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcbiAgICAgIH1cbiAgICAgIHRocm93IHRoaXMuX19nZXRFcnJvcnMocmVzcG9uc2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhYm9ydGlvbi5zdWJzY3JpcHRpb24ucmVtb3ZlKCk7XG4gICAgfVxuICB9XG4gIGFzeW5jIHVwZGF0ZShpdGVtOiBURGF0YSwgY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGNvbnN0IGFib3J0aW9uID0gbGlua0Fib3J0aW9uKGNhbmNlbGxhdGlvbik7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godGhpcy5pdGVtRW5kcG9pbnQoaXRlbSksIHtcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoaXRlbSksXG4gICAgICAgIHNpZ25hbDogYWJvcnRpb24uc2lnbmFsXG4gICAgICB9KTtcbiAgICAgIGlmIChyZXNwb25zZS5vaykge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb29rdXAodGhpcy5nZXRLZXkoaXRlbSksIGNhbmNlbGxhdGlvbik7XG4gICAgICB9XG4gICAgICB0aHJvdyB0aGlzLl9fZ2V0RXJyb3JzKHJlc3BvbnNlKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYWJvcnRpb24uc3Vic2NyaXB0aW9uLnJlbW92ZSgpO1xuICAgIH1cbiAgfVxuICBhc3luYyBpbnNlcnQoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxURGF0YT4ge1xuICAgIGNvbnN0IGFib3J0aW9uID0gbGlua0Fib3J0aW9uKGNhbmNlbGxhdGlvbik7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godGhpcy5jb2xsZWN0aW9uRW5kcG9pbnQsIHtcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShpdGVtKSxcbiAgICAgICAgc2lnbmFsOiBhYm9ydGlvbi5zaWduYWxcbiAgICAgIH0pO1xuICAgICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICAgIGNvbnN0IHVyaSA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdMb2NhdGlvbicpO1xuICAgICAgICBpZiAoIXVyaSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcigncmVzdCBpbnNlcnQgZGlkIG5vdCByZXR1cm4gYSBsb2NhdGlvbicpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGxvb2t1cEFib3J0aW9uID0gbGlua0Fib3J0aW9uKGNhbmNlbGxhdGlvbik7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKHVyaSwge1xuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ0FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICAgICAgc2lnbmFsOiBsb29rdXBBYm9ydGlvbi5zaWduYWxcbiAgICAgICAgICB9KVxuICAgICAgICAgIGlmIChyZXNwLm9rKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgcmVzcC5qc29uKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IHRoaXMuX19nZXRFcnJvcnMocmVzcCk7XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgbG9va3VwQWJvcnRpb24uc3Vic2NyaXB0aW9uLnJlbW92ZSgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aHJvdyB0aGlzLl9fZ2V0RXJyb3JzKHJlc3BvbnNlKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYWJvcnRpb24uc3Vic2NyaXB0aW9uLnJlbW92ZSgpO1xuICAgIH1cbiAgfVxuICBhc3luYyByZW1vdmUoaXRlbTogVERhdGEsIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYWJvcnRpb24gPSBsaW5rQWJvcnRpb24oY2FuY2VsbGF0aW9uKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh0aGlzLml0ZW1FbmRwb2ludChpdGVtKSwge1xuICAgICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgICBzaWduYWw6IGFib3J0aW9uLnNpZ25hbFxuICAgICAgfSk7XG4gICAgICBpZiAoMjAwID09PSByZXNwb25zZS5zdGF0dXMgfHwgMjAyID09PSByZXNwb25zZS5zdGF0dXMgfHwgMjA0ID09PSByZXNwb25zZS5zdGF0dXMpIHtcbiAgICAgICAgLy8gc3VjY2VzcztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgdGhpcy5fX2dldEVycm9ycyhyZXNwb25zZSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGFib3J0aW9uLnN1YnNjcmlwdGlvbi5yZW1vdmUoKTtcbiAgICB9XG4gIH1cbiAgYXN5bmMgdG90YWwocHJlZGljYXRlOiBzdHJpbmcsIHF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZCwgY3VzdG9tT3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIGNhbmNlbGxhdGlvbjogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCBhYm9ydGlvbiA9IGxpbmtBYm9ydGlvbihjYW5jZWxsYXRpb24pO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKTtcbiAgICAgIGhlYWRlcnMuYXBwZW5kKCdBY2NlcHQnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtRmlsdGVyJywgcHJlZGljYXRlKTtcbiAgICAgIGlmIChxdWVyeSAmJiBxdWVyeS5xdWVyeSkge1xuICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1RdWVyeScsIHF1ZXJ5LnF1ZXJ5KTtcbiAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU2VhcmNoVHlwZScsIHF1ZXJ5LnR5cGUgfHwgJ3BhcnRpYWwnKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGN1c3RvbUtleXMgPSBPYmplY3Qua2V5cyhjdXN0b21PcHRpb25zIHx8IHt9KTtcbiAgICAgIGN1c3RvbUtleXMuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gY3VzdG9tT3B0aW9uc1trZXldO1xuICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICBoZWFkZXJzLmFwcGVuZChrZXksIHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHRoaXMuY29sbGVjdGlvbkVuZHBvaW50LCB7IGhlYWRlcnMsIHNpZ25hbDogYWJvcnRpb24uc2lnbmFsIH0pO1xuICAgICAgaWYgKHJlc3BvbnNlLm9rKSB7XG4gICAgICAgIGNvbnN0IGhlYWRlciA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCdYLVRvdGFsLUNvdW50Jyk7XG4gICAgICAgIHJldHVybiBoZWFkZXIgPyAocGFyc2VJbnQoaGVhZGVyLCAxMCkgfHwgMCkgOiAwO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIaWJhIGzDqXBldHQgZmVsIGFkYXRvayBsZWvDqXJkZXrDqXNlIGvDtnpiZW46ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYWJvcnRpb24uc3Vic2NyaXB0aW9uLnJlbW92ZSgpO1xuICAgIH1cbiAgfVxuICBleGVjKG9mZnNldDogbnVtYmVyLCBjb3VudDogbnVtYmVyLCBwcmVkaWNhdGU6IHN0cmluZywgc29ydEJ5Pzogc3RyaW5nLCBzb3J0QnlEaXJlY3Rpb24/OiBRdWVyeVNvcnREaXJlY3Rpb24sIHF1ZXJ5PzogVjFRdWVyeSwgY3VzdG9tT3B0aW9ucz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9KTogQ2FuY2VsbGFibGVBc3luY0l0ZXJhdG9yPFREYXRhPiB7XG4gICAgY29uc3QgcmVwbyA9IHRoaXM7XG4gICAgbGV0IGVycm9yIDogYW55ID0gbnVsbDtcbiAgICBsZXQgaXRlbXMgOiBURGF0YVtdfG51bGwgPSBudWxsO1xuICAgIGxldCBpbmRleCA9IDA7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFzeW5jIG5leHQoY2FuY2VsbGF0aW9uPzogQ2FuY2VsbGF0aW9uKTogUHJvbWlzZTxJdGVyYXRvclJlc3VsdDxURGF0YT4+IHtcbiAgICAgICAgY2FuY2VsbGF0aW9uICYmIGNhbmNlbGxhdGlvbi50aHJvd0lmQ2FuY2VsbGVkKCk7XG4gICAgICAgIGlmIChudWxsICE9PSBlcnJvcikge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICAgIGlmICghaXRlbXMpIHtcbiAgICAgICAgICAvLyBFbHPFkSBuZXh0KCkgbWVnaMOtdsOhc2Frb3IgZXogZnV0IGxlLlxuICAgICAgICAgIGNvbnN0IGFib3J0aW9uID0gbGlua0Fib3J0aW9uKGNhbmNlbGxhdGlvbik7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGhlYWRlcnMgPSBuZXcgSGVhZGVycygpO1xuICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ0FjY2VwdCcsICdhcHBsaWNhdGlvbi9qc29uJyk7XG4gICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1PZmZzZXQnLCBTdHJpbmcob2Zmc2V0KSk7XG4gICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1Db3VudCcsIFN0cmluZyhjb3VudCkpO1xuICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtRmlsdGVyJywgcHJlZGljYXRlKTtcbiAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVNvcnQtQnknLCBzb3J0QnkgfHwgJycpO1xuICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoJ1gtU29ydC1CeS1EaXJlY3Rpb24nLCBzb3J0QnlEaXJlY3Rpb24gfHwgJycpO1xuICAgICAgICAgICAgaWYgKHF1ZXJ5ICYmIHF1ZXJ5LnF1ZXJ5KSB7XG4gICAgICAgICAgICAgIGhlYWRlcnMuYXBwZW5kKCdYLVF1ZXJ5JywgcXVlcnkucXVlcnkpO1xuICAgICAgICAgICAgICBoZWFkZXJzLmFwcGVuZCgnWC1TZWFyY2hUeXBlJywgcXVlcnkudHlwZSB8fCAncGFydGlhbCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgY3VzdG9tS2V5cyA9IE9iamVjdC5rZXlzKGN1c3RvbU9wdGlvbnMgfHwge30pO1xuICAgICAgICAgICAgY3VzdG9tS2V5cy5mb3JFYWNoKChrZXkpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSAoY3VzdG9tT3B0aW9ucyB8fCB7fSlba2V5XTtcbiAgICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgaGVhZGVycy5hcHBlbmQoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChyZXBvLmNvbGxlY3Rpb25FbmRwb2ludCwgeyBoZWFkZXJzLCBzaWduYWw6IGFib3J0aW9uLnNpZ25hbCB9KTtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZS5vaykge1xuICAgICAgICAgICAgICBpdGVtcyA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGVycm9yID0gbmV3IEVycm9yKGBIaWJhIGzDqXBldHQgZmVsIGFkYXRvayBsZWvDqXJkZXrDqXNlIGvDtnpiZW46ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGFib3J0aW9uLnN1YnNjcmlwdGlvbi5yZW1vdmUoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFpdGVtcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignc2hvdWxkIG5ldmVyIGhhcHBlbicpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChpbmRleCA+PSBpdGVtcy5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm4geyBkb25lOiB0cnVlLCB2YWx1ZTogPFREYXRhPjx1bmtub3duPnVuZGVmaW5lZCB9XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdmFsdWUgPSBpdGVtc1tpbmRleF07XG4gICAgICAgICsraW5kZXg7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZG9uZTogZmFsc2UsXG4gICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgIH07XG4gICAgICB9LFxuICAgICAgY2FuY2VsKCkge1xuICAgICAgICAgIC8vRklYTUU6IGltcGxlbWVudFxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5jb25zdCByZWdleCA9IC9bXFwwLVxceDA4XFxuLVxceDFGXFx4N0YtXFx1RkZGRl0vZztcblxuZXhwb3J0IGNsYXNzIFJlc3RRdWVyeTxUPiBleHRlbmRzIFF1ZXJ5PFQ+IHtcbiAgc3RhdGljIGRlZmF1bHRDb3VudCA9IDEwMDAwMDtcbiAgcmVhZG9ubHkgcmVwbzogUmVzdFJlcG9zaXRvcnk8VD47XG4gIHJlYWRvbmx5IG9mZnNldDogbnVtYmVyO1xuICByZWFkb25seSBjb3VudDogbnVtYmVyO1xuICByZWFkb25seSBwcmVkaWNhdGU6IFEuTGFtYmRhfG51bGw7XG4gIHJlYWRvbmx5IHNvcnRCeTogc3RyaW5nO1xuICByZWFkb25seSBzb3J0QnlEaXJlY3Rpb246IFF1ZXJ5U29ydERpcmVjdGlvbjtcbiAgcmVhZG9ubHkgcHJvdG9jb2xWZXJzaW9uOiBudW1iZXI7XG4gIHJlYWRvbmx5IGN1c3RvbU9wdGlvbnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9O1xuICBjb25zdHJ1Y3RvciAocmVwbzogUmVzdFJlcG9zaXRvcnk8VD4sIG9mZnNldDogbnVtYmVyLCBjb3VudDogbnVtYmVyLCBwcmVkaWNhdGU/OiBRLkxhbWJkYXxudWxsLCBzb3J0Qnk/OiBzdHJpbmcsIHNvcnRCeURpcmVjdGlvbj86IFF1ZXJ5U29ydERpcmVjdGlvbiwgY3VzdG9tT3B0aW9ucz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nfHVuZGVmaW5lZCB9LCBwcm90b2NvbFZlcnNpb24/OiBudW1iZXIpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMucmVwbyA9IHJlcG87XG4gICAgdGhpcy5vZmZzZXQgPSBvZmZzZXQgfHwgMDtcbiAgICB0aGlzLmNvdW50ID0gMCA9PT0gY291bnQgPyBjb3VudCA6IChjb3VudCB8fCBSZXN0UXVlcnkuZGVmYXVsdENvdW50KTtcbiAgICB0aGlzLnByZWRpY2F0ZSA9IHByZWRpY2F0ZSB8fCBudWxsO1xuICAgIHRoaXMuc29ydEJ5ID0gc29ydEJ5IHx8ICcnO1xuICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uID0gc29ydEJ5RGlyZWN0aW9uIHx8IFF1ZXJ5U29ydERpcmVjdGlvbi5Bc2M7XG4gICAgdGhpcy5jdXN0b21PcHRpb25zID0gY3VzdG9tT3B0aW9ucyB8fCB7fTtcbiAgICB0aGlzLnByb3RvY29sVmVyc2lvbiA9IHByb3RvY29sVmVyc2lvbiB8fCAyO1xuICB9XG4gIHByaXZhdGUgZXNjYXBlIChpbnB1dDogc3RyaW5nfFEuRXhwcnxudWxsKSB7XG4gICAgaWYgKCFpbnB1dCkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cbiAgICBjb25zdCBpbnAgPSBpbnB1dCBpbnN0YW5jZW9mIFEuRXhwciA/IHRoaXMuYXBwbHlQcm90b2NvbChpbnB1dCkudG9TdHJpbmcoKSA6IGlucHV0O1xuICAgIHJldHVybiB1dGY4LnV0ZjhlbmNvZGUoaW5wKS5yZXBsYWNlKHJlZ2V4LCBtID0+ICclJyArICgnMCcgKyBtLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkpLnNsaWNlKC0yKSk7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5UHJvdG9jb2woZXhwcjogUS5FeHByKSB7XG4gICAgaWYgKHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMiAmJiBleHByIGluc3RhbmNlb2YgUS5MYW1iZGEpIHtcbiAgICAgIGNvbnN0IHBhcmFtID0gZXhwci5wYXJhbTtcbiAgICAgIHJldHVybiBleHByLmJvZHkuYWNjZXB0PFEuRXhwcj4oe1xuICAgICAgICB2aXNpdENvbnN0KGMpIHsgcmV0dXJuIGM7IH0sXG4gICAgICAgIHZpc2l0UGFyYW0ocCkgeyByZXR1cm4gcDsgfSxcbiAgICAgICAgdmlzaXRQcm9wKHApIHsgcmV0dXJuIHAuaW5zdGFuY2UuZXEocGFyYW0pID8gbmV3IFEuUGFyYW0oPGFueT4gcC5uYW1lKSA6IG5ldyBRLlByb3AocC5pbnN0YW5jZS5hY2NlcHQodGhpcyksIHAubmFtZSk7IH0sXG4gICAgICAgIHZpc2l0QmluYXJ5KGIpIHsgcmV0dXJuIG5ldyBRLkJpbk9wKGIubGVmdC5hY2NlcHQodGhpcyksIGIub3AsIGIucmlnaHQuYWNjZXB0KHRoaXMpKTsgfSxcbiAgICAgICAgdmlzaXRVbmFyeSh1KSB7IHJldHVybiBuZXcgUS5Vbk9wKHUub3AsIHUub3BlcmFuZC5hY2NlcHQodGhpcykpOyB9LFxuICAgICAgICB2aXNpdENhbGwoYykgeyByZXR1cm4gbmV3IFEuQ2FsbChjLm5hbWUsIGMuYXJncy5tYXAoYXJnID0+IGFyZy5hY2NlcHQodGhpcykpKTsgfSxcbiAgICAgICAgdmlzaXRMYW1iZGEobCkgeyByZXR1cm4gbmV3IFEuTGFtYmRhKGwuYm9keS5hY2NlcHQodGhpcyksIGwucGFyYW0pOyB9XG4gICAgICB9KVxuICAgIH1cbiAgICByZXR1cm4gZXhwcjtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdFYxUXVlcnkoZXhwcjogUS5FeHByKSB7XG4gICAgY29uc3QgcTogeyBxdWVyeT86IHN0cmluZyB9ID0ge307XG4gICAgY29uc3QgdjFFeHByID0gZXhwci5hY2NlcHQ8US5FeHByPih7XG4gICAgICB2aXNpdENvbnN0KGMpIHsgcmV0dXJuIGM7IH0sXG4gICAgICB2aXNpdFBhcmFtKHApIHsgcmV0dXJuIHA7IH0sXG4gICAgICB2aXNpdFByb3AocCkgeyByZXR1cm4gbmV3IFEuUHJvcChwLmluc3RhbmNlLmFjY2VwdCh0aGlzKSwgcC5uYW1lKTsgfSxcbiAgICAgIHZpc2l0QmluYXJ5KGIpIHtcbiAgICAgICAgY29uc3QgbCA9IGIubGVmdC5hY2NlcHQodGhpcyk7XG4gICAgICAgIGNvbnN0IHIgPSBiLnJpZ2h0LmFjY2VwdCh0aGlzKTtcbiAgICAgICAgaWYgKGwgaW5zdGFuY2VvZiBRLkNvbnN0ICYmICg8YW55PiBsLnZhbHVlID09PSB0cnVlIHx8IDxhbnk+IGwudmFsdWUgPT09ICd0cnVlJykpIHtcbiAgICAgICAgICAgIHJldHVybiByO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyIGluc3RhbmNlb2YgUS5Db25zdCAmJiAoPGFueT4gci52YWx1ZSA9PT0gdHJ1ZSB8fCA8YW55PiByLnZhbHVlID09PSAndHJ1ZScpKSB7XG4gICAgICAgICAgICByZXR1cm4gbDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFEuQmluT3AobCwgYi5vcCwgcik7XG4gICAgICB9LFxuICAgICAgdmlzaXRVbmFyeSh1KSB7IHJldHVybiBuZXcgUS5Vbk9wKHUub3AsIHUub3BlcmFuZC5hY2NlcHQodGhpcykpOyB9LFxuICAgICAgdmlzaXRDYWxsIChjKSB7XG4gICAgICAgIGlmICgncGFydGlhbE1hdGNoJyA9PT0gYy5uYW1lICYmIDIgPT09IGMuYXJncy5sZW5ndGgpIHtcbiAgICAgICAgICBjb25zdCBhcmcgPSBjLmFyZ3NbMV07XG4gICAgICAgICAgaWYgKGFyZyBpbnN0YW5jZW9mIFEuQ29uc3QgJiYgYXJnLnZhbHVlKSB7XG4gICAgICAgICAgICBxLnF1ZXJ5ID0gYXJnLnZhbHVlO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBRLkNvbnN0KDxhbnk+IHRydWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ25vdCBzdXBwb3J0ZWQgcGFydGlhbCBtYXRjaCBpbiBwcm90b2NvbCB2MScpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgUS5DYWxsKGMubmFtZSwgYy5hcmdzLm1hcChhcmcgPT4gYXJnLmFjY2VwdCh0aGlzKSkpO1xuICAgICAgfSxcbiAgICAgIHZpc2l0TGFtYmRhKGwpIHsgcmV0dXJuIG5ldyBRLkxhbWJkYShsLmJvZHkuYWNjZXB0KHRoaXMpLCBsLnBhcmFtKTsgfVxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICAgIGV4cHI6IHYxRXhwcixcbiAgICAgICAgcXVlcnk6IHFcbiAgICB9O1xuICB9XG5cbiAgZ2V0IGVzY2FwZWRQcmVkaWNhdGUgKCkge1xuICAgIHJldHVybiB0aGlzLmVzY2FwZSh0aGlzLnByZWRpY2F0ZSk7XG4gIH1cbiAgZ2V0IGVzY2FwZWRTb3J0QnkgKCkge1xuICAgIHJldHVybiB0aGlzLmVzY2FwZSh0aGlzLnNvcnRCeSk7XG4gIH1cbiAgZmlsdGVyKHByZWRpY2F0ZTogc3RyaW5nfFEuTGFtYmRhKSB7XG4gICAgY29uc3QgcCA9ICdzdHJpbmcnID09PSB0eXBlb2YgcHJlZGljYXRlID8gUS5wYXJzZShwcmVkaWNhdGUpIDogcHJlZGljYXRlO1xuICAgIGlmICghKHAgaW5zdGFuY2VvZiBRLkxhbWJkYSkpIHtcbiAgICAgIHRocm93IFR5cGVFcnJvcigncHJlZGljYXRlIG11c3QgYmUgYSBsYW1iZGEgZXhwcmVzc2lvbicpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIHRoaXMub2Zmc2V0LFxuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlID8gdGhpcy5wcmVkaWNhdGUuYW5kKHApIDogcCxcbiAgICAgIHRoaXMuc29ydEJ5LFxuICAgICAgdGhpcy5zb3J0QnlEaXJlY3Rpb24sXG4gICAgICB0aGlzLmN1c3RvbU9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvblxuICAgICk7XG4gIH1cbiAgc2tpcChuOiBudW1iZXIpOiBRdWVyeTxUPiB7XG4gICAgaWYgKDAgPT09IG4pIHtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICBjaGVja051bShuLCAnc2tpcCBwYXJhbWV0ZXIgbXVzdCBiZSBub24tbmVnYXRpdmUgd2hvbGUgbnVtYmVyLicpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgbiwgLy8gVE9ETzogRXp0IHbDqWdpZyBrZWxsIGdvbmRvbG5pLCBtZXJ0IGxlaGV0ICh0aGlzLm9mZnNldCArIG4pIGtlbGxlbmUgaWRlP1xuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIHRoaXMuY3VzdG9tT3B0aW9ucyxcbiAgICAgIHRoaXMucHJvdG9jb2xWZXJzaW9uXG4gICAgKTtcbiAgfVxuICB0YWtlKG46IG51bWJlcik6IFF1ZXJ5PFQ+IHtcbiAgICBjaGVja051bShuLCAndGFrZSBwYXJhbWV0ZXIgbXVzdCBiZSBub24tbmVnYXRpdmUgd2hvbGUgbnVtYmVyLicpO1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICBuLFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICB0aGlzLnNvcnRCeSxcbiAgICAgIHRoaXMuc29ydEJ5RGlyZWN0aW9uLFxuICAgICAgdGhpcy5jdXN0b21PcHRpb25zLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIG9yZGVyQnkoc2VsZWN0b3I6IHN0cmluZywgZGlyZWN0aW9uPzogUXVlcnlTb3J0RGlyZWN0aW9uKTogUXVlcnk8VD4ge1xuICAgIHJldHVybiBuZXcgUmVzdFF1ZXJ5PFQ+KFxuICAgICAgdGhpcy5yZXBvLFxuICAgICAgdGhpcy5vZmZzZXQsXG4gICAgICB0aGlzLmNvdW50LFxuICAgICAgdGhpcy5wcmVkaWNhdGUsXG4gICAgICBzZWxlY3RvcixcbiAgICAgIGRpcmVjdGlvbiB8fCBRdWVyeVNvcnREaXJlY3Rpb24uQXNjLFxuICAgICAgdGhpcy5jdXN0b21PcHRpb25zLFxuICAgICAgdGhpcy5wcm90b2NvbFZlcnNpb24pO1xuICB9XG4gIHNldEN1c3RvbU9wdGlvbnMob3B0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmd8dW5kZWZpbmVkIH0sIHJlcGxhY2U/OiBib29sZWFuKTogUXVlcnk8VD4ge1xuICAgIGNvbnN0IG9wdHMgPSByZXBsYWNlID8gKG9wdGlvbnMgfHwge30pIDogT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5jdXN0b21PcHRpb25zLCBvcHRpb25zKTtcbiAgICByZXR1cm4gbmV3IFJlc3RRdWVyeTxUPihcbiAgICAgIHRoaXMucmVwbyxcbiAgICAgIHRoaXMub2Zmc2V0LFxuICAgICAgdGhpcy5jb3VudCxcbiAgICAgIHRoaXMucHJlZGljYXRlLFxuICAgICAgdGhpcy5zb3J0QnksXG4gICAgICB0aGlzLnNvcnRCeURpcmVjdGlvbixcbiAgICAgIG9wdGlvbnMsXG4gICAgICB0aGlzLnByb3RvY29sVmVyc2lvbik7XG4gIH1cbiAgYXN5bmMgdG90YWwoY2FuY2VsbGF0aW9uOiBDYW5jZWxsYXRpb24pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGxldCBwcmVkaWNhdGU6IHN0cmluZztcbiAgICBsZXQgdjFRdWVyeTogVjFRdWVyeXx1bmRlZmluZWQ7XG4gICAgaWYgKCF0aGlzLnByZWRpY2F0ZSkge1xuICAgICAgcHJlZGljYXRlID0gJyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLnByb3RvY29sVmVyc2lvbiA8IDIpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHRoaXMuZXh0cmFjdFYxUXVlcnkodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgICBwcmVkaWNhdGUgPSB0aGlzLmVzY2FwZShkYXRhLmV4cHIpO1xuICAgICAgICB2MVF1ZXJ5ID0gZGF0YS5xdWVyeTtcbiAgICAgICAgaWYgKHByZWRpY2F0ZSAmJiBwcmVkaWNhdGUuc3RhcnRzV2l0aCgnKCcpICYmIHByZWRpY2F0ZS5lbmRzV2l0aCgnKScpKSB7XG4gICAgICAgICAgcHJlZGljYXRlID0gcHJlZGljYXRlLnN1YnN0cigxLCBwcmVkaWNhdGUubGVuZ3RoIC0gMik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKHRoaXMucHJlZGljYXRlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRoaXMucmVwby50b3RhbChwcmVkaWNhdGUsIHYxUXVlcnksIHRoaXMuY3VzdG9tT3B0aW9ucywgY2FuY2VsbGF0aW9uKTtcbiAgfVxuICBleGVjKCk6IENhbmNlbGxhYmxlQXN5bmNJdGVyYXRvcjxUPiB7XG4gICAgbGV0IHByZWRpY2F0ZTogc3RyaW5nO1xuICAgIGxldCB2MVF1ZXJ5OiBWMVF1ZXJ5fHVuZGVmaW5lZDtcbiAgICBpZiAoIXRoaXMucHJlZGljYXRlKSB7XG4gICAgICBwcmVkaWNhdGUgPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMucHJvdG9jb2xWZXJzaW9uIDwgMikge1xuICAgICAgICBjb25zdCBkYXRhID0gdGhpcy5leHRyYWN0VjFRdWVyeSh0aGlzLnByZWRpY2F0ZSk7XG4gICAgICAgIHByZWRpY2F0ZSA9IHRoaXMuZXNjYXBlKGRhdGEuZXhwcik7XG4gICAgICAgIHYxUXVlcnkgPSBkYXRhLnF1ZXJ5O1xuICAgICAgICBpZiAocHJlZGljYXRlICYmIHByZWRpY2F0ZS5zdGFydHNXaXRoKCcoJykgJiYgcHJlZGljYXRlLmVuZHNXaXRoKCcpJykpIHtcbiAgICAgICAgICBwcmVkaWNhdGUgPSBwcmVkaWNhdGUuc3Vic3RyKDEsIHByZWRpY2F0ZS5sZW5ndGggLSAyKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJlZGljYXRlID0gdGhpcy5lc2NhcGUodGhpcy5wcmVkaWNhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5yZXBvLmV4ZWModGhpcy5vZmZzZXQsIHRoaXMuY291bnQsIHByZWRpY2F0ZSwgdGhpcy5zb3J0QnksIHRoaXMuc29ydEJ5RGlyZWN0aW9uLCB2MVF1ZXJ5LCB0aGlzLmN1c3RvbU9wdGlvbnMpO1xuICB9XG59OyJdfQ==