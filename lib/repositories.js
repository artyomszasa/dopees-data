export class CancelledError extends Error {
    constructor() { super('operation has been cancelled'); }
}
const dummySubscription = {
    remove() { }
};
export class Cancellation {
    throwIfCancelled() {
        if (this.cancelled) {
            throw new CancelledError();
        }
    }
}
Cancellation.none = {
    cancelled: false,
    subscribe(_) { return dummySubscription; },
    throwIfCancelled() { }
};
export const None = {};
export class CancellationSource extends Cancellation {
    constructor() {
        super(...arguments);
        this.callbacks = new Array();
        this.cancelled = false;
    }
    static link(cancellation1, cancellation2) {
        return { get cancelled() { return cancellation1.cancelled || cancellation2.cancelled; } };
    }
    get cancellation() { return this; }
    cancel() {
        this.cancelled = true;
        this.callbacks.forEach(callback => callback());
        this.callbacks.splice(0, this.callbacks.length);
    }
    subscribe(callback) {
        if (this.callbacks.some(x => x === callback)) {
            throw new Error('callback already registered');
        }
        this.callbacks.push(callback);
        const that = this;
        return {
            remove() {
                const index = that.callbacks.indexOf(callback);
                if (-1 !== index) {
                    that.callbacks.splice(index, 1);
                }
            }
        };
    }
}
export var QuerySortDirection;
(function (QuerySortDirection) {
    QuerySortDirection["Asc"] = "asc";
    QuerySortDirection["Desc"] = "desc";
})(QuerySortDirection || (QuerySortDirection = {}));
export class Query {
    async forEach(callback, cancellation) {
        const iterator = this.exec();
        let index = 0;
        const runner = async () => {
            const res = await iterator.next(cancellation);
            if (res.done) {
                return;
            }
            await callback(res.value, index);
            ++index;
            return await runner();
        };
        await runner();
    }
    async toArray(cancellation) {
        const result = new Array();
        await this.forEach(async (item) => result.push(item), cancellation);
        return result;
    }
    async first(cancellation) {
        const iterator = this.exec();
        try {
            const first = await iterator.next(cancellation);
            if (first.done) {
                throw new Error('sequence contains no elements');
            }
            return first.value;
        }
        finally {
            iterator.cancel();
        }
    }
    async tryFirst(cancellation) {
        const iterator = this.exec();
        try {
            const first = await iterator.next(cancellation);
            return first.done ? None : first.value;
        }
        finally {
            iterator.cancel();
        }
    }
    async single(cancellation) {
        const iterator = this.exec();
        try {
            const first = await iterator.next(cancellation);
            if (first.done) {
                throw new Error('sequence contains no elements');
            }
            const next = await iterator.next(cancellation);
            if (!next.done) {
                throw new Error('sequence contains more than 1 element elements');
            }
            return first.value;
        }
        finally {
            iterator.cancel();
        }
    }
    async trySingle(cancellation) {
        const iterator = this.exec();
        try {
            const first = await iterator.next(cancellation);
            if (first.done) {
                return None;
            }
            const next = await iterator.next(cancellation);
            if (!next.done) {
                throw new Error('sequence contains more than 1 element elements');
            }
            return first.value;
        }
        finally {
            iterator.cancel();
        }
    }
}
export class RepositoryStore {
    constructor() {
        this.store = {};
    }
    register(name, factory) {
        this.store[name] = factory;
    }
    get(name) {
        const factory = this.store[name];
        return factory && factory();
    }
    getRepository(name) {
        const factory = this.store[name];
        return factory && factory();
    }
}
const repositories = new RepositoryStore();
export { repositories };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwb3NpdG9yaWVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3JlcG9zaXRvcmllcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFFQSxNQUFNLE9BQU8sY0FBZSxTQUFRLEtBQUs7SUFDdkMsZ0JBQWdCLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDLENBQUMsQ0FBQztDQUN6RDtBQUVELE1BQU0saUJBQWlCLEdBQUc7SUFDeEIsTUFBTSxLQUFLLENBQUM7Q0FDYixDQUFDO0FBRUYsTUFBTSxPQUFnQixZQUFZO0lBUWhDLGdCQUFnQjtRQUNkLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUNsQixNQUFNLElBQUksY0FBYyxFQUFFLENBQUM7U0FDNUI7SUFDSCxDQUFDOztBQVhNLGlCQUFJLEdBQWtCO0lBQzNCLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLFNBQVMsQ0FBQyxDQUFXLElBQUksT0FBTyxpQkFBaUIsQ0FBQyxDQUFDLENBQUM7SUFDcEQsZ0JBQWdCLEtBQUssQ0FBQztDQUN2QixDQUFDO0FBWUosTUFBTSxDQUFDLE1BQU0sSUFBSSxHQUFVLEVBQUUsQ0FBQztBQU85QixNQUFNLE9BQU8sa0JBQW1CLFNBQVEsWUFBWTtJQUFwRDs7UUFJVyxjQUFTLEdBQUcsSUFBSSxLQUFLLEVBQVksQ0FBQztRQUMzQyxjQUFTLEdBQUcsS0FBSyxDQUFBO0lBc0JuQixDQUFDO0lBMUJDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBNEIsRUFBRSxhQUE0QjtRQUNwRSxPQUFPLEVBQUUsSUFBSSxTQUFTLEtBQU0sT0FBTyxhQUFhLENBQUMsU0FBUyxJQUFJLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtJQUM1RixDQUFDO0lBR0QsSUFBSSxZQUFZLEtBQXFCLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNuRCxNQUFNO1FBQ0osSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUM7UUFDdEIsSUFBSSxDQUFD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