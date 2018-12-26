import { generate as generateParser } from 'pegjs/index';

const grammar =
    [ 'Lambda = source:Ident _ Arrow _ expr:Expr {return new dope.Q.Lambda(expr,new dope.Q.Param(source));}',
        'Ident = [a-zA-Z][a-zA-Z0-9]* {return text();}',
        'Arrow = "=>"',

        'Atom = Call/Var/NotExpr/Parens/NegExpr/IsNullExpr/CInt/CString',

        'ExprLvl0 = head:Atom tail:(_? op:(Mul/Div/Mod) _? expr:Atom)* { return dope.Q.BinExpr.unwind(head, tail); }',
        'ExprLvl1 = head:ExprLvl0 tail:(_? op:(Add/Sub) _? expr:ExprLvl0)* { return dope.Q.BinExpr.unwind(head, tail); }',
        'ExprLvl2 = head:ExprLvl1 tail:(_? op:(Eq/Neq/Gt/Lt/Ge/Le) _? expr:ExprLvl1)* { return dope.Q.BinExpr.unwind(head, tail); }',
        'ExprLvl3 = head:ExprLvl2 tail:(_? op:(And/Or) _? expr:ExprLvl2)* { return dope.Q.BinExpr.unwind(head, tail); }',

        // 'ExprPrefix = Var/NotExpr/Parens/NegExpr/IsNullExpr/Call/CInt/CString',
        // 'Expr = left:ExprPrefix opt:(_ Op _ Expr)? {return((left && opt && opt.length > 0)?new dope.Q.BinExpr(left,opt[1],opt[3]):left);}',
        'Expr = expr:ExprLvl3 { return expr; }',
        'Parens = "(" e:Expr ")" {return e;}',
        'NegExpr = "neg(" e:Expr ")" {return dope.Q.UnExpr(dope.Q.unOps.NEG,e);}',
        'IsNullExpr = "isNull(" e:Expr ")" {return dope.Q.UnExpr(dope.Q.unOps.IS_NULL,e);}',
        'Call = name0:[a-zA-Z]name:[a-zA-Z0-9]* "(" arg1:Expr args:(_? "," _? Expr)* ")" { return new dope.Q.Call([name0].concat(name).join(\'\'),[arg1].concat(args.map(arg => arg[3]))); }',
        'NotExpr = "!" arg:Expr {return new dope.Q.UnExpr(dope.Q.unOps.NOT,arg);}',
        'Var = x:(Ident ("." Ident)*) {var prop=new dope.Q.Param(x[0]);for(var index=0;index<x[1].length;index=index+1){prop=new dope.Q.Prop(prop,x[1][index][1]);}return prop;}',
        'Op = x:(Eq/Neq/Gt/Lt/Ge/Le/Or/And) {return x;}',
        'Or = "||" {return dope.Q.binOps.OR;}',
        'And = "&&" {return dope.Q.binOps.AND;}',
        'Eq = "=" {return dope.Q.binOps.EQ;}',
        'Neq = "!=" {return dope.Q.binOps.NEQ;}',
        'Gt = ">" {return dope.Q.binOps.GT;}',
        'Lt = "<" {return dope.Q.binOps.LT;}',
        'Ge = ">=" {return dope.Q.binOps.GE;}',
        'Le = "<=" {return dope.Q.binOps.LE;}',
        'Mul = "*" {return dope.Q.binOps.MUL;}',
        'Div = "/" {return dope.Q.binOps.DIV;}',
        'Mod = "<=" {return dope.Q.binOps.MOD;}',
        'Add = "+" {return dope.Q.binOps.ADD;}',
        'Sub = "-" {return dope.Q.binOps.SUB;}',
        'CInt = [0-9]+ {return new dope.Q.Const(text());}',
        'CString = "\\"" ([^"] / "\\\\" "\\"")* "\\"" {return new dope.Q.Const(JSON.parse(text()));}',
        '_ "whitespace"  = [ \\t\\n\\r]*' ].join("\n");

const parser = generateParser(grammar);

export enum BinaryOperation {
    EQ = 'eq',
    NEQ = 'neq',
    GT = 'gt',
    LT = 'lt',
    GE = 'ge',
    LE = 'le',
    OR = 'or',
    AND = 'and',
    MUL = 'mul',
    DIV = 'div',
    MOD = 'mod',
    ADD = 'add',
    SUB = 'sub'
}

export enum UnaryOperation {
    NOT = 'not',
    NEG = 'neg',
    IS_NULL = 'null'
}

export interface ExprVisitor<T> {
    visitConst(expr: Const): T
    visitProp(expr: Prop) : T
    visitParam(expr: Param) : T
    visitBinary(expr: BinOp) : T
    visitUnary(expr: UnOp) : T
    visitCall(expr: Call) : T
    visitLambda(expr: Lambda) : T
}

export class ConvertVisitor implements ExprVisitor<Expr> {
    visitConst(expr: Const): Expr {
        return expr;
    }
    visitProp(expr: Prop): Expr {
        return new Prop(expr.instance.accept(this), expr.name);
    }
    visitParam(expr: Param): Expr {
        return expr;
    }
    visitBinary(expr: BinOp): Expr {
        return new BinOp(expr.left.accept(this), expr.op, expr.right.accept(this));
    }
    visitUnary(expr: UnOp): Expr {
        return new UnOp(expr.op, expr.operand.accept(this));
    }
    visitCall(expr: Call): Expr {
        return new Call(expr.name, expr.args.map(e => e.accept(this)));
    }
    visitLambda(expr: Lambda): Expr {
        return new Lambda(expr.body.accept(this), expr.param);
    }
}

export abstract class Expr {
    abstract accept<T>(visitor : ExprVisitor<T>) : T
    abstract eq(other : Expr) : boolean
    abstract toString() : string
}

export class Const extends Expr {
    value : string|null
    constructor(value : string|null) {
        super();
        this.value = value;
    }
    accept<T>(visitor : ExprVisitor<T>) { return visitor.visitConst(this); }
    eq(other : Expr) : boolean { return other instanceof Const && other.value === this.value; }
    toString() { return JSON.stringify(this.value); }
}

export class Prop extends Expr {
    instance : Expr
    name : string
    constructor(instance : Expr, name : string) {
        super();
        this.instance = instance;
        this.name = name;
    }
    accept<T>(visitor : ExprVisitor<T>) { return visitor.visitProp(this); }
    eq(other : Expr) : boolean { return other instanceof Prop && other.instance.eq(this.instance) && other.name === this.name; }
    toString() { return `${this.instance.toString()}.${this.name}`; }
}

export class Param extends Expr {
    name : Symbol
    constructor(name : Symbol) {
        super();
        this.name = name;
    }
    accept<T>(visitor : ExprVisitor<T>) { return visitor.visitParam(this); }
    eq(other : Expr) : boolean { return other instanceof Param && other.name === this.name; }
    toString() { return this.name.toString(); }
}

export class BinOp extends Expr {
    private static binOpStrings = {
        [BinaryOperation.EQ]: '=',
        [BinaryOperation.NEQ]: '!=',
        [BinaryOperation.GT]: '>',
        [BinaryOperation.LT]: '<',
        [BinaryOperation.LE]: '>=',
        [BinaryOperation.GE]: '<=',
        [BinaryOperation.OR]: '||',
        [BinaryOperation.AND]: '&&',
        [BinaryOperation.MUL]: '*',
        [BinaryOperation.DIV]: '/',
        [BinaryOperation.MOD]: '%',
        [BinaryOperation.ADD]: '+',
        [BinaryOperation.SUB]: '-'
    }
    static unwind (head : Expr, tail : Array<Array<any>>) {
        if (!tail || !tail.length) {
            return head;
        }
        return tail.reduce((left, vals) => {
            const op = vals[1];
            const right = vals[3];
            return new BinOp(left, op, right);
        }, head);
    }
    left : Expr
    op : BinaryOperation
    right : Expr
    constructor (left : Expr, op : BinaryOperation, right : Expr) {
        super();
        this.left = left;
        this.op = op;
        this.right = right;
    }
    accept<T>(visitor : ExprVisitor<T>) { return visitor.visitBinary(this); }
    eq(other : Expr) : boolean {
        return other instanceof BinOp && other.op === this.op && other.left.eq(this.left) && other.right.eq(this.right);
    }
    toString() {
        return `(${this.left.toString()} ${BinOp.binOpStrings[this.op]} ${this.right.toString()})`;
    }
}

export class UnOp extends Expr {
    private static unOpStrings = {
        [UnaryOperation.NOT]: 'not',
        [UnaryOperation.NEG]: 'neg',
        [UnaryOperation.IS_NULL]: 'isNull'
    }
    op: UnaryOperation
    operand: Expr
    constructor(op : UnaryOperation, operand: Expr) {
        super();
        this.op = op;
        this.operand = operand;
    }
    accept<T>(visitor : ExprVisitor<T>) { return visitor.visitUnary(this); }
    eq(other : Expr) : boolean {
        return other instanceof UnOp && other.op === this.op && other.operand.eq(this.operand);
    }
    toString() {
        if (this.op === UnaryOperation.NOT) {
            return `!(${this.operand})`;
        }
        return `${UnOp.unOpStrings[this.op]}(${this.operand})`;
    }
}

interface KnownFunctionCalls {
    [name : string] : Array<number> | number
}

export class Call extends Expr {
    static knownFunctions: KnownFunctionCalls = {
        contains: 2,
        substring: [2, 3]
    }
    name: string
    args: Array<Expr>
    constructor(name: string, args : Array<Expr>) {
        super();
        if (Call.knownFunctions[name]) {
            const argCount = Call.knownFunctions[name];
            if ('number' === typeof argCount) {
                if (argCount !== args.length) {
                    throw new Error(`invalid argument count for ${name}: ${args.length}, accepted argument count: ${argCount}`);
                }
            } else {
                if (-1 === argCount.indexOf(args.length)) {
                    throw new Error(`invalid argument count for ${name}: ${args.length}, accepted argument counts: ${argCount.join(',')}`);
                }
            }
        }
        this.name = name;
        this.args = args;
    }
    accept<T>(visitor: ExprVisitor<T>) { return visitor.visitCall(this); }
    eq(other: Expr) {
        if (!(other instanceof Call)) {
            return false;
        }
        if (other.name !== this.name) {
            return false;
        }
        if (other.args.length !== this.args.length) {
            return false;
        }
        for (let i = 0; i < other.args.length; i = i + 1) {
            if (!other.args[i].eq(this.args[i])) {
                return false;
            }
        }
        return true;
    }
    toString() {
        return `${this.name}(${this.args.map(arg => arg.toString()).join(',')})`;
    }
}

export class Lambda extends Expr {
    body: Expr
    param: Param
    constructor(body: Expr, param: Param) {
        super();
        this.body = body;
        this.param = param;
    }
    accept<T>(visitor: ExprVisitor<T>) { return visitor.visitLambda(this); }
    eq(other: Expr) {
        if (!(other instanceof Lambda)) {
            return false;
        }
        throw new Error('Lambda equality is not implemented!');
    }
    toString() { return `${this.param} => ${this.body}`; }
    substituteParameter(target: Param) {
        return new Lambda(substituteParameter(this.param, target, this.body), target);
    }
    and(other: Lambda) {
        if (this.param.eq(other.param)) {
            return new Lambda(new BinOp(this.body, BinaryOperation.AND, other.body), this.param);
        }
        return new Lambda(new BinOp(this.body, BinaryOperation.AND, other.substituteParameter(this.param).body), this.param);
    }
}

export function parse (raw : string) : Expr {
    return parser.parse(raw);
}

export function substituteParameter (source: Param, target: Param, expression: Expr) {
    const visitor = new class extends ConvertVisitor {
        visitParam(p: Param) { return p.eq(source) ? target : p; }
    }
    return expression.accept(visitor);
}