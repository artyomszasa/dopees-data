import { Query, Repository, QuerySortDirection, KeyRepository } from './repositories';
import * as Q from './protocol';
import { Cancellation } from 'dopees-core/lib/cancellation';
import { HttpClient } from 'dopees-core/lib/http';
interface RestRepositoryOptions {
    type: string;
    endpoint: string;
    keyProperty?: string;
    protocolVersion?: number;
    configuration?: string;
}
export interface V1Query {
    query?: string;
    type?: string;
}
export interface RestRepository<T> extends Repository<T> {
    exec(offset: number, count: number, predicate: string, sortBy?: string, sortByDirection?: QuerySortDirection, query?: V1Query, customOptions?: {
        [key: string]: string | undefined;
    }, cancellation?: Cancellation): AsyncIterable<T>;
    total(predicate: string, query: V1Query | undefined, customOptions: {
        [key: string]: string | undefined;
    }, cancellation: Cancellation): Promise<number>;
}
export declare class KeyRestRepository<TData, TKey> implements KeyRepository<TData, TKey>, RestRepository<TData> {
    readonly clientFactory: () => HttpClient;
    readonly options: RestRepositoryOptions;
    constructor(options: RestRepositoryOptions);
    private readonly collectionEndpoint;
    readonly protocolVersion: number;
    readonly type: string;
    readonly endpoint: string;
    readonly keyProperty: string;
    readonly items: Query<TData>;
    protected getKey(item: TData): TKey;
    private hasKey;
    private itemEndpoint;
    private __getError;
    lookup(key: TKey, cancellation?: Cancellation): Promise<TData>;
    update(item: TData, cancellation?: Cancellation): Promise<TData>;
    insert(item: TData, cancellation: Cancellation): Promise<TData>;
    remove(item: TData, cancellation: Cancellation): Promise<void>;
    total(predicate: string, query: V1Query | undefined, customOptions: {
        [key: string]: string | undefined;
    }, cancellation: Cancellation): Promise<number>;
    exec(offset: number, count: number, predicate: string, sortBy?: string, sortByDirection?: QuerySortDirection, query?: V1Query, customOptions?: {
        [key: string]: string | undefined;
    }, cancellation?: Cancellation): AsyncIterable<TData>;
}
export declare class RestQuery<T> extends Query<T> {
    static defaultCount: number;
    readonly repo: RestRepository<T>;
    readonly offset: number;
    readonly count: number;
    readonly predicate: Q.Lambda | null;
    readonly sortBy: string;
    readonly sortByDirection: QuerySortDirection;
    readonly protocolVersion: number;
    readonly customOptions: {
        [key: string]: string | undefined;
    };
    constructor(repo: RestRepository<T>, offset: number, count: number, predicate?: Q.Lambda | null, sortBy?: string, sortByDirection?: QuerySortDirection, customOptions?: {
        [key: string]: string | undefined;
    }, protocolVersion?: number);
    private escape;
    private applyProtocol;
    private extractV1Query;
    readonly escapedPredicate: string;
    readonly escapedSortBy: string;
    filter(predicate: string | Q.Lambda): RestQuery<T>;
    skip(n: number): Query<T>;
    take(n: number): Query<T>;
    orderBy(selector: string, direction?: QuerySortDirection): Query<T>;
    setCustomOptions(options: {
        [key: string]: string | undefined;
    }, replace?: boolean): Query<T>;
    total(cancellation: Cancellation): Promise<number>;
    exec(): AsyncIterable<T>;
}
export {};
