import * as Q from './protocol'

export class CancelledError extends Error {
  constructor() { super('operation has been cancelled'); }
}

const dummySubscription = {
  remove() { }
};

export abstract class Cancellation {
  static none : Cancellation = {
    cancelled: false,
    subscribe(_: Function) { return dummySubscription; },
    throwIfCancelled() { }
  };
  abstract cancelled : boolean
  abstract subscribe(callback: Function): { remove(): void }
  throwIfCancelled() {
    if (this.cancelled) {
      throw new CancelledError();
    }
  }
}

export interface None { }

export const None : None = {};

export interface CancellableAsyncIterator<T> {
  next(cancellation? : Cancellation) : Promise<IteratorResult<T>>
  cancel() : void
}

export class CancellationSource extends Cancellation {
  static link(cancellation1 : Cancellation, cancellation2 : Cancellation) {
    return { get cancelled () { return cancellation1.cancelled || cancellation2.cancelled; } }
  }
  readonly callbacks = new Array<Function>();
  cancelled = false
  get cancellation () : Cancellation { return this; }
  cancel() {
    this.cancelled = true;
    this.callbacks.forEach(callback => callback());
    this.callbacks.splice(0, this.callbacks.length);
  }
  subscribe(callback: Function) {
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
    }
  }
}

export enum QuerySortDirection {
    Asc = 'asc',
    Desc = 'desc'
}

export abstract class Query<T> {
  abstract exec(): CancellableAsyncIterator<T>
  abstract filter(predicate: string|Q.Expr): Query<T>
  abstract skip(n: number): Query<T>
  abstract take(n: number): Query<T>
  abstract orderBy(sortBy: string, sortByDirection: QuerySortDirection): Query<T>
  abstract total(cancellation: Cancellation): Promise<number>

  async forEach(callback : (item : T, index : number) => Promise<any>, cancellation? : Cancellation) {
    const iterator = this.exec();
    let index = 0;
    const runner = async () : Promise<void> => {
      const res = await iterator.next(cancellation);
      if (res.done) {
          return;
      }
      await callback(res.value, index);
      ++index;
      return await runner();
    }
    await runner();
  }
  async toArray(cancellation? : Cancellation) {
    const result = new Array<T>();
    await this.forEach(async item => result.push(item), cancellation);
    return result;
  }
  async first(cancellation? : Cancellation) {
    const iterator = this.exec();
    try {
      const first = await iterator.next(cancellation);
      if (first.done) {
        throw new Error('sequence contains no elements');
      }
      return first.value;
    } finally {
      iterator.cancel();
    }
  }
  async tryFirst(cancellation? : Cancellation) : Promise<T | None> {
    const iterator = this.exec();
    try {
      const first = await iterator.next(cancellation);
      return first.done ? None : first.value;
    } finally {
      iterator.cancel();
    }
  }
  async single(cancellation? : Cancellation) {
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
    } finally {
      iterator.cancel();
    }
  }
  async trySingle(cancellation? : Cancellation) : Promise<T | None> {
    const iterator = this.exec();
    try {
      const first = await iterator.next(cancellation);
      if (first.done) {
        return None
      }
      const next = await iterator.next(cancellation);
      if (!next.done) {
        throw new Error('sequence contains more than 1 element elements');
      }
      return first.value;
    } finally {
      iterator.cancel();
    }
  }
}

export interface Repository<TData> {
  items: Query<TData>
  update(item: TData, cancellation: Cancellation): Promise<TData>
  insert(item: TData, cancellation: Cancellation): Promise<TData>
  remove(item: TData, cancellation: Cancellation): Promise<void>
}

export interface KeyRepository<TData, TKey> extends Repository<TData> {
  lookup(key: TKey, cancellation: Cancellation): Promise<TData>
}

interface FactoryMap {
  [key: string]: (() => any)|undefined;
}

export class RepositoryStore {
  store: FactoryMap = {};
  register<TData, TKey>(name: string, factory: () => KeyRepository<TData, TKey>) {
    this.store[name] = factory;
  }
  get<T>(name: string): Repository<T>|undefined {
    const factory = this.store[name];
    return factory && factory();
  }
  getRepository<TData, TKey>(name: string): KeyRepository<TData, TKey>|undefined
  {
    const factory = this.store[name];
    return factory && factory();
  }
}

const repositories = new RepositoryStore();

export { repositories };