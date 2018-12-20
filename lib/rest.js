import { Query, QuerySortDirection } from "./repositories";
import * as Q from './protocol';
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
        return new RestQuery(this, 0, RestQuery.defaultCount);
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
            const response = await window.fetch(uri, {
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
            const response = await window.fetch(this.itemEndpoint(item), {
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
            const response = await window.fetch(this.collectionEndpoint, {
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
                    const resp = await window.fetch(uri, {
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
    async total(predicate, cancellation) {
        const abortion = linkAbortion(cancellation);
        try {
            const headers = new Headers();
            headers.append('Accept', 'application/json');
            headers.append('X-Filter', predicate);
            const response = await window.fetch(this.collectionEndpoint, { headers, signal: abortion.signal });
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
    exec(offset, count, predicate, sortBy, sortByDirection) {
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
                        const response = await window.fetch(repo.collectionEndpoint, { headers, signal: abortion.signal });
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
class RestQuery extends Query {
    constructor(repo, offset, count, predicate, sortBy, sortByDirection) {
        super();
        this.repo = repo;
        this.offset = offset || 0;
        this.count = 0 === count ? count : (count || RestQuery.defaultCount);
        this.predicate = predicate || null;
        this.sortBy = sortBy || '';
        this.sortByDirection = sortByDirection || QuerySortDirection.Asc;
    }
    escape(input) {
        if (!input) {
            return '';
        }
        const inp = input instanceof Q.Expr ? input.toString() : input;
        // return window.utf8.encode(inp).replace(regex, m => '%' + ('0' + m.charCodeAt(0).toString(16).toUpperCase()).slice(-2));
        return inp;
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
        return new RestQuery(this.repo, this.offset, this.count, this.predicate ? this.predicate.and(p) : p, this.sortBy, this.sortByDirection);
    }
    skip(n) {
        if (0 === n) {
            return this;
        }
        checkNum(n, 'skip parameter must be non-negative whole number.');
        return new RestQuery(this.repo, n, // TODO: Ezt végig kell gondolni, mert lehet (this.offset + n) kellene ide?
        this.count, this.predicate, this.sortBy, this.sortByDirection);
    }
    take(n) {
        checkNum(n, 'take parameter must be non-negative whole number.');
        return new RestQuery(this.repo, this.offset, n, this.predicate, this.sortBy, this.sortByDirection);
    }
    orderBy(selector, direction) {
        return new RestQuery(this.repo, this.offset, this.count, this.predicate, selector, direction || QuerySortDirection.Asc);
    }
    async total(cancellation) {
        return this.repo.total(this.escapedPredicate, cancellation);
    }
    exec() {
        return this.repo.exec(this.offset, this.count, this.escapedPredicate, this.sortBy, this.sortByDirection);
    }
}
RestQuery.defaultCount = 100000;
;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9yZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxLQUFLLEVBQXdDLGtCQUFrQixFQUErQixNQUFNLGdCQUFnQixDQUFBO0FBQzdILE9BQU8sS0FBSyxDQUFDLE1BQU0sWUFBWSxDQUFBO0FBRy9CLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBUyxFQUFFLE9BQWUsRUFBRSxFQUFFO0lBQzlDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6QixNQUFNLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0tBQzlCO0FBQ0gsQ0FBQyxDQUFBO0FBU0QsTUFBTSx1QkFBdUIsR0FBRyxDQUFDO0lBQy9CLElBQUssTUFBYyxDQUFDLGVBQWUsRUFBRTtRQUNuQyxPQUFPLElBQUksQ0FBQztLQUNiO0lBQ0QsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBT0wsU0FBUyxZQUFZLENBQUMsWUFBMkI7SUFDL0MsSUFBSSxNQUE2QixDQUFDO0lBQ2xDLElBQUksWUFBZ0MsQ0FBQztJQUNyQyxJQUFJLFNBQVMsS0FBSyxZQUFZLElBQUksdUJBQXVCLEVBQUU7UUFDekQsTUFBTSxlQUFlLEdBQUcsSUFBSSxlQUFlLEVBQUUsQ0FBQztRQUM5QyxNQUFNLEdBQUcsZUFBZSxDQUFDLE1BQU0sQ0FBQztRQUNoQyxZQUFZLEdBQUcsWUFBWSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxlQUFlLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztLQUN0RTtTQUFNO1FBQ0wsTUFBTSxHQUFHLFNBQVMsQ0FBQztRQUNuQixZQUFZLEdBQUcsRUFBRSxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7S0FDakM7SUFDRCxPQUFPLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxDQUFDO0FBQ2xDLENB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