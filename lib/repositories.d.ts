import * as Q from './protocol';
export declare class CancelledError extends Error {
    constructor();
}
export declare abstract class Cancellation {
    static none: Cancellation;
    abstract cancelled: boolean;
    abstract subscribe(callback: Function): {
        remove(): void;
    };
    throwIfCancelled(): void;
}
export interface None {
}
export declare const None: None;
export interface CancellableAsyncIterator<T> {
    next(cancellation?: Cancellation): Promise<IteratorResult<T>>;
    cancel(): void;
}
export declare class CancellationSource extends Cancellation {
    static link(cancellation1: Cancellation, cancellation2: Cancellation): {
        readonly cancelled: boolean;
    };
    readonly callbacks: Function[];
    cancelled: boolean;
    readonly cancellation: Cancellation;
    cancel(): void;
    subscribe(callback: Function): {
        remove(): void;
    };
}
export declare enum QuerySortDirection {
    Asc = "asc",
    Desc = "desc"
}
export declare abstract class Query<T> {
    abstract exec(): CancellableAsyncIterator<T>;
    abstract filter(predicate: string | Q.Expr): Query<T>;
    abstract skip(n: number): Query<T>;
    abstract take(n: number): Query<T>;
    abstract orderBy(sortBy: string, sortByDirection: QuerySortDirection): Query<T>;
    abstract total(cancellation: Cancellation): Promise<number>;
    forEach(callback: (item: T, index: number) => Promise<any>, cancellation?: Cancellation): Promise<void>;
    toArray(cancellation?: Cancellation): Promise<T[]>;
    first(cancellation?: Cancellation): Promise<T>;
    tryFirst(cancellation?: Cancellation): Promise<T | None>;
    single(cancellation?: Cancellation): Promise<T>;
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
    register<TData, TKey>(name: string, factory: () => KeyRepository<TData, TKey>): void;
    get<T>(name: string): Repository<T> | undefined;
    getRepository<TData, TKey>(name: string): KeyRepository<TData, TKey> | undefined;
}
declare const repositories: RepositoryStore;
export { repositories };
