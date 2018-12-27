import { parse as pegParse } from './grammar';
import { Expr } from './ast';

export function parse (raw : string) : Expr {
    return pegParse(raw);
}

export * from './ast';