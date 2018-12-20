import { generate as generateParser } from 'pegjs';
const grammar = ['Lambda = source:Ident _ Arrow _ expr:Expr {return new dope.Q.Lambda(expr,new dope.Q.Param(source));}',
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
    '_ "whitespace"  = [ \\t\\n\\r]*'].join("\n");
const parser = generateParser(grammar);
export var BinaryOperation;
(function (BinaryOperation) {
    BinaryOperation["EQ"] = "eq";
    BinaryOperation["NEQ"] = "neq";
    BinaryOperation["GT"] = "gt";
    BinaryOperation["LT"] = "lt";
    BinaryOperation["GE"] = "ge";
    BinaryOperation["LE"] = "le";
    BinaryOperation["OR"] = "or";
    BinaryOperation["AND"] = "and";
    BinaryOperation["MUL"] = "mul";
    BinaryOperation["DIV"] = "div";
    BinaryOperation["MOD"] = "mod";
    BinaryOperation["ADD"] = "add";
    BinaryOperation["SUB"] = "sub";
})(BinaryOperation || (BinaryOperation = {}));
export var UnaryOperation;
(function (UnaryOperation) {
    UnaryOperation["NOT"] = "not";
    UnaryOperation["NEG"] = "neg";
    UnaryOperation["IS_NULL"] = "null";
})(UnaryOperation || (UnaryOperation = {}));
export class ConvertVisitor {
    visitConst(expr) {
        return expr;
    }
    visitProp(expr) {
        return new Prop(expr.instance.accept(this), expr.name);
    }
    visitParam(expr) {
        return expr;
    }
    visitBinary(expr) {
        return new BinOp(expr.left.accept(this), expr.op, expr.right.accept(this));
    }
    visitUnary(expr) {
        return new UnOp(expr.op, expr.operand.accept(this));
    }
    visitCall(expr) {
        return new Call(expr.name, expr.args.map(e => e.accept(this)));
    }
    visitLambda(expr) {
        return new Lambda(expr.body.accept(this), expr.param);
    }
}
export class Expr {
}
export class Const extends Expr {
    constructor(value) {
        super();
        this.value = value;
    }
    accept(visitor) { return visitor.visitConst(this); }
    eq(other) { return other instanceof Const && other.value === this.value; }
    toString() { return JSON.stringify(this.value); }
}
export class Prop extends Expr {
    constructor(instance, name) {
        super();
        this.instance = instance;
        this.name = name;
    }
    accept(visitor) { return visitor.visitProp(this); }
    eq(other) { return other instanceof Prop && other.instance.eq(this.instance) && other.name === this.name; }
    toString() { return `${this.instance.toString()}.${this.name}`; }
}
export class Param extends Expr {
    constructor(name) {
        super();
        this.name = name;
    }
    accept(visitor) { return visitor.visitParam(this); }
    eq(other) { return other instanceof Param && other.name === this.name; }
    toString() { return this.name.toString(); }
}
export class BinOp extends Expr {
    constructor(left, op, right) {
        super();
        this.left = left;
        this.op = op;
        this.right = right;
    }
    static unwind(head, tail) {
        if (!tail || !tail.length) {
            return head;
        }
        return tail.reduce((left, vals) => {
            const op = vals[1];
            const right = vals[3];
            return new BinOp(left, op, right);
        }, head);
    }
    accept(visitor) { return visitor.visitBinary(this); }
    eq(other) {
        return other instanceof BinOp && other.op === this.op && other.left.eq(this.left) && other.right.eq(this.right);
    }
    toString() {
        return `(${this.left.toString()} ${BinOp.binOpStrings[this.op]} ${this.right.toString()})`;
    }
}
BinOp.binOpStrings = {
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
};
export class UnOp extends Expr {
    constructor(op, operand) {
        super();
        this.op = op;
        this.operand = operand;
    }
    accept(visitor) { return visitor.visitUnary(this); }
    eq(other) {
        return other instanceof UnOp && other.op === this.op && other.operand.eq(this.operand);
    }
    toString() {
        if (this.op === UnaryOperation.NOT) {
            return `!(${this.operand})`;
        }
        return `${UnOp.unOpStrings[this.op]}(${this.operand})`;
    }
}
UnOp.unOpStrings = {
    [UnaryOperation.NOT]: 'not',
    [UnaryOperation.NEG]: 'neg',
    [UnaryOperation.IS_NULL]: 'isNull'
};
export class Call extends Expr {
    constructor(name, args) {
        super();
        if (Call.knownFunctions[name]) {
            const argCount = Call.knownFunctions[name];
            if ('number' === typeof argCount) {
                if (argCount !== args.length) {
                    throw new Error(`invalid argument count for ${name}: ${args.length}, accepted argument count: ${argCount}`);
                }
            }
            else {
                if (-1 === argCount.indexOf(args.length)) {
                    throw new Error(`invalid argument count for ${name}: ${args.length}, accepted argument counts: ${argCount.join(',')}`);
                }
            }
        }
        this.name = name;
        this.args = args;
    }
    accept(visitor) { return visitor.visitCall(this); }
    eq(other) {
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
Call.knownFunctions = {
    contains: 2,
    substring: [2, 3]
};
export class Lambda extends Expr {
    constructor(body, param) {
        super();
        this.body = body;
        this.param = param;
    }
    accept(visitor) { return visitor.visitLambda(this); }
    eq(other) {
        if (!(other instanceof Lambda)) {
            return false;
        }
        throw new Error('Lambda equality is not implemented!');
    }
    toString() { return `${this.param} => ${this.body}`; }
    substituteParameter(target) {
        return new Lambda(substituteParameter(this.param, target, this.body), target);
    }
    and(other) {
        if (this.param.eq(other.param)) {
            return new Lambda(new BinOp(this.body, BinaryOperation.AND, other.body), this.param);
        }
        return new Lambda(new BinOp(this.body, BinaryOperation.AND, other.substituteParameter(this.param).body), this.param);
    }
}
export function parse(raw) {
    return parser.parse(raw);
}
export function substituteParameter(source, target, expression) {
    const visitor = new class extends ConvertVisitor {
        visitParam(p) { return p.eq(source) ? target : p; }
    };
    return expression.accept(visitor);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvdG9jb2wuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvcHJvdG9jb2wudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLFFBQVEsSUFBSSxjQUFjLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFFbkQsTUFBTSxPQUFPLEdBQ1QsQ0FBRSxzR0FBc0c7SUFDcEcsK0NBQStDO0lBQy9DLGNBQWM7SUFFZCxnRUFBZ0U7SUFFaEUsNkdBQTZHO0lBQzdHLGlIQUFpSDtJQUNqSCw0SEFBNEg7SUFDNUgsZ0hBQWdIO0lBRWhILDBFQUEwRTtJQUMxRSxzSUFBc0k7SUFDdEksdUNBQXVDO0lBQ3ZDLHFDQUFxQztJQUNyQyx5RUFBeUU7SUFDekUsbUZBQW1GO0lBQ25GLHFMQUFxTDtJQUNyTCwwRUFBMEU7SUFDMUUseUtBQXlLO0lBQ3pLLGdEQUFnRDtJQUNoRCxzQ0FBc0M7SUFDdEMsd0NBQXdDO0lBQ3hDLHFDQUFxQztJQUNyQyx3Q0FBd0M7SUFDeEMscUNBQXFDO0lBQ3JDLHFDQUFxQztJQUNyQyxzQ0FBc0M7SUFDdEMsc0NBQXNDO0lBQ3RDLHVDQUF1QztJQUN2Qyx1Q0FBdUM7SUFDdkMsd0NBQXdDO0lBQ3hDLHVDQUF1QztJQUN2Qyx1Q0FBdUM7SUFDdkMsa0RBQWtEO0lBQ2xELDZGQUE2RjtJQUM3RixpQ0FBaUMsQ0FBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUV2RCxNQUFNLE1BQU0sR0FBRyxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUM7QUFFdkMsTUFBTSxDQUFOLElBQVksZUFjWDtBQWRELFdBQVksZUFBZTtJQUN2Qiw0QkFBUyxDQUFBO0lBQ1QsOEJBQVcsQ0FBQTtJQUNYLDRCQUFTLENBQUE7SUFDVCw0QkFBUyxDQUFBO0lBQ1QsNEJBQVMsQ0FBQTtJQUNULDRCQUFTLENBQUE7SUFDVCw0QkFBUyxDQUFBO0lBQ1QsOEJBQVcsQ0FBQTtJQUNYLDhCQUFXLENBQUE7SUFDWCw4QkFBVyxDQUFBO0lB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