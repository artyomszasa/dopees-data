import { Cancellation } from 'dopees-core/lib/cancellation';
import * as Q from './protocol';
export declare class None {
}
export declare const none: None;
export declare enum QuerySortDirection {
    Asc = "asc",
    Desc = "desc"
}
export declare abstract class Query<T> {
    abstract exec(cancellation?: Cancellation): AsyncIterable<T>;
    abstract filter(predicate: string | Q.Expr): Query<T>;
    abstract skip(n: number): Query<T>;
    abstract take(n: number): Query<T>;
    abstract orderBy(sortBy: string, sortByDirection: QuerySortDirection): Query<T>;
    abstract setCustomOptions(options: {
        [key: string]: string | undefined;
    }, replace?: boolean): Query<T>;
    abstract total(cancellation?: Cancellation): Promise<number>;
    forEach(callback: (item: T, index: number) => Promise<any>, cancellation?: Cancellation): Promise<void>;
    toArray(cancellation?: Cancellation): Promise<T[]>;
    first(cancellation?: Cancellation): Promise<IteratorResult<T>>;
    tryFirst(cancellation?: Cancellation): Promise<T | None>;
    single(cancellation?: Cancellation): Promise<None | T>;
    trySingle(cancellation?: Cancellation): Promise<T | None>;
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
    [key: string]: (() => any) | undefined;
}
export declare class RepositoryStore {
    store: FactoryMap;
    __get(name: string): any;
    register<TData, TKey>(name: string, factory: () => KeyRepository<TData, TKey>): void;
    get<T>(name: string): Repository<T>;
    getRepository<TData, TKey>(name: string): KeyRepository<TData, TKey>;
}
export declare const repositories: RepositoryStore;
export {};
