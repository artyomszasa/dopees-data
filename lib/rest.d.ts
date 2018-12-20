import { Query, Repository, CancellableAsyncIterator, QuerySortDirection, KeyRepository, Cancellation } from "./repositories";
interface RestRepositoryOptions {
    type: string;
    endpoint: string;
    keyProperty?: string;
    protocolVersion?: number;
}
export interface RestRepository<T> extends Repository<T> {
    exec(offset: number, count: number, predicate: string, sortBy?: string, sortByDirection?: QuerySortDirection): CancellableAsyncIterator<T>;
    total(predicate: string, cancellation: Cancellation): Promise<number>;
}
export declare class KeyRestRepository<TData, TKey> implements KeyRepository<TData, TKey>, RestRepository<TData> {
    readonly options: RestRepositoryOptions;
    constructor(options: RestRepositoryOptions);
    private readonly collectionEndpoint;
    readonly protocolVersion: number;
    readonly type: string;
    readonly endpoint: string;
    readonly keyProperty: string;
    readonly items: Query<TData>;
    private getKey;
    private hasKey;
    private itemEndpoint;
    private __getErrors;
    lookup(key: TKey, cancellation?: Cancellation): Promise<TData>;
    update(item: TData, cancellation?: Cancellation): Promise<TData>;
    insert(item: TData, cancellation: Cancellation): Promise<TData>;
    remove(item: TData, cancellation: Cancellation): Promise<void>;
    total(predicate: string, cancellation: Cancellation): Promise<number>;
    exec(offset: number, count: number, predicate: string, sortBy?: string, sortByDirection?: QuerySortDirection): CancellableAsyncIterator<TData>;
}
export {};
