import { Cancellation, CancellationSource } from 'dopees-core/lib/cancellation';
import * as Q from './protocol';

export class None { }

export const none = new None();

export enum QuerySortDirection {
    Asc = 'asc',
    Desc = 'desc'
}

// ensure asyncIterator is present...
if (!Symbol.asyncIterator) {
  (<any> Symbol).asyncIterator = Symbol('asyncIterator');
}

// POLYFILL --> for await (xx in yy) is not yet supported :(
async function asyncForEach<T>(iterable: AsyncIterable<T>, callback: (item: T) => PromiseLike<T>) {
  // when supported this should be used...
  // for await (const item of iterable) {
  //   await callback(item);
  // }
  const iterator = iterable[Symbol.asyncIterator]();
  let res = await iterator.next();
  while (!res.done) {
    await callback(res.value);
    res = await iterator.next();
  }
}

export abstract class Query<T> {
  abstract exec(cancellation?: Cancellation): AsyncIterable<T>;
  abstract filter(predicate: string|Q.Expr): Query<T>;
  abstract skip(n: number): Query<T>;
  abstract take(n: number): Query<T>;
  abstract orderBy(sortBy: string, sortByDirection: QuerySortDirection): Query<T>;
  abstract setCustomOptions(options: { [key: string]: string|undefined }, replace?: boolean): Query<T>;
  abstract total(cancellation?: Cancellation): Promise<number>;

  async forEach(callback: (item: T, index: number) => Promise<any>, cancellation?: Cancellation) {
    const iterable = this.exec(cancellation);
    let index = 0;
    // FIXME: when implemented replace with "for await"
    await asyncForEach(iterable, (item) => callback(item, index++));
  }

  async toArray(cancellation?: Cancellation) {
    const result = new Array<T>();
    await this.forEach(async (item) => result.push(item), cancellation);
    return result;
  }

  async first(cancellation?: Cancellation) {
    const firstDone = new CancellationSource();
    const iterable = this.exec(cancellation ? CancellationSource.link(firstDone, cancellation) : firstDone);
    // TODO: when implemented replace with the one below
    const iterator = iterable[Symbol.asyncIterator]();
    const res = await iterator.next();
    if (!res.done) {
      firstDone.cancel();
      return res;
    }
    // for await (const item of iterable) {
    //   firstDone.cancel();
    //   return item;
    // }
    throw new Error('sequence contains no elements');
  }

  async tryFirst(cancellation?: Cancellation): Promise<T|None> {
    const firstDone = new CancellationSource();
    const iterable = this.exec(cancellation ? CancellationSource.link(firstDone, cancellation) : firstDone);
    // TODO: when implemented replace with the one below
    const iterator = iterable[Symbol.asyncIterator]();
    const res = await iterator.next();
    if (!res.done) {
      firstDone.cancel();
      return res;
    }
    // for await (const item of iterable) {
    //   firstDone.cancel();
    //   return item;
    // }
    return none;
  }

  async single(cancellation?: Cancellation) {
    let result: None|T = none;
    const iterable = this.exec(cancellation);
    // TODO: when implemented replace with the one below
    const iterator = iterable[Symbol.asyncIterator]();
    let res = await iterator.next();
    if (!res.done) {
      result = res.value;
    } else {
      throw new Error('sequence contains no elements');
    }
    res = await iterator.next();
    if (!res.done) {
      throw new Error('sequence contains more than 1 element elements');
    }
    // for await (const item of iterable) {
    //   if (none !== result) {
    //     throw new Error('sequence contains more than 1 element elements');
    //   } else {
    //     result = item;
    //   }
    // }
    // if (none === result) {
    //   throw new Error('sequence contains no elements');
    // }
    return result;
  }
  async trySingle(cancellation?: Cancellation): Promise<T|None> {
    let result: None|T = none;
    const iterable = this.exec(cancellation);
    // TODO: when implemented replace with the one below
    const iterator = iterable[Symbol.asyncIterator]();
    let res = await iterator.next();
    if (!res.done) {
      result = res.value;
    } else {
      return none;
    }
    res = await iterator.next();
    if (!res.done) {
      throw new Error('sequence contains more than 1 element elements');
    }
    // for await (const item of iterable) {
    //   if (none !== result) {
    //     throw new Error('sequence contains more than 1 element elements');
    //   } else {
    //     result = item;
    //   }
    // }
    return result;
  }
}

export interface Repository<TData> {
  items: Query<TData>;
  update(item: TData, cancellation: Cancellation): Promise<TData>;
  insert(item: TData, cancellation: Cancellation): Promise<TData>;
  remove(item: TData, cancellation: Cancellation): Promise<void>;
}

export interface KeyRepository<TData, TKey> extends Repository<TData> {
  lookup(key: TKey, cancellation: Cancellation): Promise<TData>;
}

interface FactoryMap {
  [key: string]: (() => any)|undefined;
}

export class RepositoryStore {
  store: FactoryMap = {};
  __get(name: string) {
    const factory = this.store[name];
    if (!factory) {
      throw new Error(`no repository has been registered for ${name}`);
    }
    return factory();
  }
  register<TData, TKey>(name: string, factory: () => KeyRepository<TData, TKey>) {
    this.store[name] = factory;
  }
  get<T>(name: string): Repository<T> { return this.__get(name); }
  getRepository<TData, TKey>(name: string): KeyRepository<TData, TKey> { return this.__get(name); }
}

export const repositories = new RepositoryStore();
