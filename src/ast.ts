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
  visitConst(expr: Const): T;
  visitProp(expr: Prop): T;
  visitParam(expr: Param): T;
  visitBinary(expr: BinOp): T;
  visitUnary(expr: UnOp): T;
  visitCall(expr: Call): T;
  visitLambda(expr: Lambda): T;
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
      return new Call(expr.name, expr.args.map((e) => e.accept(this)));
  }
  visitLambda(expr: Lambda): Expr {
      return new Lambda(expr.body.accept(this), expr.param);
  }
}

export interface ToStringContext {
  symbolToString(symbol: Symbol): string;
}

const emptyContext = (): ToStringContext => {
  const keys: Symbol[] = [];
  const names: string[] = [];
  let next = 0;
  return {
    symbolToString(symbol: Symbol) {
      const index = keys.indexOf(symbol);
      if (-1 !== index) {
        return names[index];
      }
      const name = `e${++next}`;
      keys.push(symbol);
      names.push(name);
      return name;
    }
  };
};

export abstract class Expr {
  abstract accept<T>(visitor: ExprVisitor<T>): T;
  abstract eq(other: Expr): boolean;
  abstract toString(context?: ToStringContext): string;
}

export class Const extends Expr {
  readonly value: string|null;

  constructor(value: string|null) {
      super();
      this.value = value;
  }

  accept<T>(visitor: ExprVisitor<T>) {
    return visitor.visitConst(this);
  }

  eq(other: Expr): boolean {
    return other instanceof Const && other.value === this.value;
  }

  toString() {
    return JSON.stringify(this.value);
  }
}

export class Prop extends Expr {
  readonly instance: Expr;
  readonly name: string;

  constructor(instance: Expr, name: string) {
      super();
      this.instance = instance;
      this.name = name;
  }

  accept<T>(visitor: ExprVisitor<T>) {
    return visitor.visitProp(this);
  }

  eq(other: Expr): boolean {
    return other instanceof Prop && other.instance.eq(this.instance) && other.name === this.name;
  }

  toString(context?: ToStringContext) {
    const ctx = context || emptyContext();
    return `${this.instance.toString(ctx)}.${this.name}`;
  }
}

export class Param extends Expr {
  readonly name: Symbol;
  constructor(name: Symbol) {
      super();
      this.name = name;
  }
  accept<T>(visitor: ExprVisitor<T>) {
    return visitor.visitParam(this);
  }

  eq(other: Expr): boolean {
    return other instanceof Param && other.name === this.name;
  }

  toString(context?: ToStringContext) {
    // in protocol v1 param may be string...
    if ('string' === typeof this.name) {
        return this.name;
    }
    const ctx = context || emptyContext();
    return ctx.symbolToString(this.name);
  }
}

export class BinOp extends Expr {
  private static binOpStrings = {
      [BinaryOperation.EQ]: '=',
      [BinaryOperation.NEQ]: '!=',
      [BinaryOperation.GT]: '>',
      [BinaryOperation.LT]: '<',
      [BinaryOperation.LE]: '<=',
      [BinaryOperation.GE]: '>=',
      [BinaryOperation.OR]: '||',
      [BinaryOperation.AND]: '&&',
      [BinaryOperation.MUL]: '*',
      [BinaryOperation.DIV]: '/',
      [BinaryOperation.MOD]: '%',
      [BinaryOperation.ADD]: '+',
      [BinaryOperation.SUB]: '-'
  };

  static unwind(head: Expr, tail: Array<[any, string, any, Expr]>) {
    if (!tail || !tail.length) {
      return head;
    }
    return tail.reduce((left, vals) => {
      const op = vals[1];
      const right = vals[3];
      return new BinOp(left, <BinaryOperation> op, right);
    }, head);
  }

  readonly left: Expr;
  readonly op: BinaryOperation;
  readonly right: Expr;

  constructor(left: Expr, op: BinaryOperation, right: Expr) {
    super();
    this.left = left;
    this.op = op;
    this.right = right;
  }

  accept<T>(visitor: ExprVisitor<T>) {
    return visitor.visitBinary(this);
  }

  eq(other: Expr): boolean {
    return other instanceof BinOp && other.op === this.op && other.left.eq(this.left) && other.right.eq(this.right);
  }
  toString(context?: ToStringContext) {
    const ctx = context || emptyContext();
    return `(${this.left.toString(ctx)} ${BinOp.binOpStrings[this.op]} ${this.right.toString(ctx)})`;
  }
}

export class UnOp extends Expr {
  private static unOpStrings = {
      [UnaryOperation.NOT]: 'not',
      [UnaryOperation.NEG]: 'neg',
      [UnaryOperation.IS_NULL]: 'isNull'
  };

  op: UnaryOperation;
  operand: Expr;

  constructor(op: UnaryOperation, operand: Expr) {
      super();
      this.op = op;
      this.operand = operand;
  }

  accept<T>(visitor: ExprVisitor<T>) {
    return visitor.visitUnary(this);
  }

  eq(other: Expr): boolean {
    return other instanceof UnOp && other.op === this.op && other.operand.eq(this.operand);
  }

  toString(context?: ToStringContext) {
    const ctx = context || emptyContext();
    if (this.op === UnaryOperation.NOT) {
      return `!(${this.operand.toString(ctx)})`;
    }
    return `${UnOp.unOpStrings[this.op]}(${this.operand.toString(ctx)})`;
  }
}

interface KnownFunctionCalls {
  [name: string]: number[]|number;
}

export class Call extends Expr {
  static knownFunctions: KnownFunctionCalls = {
      contains: 2,
      substring: [2, 3]
  };

  readonly name: string;
  readonly args: Expr[];

  constructor(name: string, args: Expr[]) {
    super();
    if (Call.knownFunctions[name]) {
      const argCount = Call.knownFunctions[name];
      if ('number' === typeof argCount) {
        if (argCount !== args.length) {
          throw new Error(`invalid argument count for ${name}: ${args.length}, accepted argument count: ${argCount}`);
        }
      } else {
        if (-1 === argCount.indexOf(args.length)) {
          // tslint:disable-next-line:max-line-length
          throw new Error(`invalid argument count for ${name}: ${args.length}, accepted argument counts: ${argCount.join(',')}`);
        }
      }
    }
    this.name = name;
    this.args = args;
  }

  accept<T>(visitor: ExprVisitor<T>) {
    return visitor.visitCall(this);
  }

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

  toString(context?: ToStringContext) {
    const ctx = context || emptyContext();
    return `${this.name}(${this.args.map((arg) => arg.toString(ctx)).join(',')})`;
  }
}

export class Lambda extends Expr {
  readonly body: Expr;
  readonly param: Param;

  constructor(body: Expr, param: Param) {
      super();
      this.body = body;
      this.param = param;
  }

  accept<T>(visitor: ExprVisitor<T>) {
    return visitor.visitLambda(this);
  }

  eq(other: Expr) {
      if (!(other instanceof Lambda)) {
          return false;
      }
      throw new Error('Lambda equality is not implemented!');
  }

  toString(context?: ToStringContext) {
    const ctx = context || emptyContext();
    return `${this.param.toString(ctx)} => ${this.body.toString(ctx)}`;
  }

  substituteParameter(target: Param) {
      return new Lambda(substituteParameter(this.param, target, this.body), target);
  }

  and(other: Lambda) {
    if (this.param.eq(other.param)) {
      return new Lambda(new BinOp(this.body, BinaryOperation.AND, other.body), this.param);
    }
    return new Lambda(
      new BinOp(this.body, BinaryOperation.AND, other.substituteParameter(this.param).body),
      this.param
    );
  }
}

// export function parse (raw : string) : Expr {
//   return parser.parse(raw);
// }

export function substituteParameter(source: Param, target: Param, expression: Expr) {
  const visitor = new (class extends ConvertVisitor {
    visitParam(p: Param) { return p.eq(source) ? target : p; }
  })();
  return expression.accept(visitor);
}
