import { Query, Repository, CancellableAsyncIterator, QuerySortDirection, KeyRepository, Cancellation } from "./repositories"
import * as Q from './protocol'
import { decoratedFetch as fetch } from 'dopees-core/lib/fetch';
import * as utf8 from 'dopees-core/lib/utf8';


const checkNum = (n: number, message: string) => {
  if (n % 1 !== 0 || n <= 0) {
    throw new TypeError(message);
  }
}

interface RestRepositoryOptions {
  type: string;
  endpoint: string;
  keyProperty?: string;
  protocolVersion?: number;
}

const supportsAbortController = (function () {
  if ((window as any).AbortController) {
    return true;
  }
  return false;
}());

interface Abortion {
  signal: AbortSignal|undefined
  subscription: { remove(): void }
}

function linkAbortion(cancellation?: Cancellation): Abortion {
  let signal: AbortSignal|undefined;
  let subscription: { remove(): void };
  if (undefined !== cancellation && supportsAbortController) {
    const abortController = new AbortController();
    signal = abortController.signal;
    subscription = cancellation.subscribe(() => abortController.abort());
  } else {
    signal = undefined;
    subscription = { remove() { } };
  }
  return { signal, subscription };
}

export interface V1Query {
  query?: string,
  type?: string
}

export interface RestRepository<T> extends Repository<T> {
  exec(offset: number, count: number, predicate: string, sortBy?: string, sortByDirection?: QuerySortDirection, query?: V1Query): CancellableAsyncIterator<T>;
  total(predicate: string, query: V1Query|undefined, cancellation: Cancellation): Promise<number>;
}

export class KeyRestRepository<TData, TKey> implements KeyRepository<TData, TKey>, RestRepository<TData> {
  readonly options : RestRepositoryOptions
  constructor(options: RestRepositoryOptions) {
    this.options = options;
  }
  private get collectionEndpoint () {
    return `${this.endpoint}/${this.type}`;
  }
  get protocolVersion () {
    return this.options.protocolVersion || 2;
  }
  get type () {
    return this.options.type;
  }
  get endpoint () {
    return this.options.endpoint;
  }
  get keyProperty () {
    return this.options.keyProperty || 'id';
  }
  get items(): Query<TData> {
    return new RestQuery<TData>(this, 0, RestQuery.defaultCount, null, undefined, undefined, this.options.protocolVersion);
  }
  private getKey(item: TData) {
    return (item as any)[this.keyProperty] as TKey;
  }
  private hasKey(item: TData) {
    return !!this.getKey(item);
  }
  private itemEndpoint(item: TData) {
    return `${this.endpoint}/${this.type}/${this.getKey(item)}`;
  }
  private __getErrors (response: Response) {
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
  async lookup(key: TKey, cancellation?: Cancellation): Promise<TData> {
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
    } finally {
      abortion.subscription.remove();
    }
  }
  async update(item: TData, cancellation?: Cancellation): Promise<TData> {
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
    } finally {
      abortion.subscription.remove();
    }
  }
  async insert(item: TData, cancellation: Cancellation): Promise<TData> {
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
          })
          if (resp.ok) {
            return await resp.json();
          }
          throw this.__getErrors(resp);
        } finally {
          lookupAbortion.subscription.remove();
        }
      }
      throw this.__getErrors(response);
    } finally {
      abortion.subscription.remove();
    }
  }
  remove(item: TData, cancellation: Cancellation): Promise<void> {
    throw new Error("Method not implemented.");
  }
  async total(predicate: string, query: V1Query|undefined, cancellation: Cancellation): Promise<number> {
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
      } else {
        throw new Error(`Hiba lépett fel adatok lekérdezése közben: ${response.statusText}`);
      }
    } finally {
      abortion.subscription.remove();
    }
  }
  exec(offset: number, count: number, predicate: string, sortBy?: string, sortByDirection?: QuerySortDirection, query?: V1Query): CancellableAsyncIterator<TData> {
    const repo = this;
    let error : any = null;
    let items : TData[]|null = null;
    let index = 0;
    return {
      async next(cancellation?: Cancellation): Promise<IteratorResult<TData>> {
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
            } else {
              error = new Error(`Hiba lépett fel adatok lekérdezése közben: ${response.statusText}`);
              throw error;
            }
          } finally {
            abortion.subscription.remove();
          }
        }
        if (!items) {
          throw new Error('should never happen');
        }
        if (index >= items.length) {
          return { done: true, value: <TData><unknown>undefined }
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
    }
  }
}

const regex = /[\0-\x08\n-\x1F\x7F-\uFFFF]/g;

class RestQuery<T> extends Query<T> {
  static defaultCount = 100000;
  readonly repo: RestRepository<T>;
  readonly offset: number;
  readonly count: number;
  readonly predicate: Q.Lambda|null;
  readonly sortBy: string;
  readonly sortByDirection: QuerySortDirection;
  readonly protocolVersion: number;
  constructor (repo: RestRepository<T>, offset: number, count: number, predicate?: Q.Lambda|null, sortBy?: string, sortByDirection?: QuerySortDirection, protocolVersion?: number) {
    super();
    this.repo = repo;
    this.offset = offset || 0;
    this.count = 0 === count ? count : (count || RestQuery.defaultCount);
    this.predicate = predicate || null;
    this.sortBy = sortBy || '';
    this.sortByDirection = sortByDirection || QuerySortDirection.Asc;
    this.protocolVersion = protocolVersion || 2;
  }
  private escape (input: string|Q.Expr|null) {
    if (!input) {
      return '';
    }
    const inp = input instanceof Q.Expr ? this.applyProtocol(input).toString() : input;
    return utf8.utf8encode(inp).replace(regex, m => '%' + ('0' + m.charCodeAt(0).toString(16).toUpperCase()).slice(-2));
  }

  private applyProtocol(expr: Q.Expr) {
    if (this.protocolVersion < 2 && expr instanceof Q.Lambda) {
      const param = expr.param;
      return expr.body.accept<Q.Expr>({
        visitConst(c) { return c; },
        visitParam(p) { return p; },
        visitProp(p) { return p.instance.eq(param) ? new Q.Param(<any> p.name) : new Q.Prop(p.instance.accept(this), p.name); },
        visitBinary(b) { return new Q.BinOp(b.left.accept(this), b.op, b.right.accept(this)); },
        visitUnary(u) { return new Q.UnOp(u.op, u.operand.accept(this)); },
        visitCall(c) { return new Q.Call(c.name, c.args.map(arg => arg.accept(this))); },
        visitLambda(l) { return new Q.Lambda(l.body.accept(this), l.param); }
      })
    }
    return expr;
  }

  private extractV1Query(expr: Q.Expr) {
    const q: { query?: string } = {};
    const v1Expr = expr.accept<Q.Expr>({
      visitConst(c) { return c; },
      visitParam(p) { return p; },
      visitProp(p) { return new Q.Prop(p.instance.accept(this), p.name); },
      visitBinary(b) {
        const l = b.left.accept(this);
        const r = b.right.accept(this);
        if (l instanceof Q.Const && (<any> l.value === true || <any> l.value === 'true')) {
            return r;
        }
        if (r instanceof Q.Const && (<any> r.value === true || <any> r.value === 'true')) {
            return l;
        }
        return new Q.BinOp(l, b.op, r);
      },
      visitUnary(u) { return new Q.UnOp(u.op, u.operand.accept(this)); },
      visitCall (c) {
        if ('partialMatch' === c.name && 2 === c.args.length) {
          const arg = c.args[1];
          if (arg instanceof Q.Const && arg.value) {
            q.query = arg.value;
            return new Q.Const(<any> true);
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

  get escapedPredicate () {
    return this.escape(this.predicate);
  }
  get escapedSortBy () {
    return this.escape(this.sortBy);
  }
  filter (predicate: string|Q.Lambda): Query<T> {
    const p = 'string' === typeof predicate ? Q.parse(predicate) : predicate;
    if (!(p instanceof Q.Lambda)) {
      throw TypeError('predicate must be a lambda expression');
    }
    return new RestQuery<T>(
      this.repo,
      this.offset,
      this.count,
      this.predicate ? this.predicate.and(p) : p,
      this.sortBy,
      this.sortByDirection,
      this.protocolVersion
    );
  }
  skip(n: number): Query<T> {
    if (0 === n) {
      return this;
    }
    checkNum(n, 'skip parameter must be non-negative whole number.');
    return new RestQuery<T>(
      this.repo,
      n, // TODO: Ezt végig kell gondolni, mert lehet (this.offset + n) kellene ide?
      this.count,
      this.predicate,
      this.sortBy,
      this.sortByDirection,
      this.protocolVersion
    );
  }
  take(n: number): Query<T> {
    checkNum(n, 'take parameter must be non-negative whole number.');
    return new RestQuery<T>(
      this.repo,
      this.offset,
      n,
      this.predicate,
      this.sortBy,
      this.sortByDirection,
      this.protocolVersion);
  }
  orderBy(selector: string, direction?: QuerySortDirection): Query<T> {
    return new RestQuery<T>(
      this.repo,
      this.offset,
      this.count,
      this.predicate,
      selector,
      direction || QuerySortDirection.Asc,
      this.protocolVersion);
  }
  async total(cancellation: Cancellation): Promise<number> {
    let predicate: string;
    let v1Query: V1Query|undefined;
    if (!this.predicate) {
      predicate = '';
    } else {
      if (this.protocolVersion < 2) {
        const data = this.extractV1Query(this.predicate);
        predicate = this.escape(data.expr);
        v1Query = data.query;
        if (predicate && predicate.startsWith('(') && predicate.endsWith(')')) {
          predicate = predicate.substr(1, predicate.length - 2);
        }
      } else {
        predicate = this.escape(this.predicate);
      }
    }
    return this.repo.total(predicate, v1Query, cancellation);
  }
  exec(): CancellableAsyncIterator<T> {
    let predicate: string;
    let v1Query: V1Query|undefined;
    if (!this.predicate) {
      predicate = '';
    } else {
      if (this.protocolVersion < 2) {
        const data = this.extractV1Query(this.predicate);
        predicate = this.escape(data.expr);
        v1Query = data.query;
        if (predicate && predicate.startsWith('(') && predicate.endsWith(')')) {
          predicate = predicate.substr(1, predicate.length - 2);
        }
      } else {
        predicate = this.escape(this.predicate);
      }
    }
    return this.repo.exec(this.offset, this.count, predicate, this.sortBy, this.sortByDirection, v1Query);
  }
};