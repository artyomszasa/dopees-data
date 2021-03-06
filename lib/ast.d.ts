export declare enum BinaryOperation {
    EQ = "eq",
    NEQ = "neq",
    GT = "gt",
    LT = "lt",
    GE = "ge",
    LE = "le",
    OR = "or",
    AND = "and",
    MUL = "mul",
    DIV = "div",
    MOD = "mod",
    ADD = "add",
    SUB = "sub"
}
export declare enum UnaryOperation {
    NOT = "not",
    NEG = "neg",
    IS_NULL = "null"
}
export interface ExprVisitor<T> {
    visitConst(expr: Const): T;
    visitProp(expr: Prop): T;
    visitParam(expr: Param): T;
    visitBinary(expr: BinOp): T;
    visitUnary(expr: UnOp): T;
    visitCall(expr: Call): T;
    visitLambda(expr: Lambda): T;
}
export declare class ConvertVisitor implements ExprVisitor<Expr> {
    visitConst(expr: Const): Expr;
    visitProp(expr: Prop): Expr;
    visitParam(expr: Param): Expr;
    visitBinary(expr: BinOp): Expr;
    visitUnary(expr: UnOp): Expr;
    visitCall(expr: Call): Expr;
    visitLambda(expr: Lambda): Expr;
}
export interface ToStringContext {
    symbolToString(symbol: Symbol): string;
}
export declare abstract class Expr {
    abstract accept<T>(visitor: ExprVisitor<T>): T;
    abstract eq(other: Expr): boolean;
    abstract toString(context?: ToStringContext): string;
}
export declare class Const extends Expr {
    readonly value: string | null;
    constructor(value: string | null);
    accept<T>(visitor: ExprVisitor<T>): T;
    eq(other: Expr): boolean;
    toString(): string;
}
export declare class Prop extends Expr {
    readonly instance: Expr;
    readonly name: string;
    constructor(instance: Expr, name: string);
    accept<T>(visitor: ExprVisitor<T>): T;
    eq(other: Expr): boolean;
    toString(context?: ToStringContext): string;
}
export declare class Param extends Expr {
    readonly name: Symbol;
    constructor(name: Symbol);
    accept<T>(visitor: ExprVisitor<T>): T;
    eq(other: Expr): boolean;
    toString(context?: ToStringContext): string;
}
export declare class BinOp extends Expr {
    private static binOpStrings;
    static unwind(head: Expr, tail: Array<[any, string, any, Expr]>): Expr;
    readonly left: Expr;
    readonly op: BinaryOperation;
    readonly right: Expr;
    constructor(left: Expr, op: BinaryOperation, right: Expr);
    accept<T>(visitor: ExprVisitor<T>): T;
    eq(other: Expr): boolean;
    toString(context?: ToStringContext): string;
}
export declare class UnOp extends Expr {
    private static unOpStrings;
    op: UnaryOperation;
    operand: Expr;
    constructor(op: UnaryOperation, operand: Expr);
    accept<T>(visitor: ExprVisitor<T>): T;
    eq(other: Expr): boolean;
    toString(context?: ToStringContext): string;
}
interface KnownFunctionCalls {
    [name: string]: number[] | number;
}
export declare class Call extends Expr {
    static knownFunctions: KnownFunctionCalls;
    readonly name: string;
    readonly args: Expr[];
    constructor(name: string, args: Expr[]);
    accept<T>(visitor: ExprVisitor<T>): T;
    eq(other: Expr): boolean;
    toString(context?: ToStringContext): string;
}
export declare class Lambda extends Expr {
    readonly body: Expr;
    readonly param: Param;
    constructor(body: Expr, param: Param);
    accept<T>(visitor: ExprVisitor<T>): T;
    eq(other: Expr): boolean;
    toString(context?: ToStringContext): string;
    substituteParameter(target: Param): Lambda;
    and(other: Lambda): Lambda;
}
export declare function substituteParameter(source: Param, target: Param, expression: Expr): Expr;
export {};
