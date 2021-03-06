//All kinds of conversion passes over the source code
var jsp = require("acorn");
var walk = require("acorn/util/walk.js");
var rnonIdentMember = /[.\-_$a-zA-Z0-9]/g;
var global = new Function("return this")();

function equals( a, b ) {
    if( a.type === b.type ) {
        if( a.type === "MemberExpression" ) {
            return equals( a.object, b.object ) &&
                equals( a.property, b.property );
        }
        else if( a.type === "Identifier" ) {
            return a.name === b.name;
        }
        else if( a.type === "ThisExpression" ) {
            return true;
        }
        else {
            console.log("equals", a, b);
            unhandled();
        }
    }
    return false;
}

function getReceiver( expr ) {
    if( expr.type === "MemberExpression" ) {
        return expr.object;
    }
    return null;
}

function nodeToString( expr ) {
    if( expr == null || typeof expr !== "object" ) {
        if( expr === void 0 ) {
            return "void 0";
        }
        else if( typeof expr === "string" ) {
            return '"' + safeToEmbedString(expr) + '"';
        }
        return ("" + expr);
    }
    if( expr.type === "Identifier" ) {
        return expr.name;
    }
    else if( expr.type === "MemberExpression" ) {
        if( expr.computed )
            return nodeToString( expr.object ) + "[" + nodeToString( expr.property ) + "]";
        else
            return nodeToString( expr.object ) + "." + nodeToString( expr.property );
    }
    else if( expr.type === "UnaryExpression" ) {
        if( expr.operator === "~" ||
            expr.operator === "-" ||
            expr.operator === "+" ||
            expr.operator === "-" ) {
            return expr.operator + nodeToString( expr.argument );
        }
        return "(" + expr.operator + " " + nodeToString( expr.argument ) + ")";
    }
    else if( expr.type === "Literal" ) {
        return expr.raw;
    }
    else if( expr.type === "BinaryExpression" || expr.type === "LogicalExpression" ) {
        return "("+nodeToString(expr.left) + " " +
            expr.operator + " " +
            nodeToString(expr.right) + ")";
    }
    else if( expr.type === "ThisExpression" ) {
        return "this";
    }
    else if( expr.type === "NewExpression" ) {
        return "new " + nodeToString(expr.callee) + "(" + nodeToString(expr.arguments) +")";
    }
    //assuming it is arguments
    else if( Array.isArray( expr ) ) {
        var tmp = [];
        for( var i = 0, len = expr.length; i < len; ++i ) {
            tmp.push( nodeToString(expr[i]) );
        }
        return tmp.join(", ");
    }
    else if( expr.type === "FunctionExpression" ) {
        var params = [];
        for( var i = 0, len = expr.params.length; i < len; ++i ) {
            params.push( nodeToString(expr.params[i]) );
        }
    }
    else if( expr.type === "BlockStatement" ) {
        var tmp  = [];
        for( var i = 0, len = expr.body.length; i < len; ++i ) {
            tmp.push( nodeToString(expr.body[i]) );
        }
        return tmp.join(";\n");
    }
    else if( expr.type === "CallExpression" ) {
        var args = [];
        for( var i = 0, len = expr.arguments.length; i < len; ++i ) {
            args.push( nodeToString(expr.arguments[i]) );
        }
        return nodeToString( expr.callee ) + "("+args.join(",")+")";
    }
    else {
        console.log( "nodeToString", expr );
        unhandled()
    }
}

function DynamicCall( receiver, fnDereference, arg, start, end ) {
    this.receiver = receiver;
    this.fnDereference = fnDereference;
    this.arg = arg;
    this.start = start;
    this.end = end;
}

DynamicCall.prototype.toString = function() {
    return nodeToString(this.fnDereference) + ".call(" +
        nodeToString(this.receiver) + ", " +
        nodeToString(this.arg) +
    ")";
};

function DirectCall( receiver, fnName, arg, start, end ) {
    this.receiver = receiver;
    this.fnName = fnName;
    this.arg = arg;
    this.start = start;
    this.end = end;
}
DirectCall.prototype.toString = function() {
    return nodeToString(this.receiver) + "." + nodeToString(this.fnName) +
        "(" + nodeToString(this.arg) + ")"
};


function ConstantReplacement( value, start, end ) {
    this.value = value;
    this.start = start;
    this.end = end;
}

ConstantReplacement.prototype.toString = function() {
    return nodeToString(this.value);
};

function Empty(start, end) {
    this.start = start;
    this.end = end;
}
Empty.prototype.toString = function() {
    return "";
};

function Assertion( expr, exprStr, start, end ) {
    this.expr = expr;
    this.exprStr = exprStr;
    this.start = start;
    this.end = end;
}
Assertion.prototype.toString = function() {
    return 'ASSERT('+nodeToString(this.expr)+',\n    '+this.exprStr+')';
};

var opts = {
    ecmaVersion: 5,
    strictSemicolons: false,
    allowTrailingCommas: true,
    forbidReserved: false,
    locations: false,
    onComment: null,
    ranges: false,
    program: null,
    sourceFile: null
};

var rlineterm = /[\r\n\u2028\u2029]/;
var rhorizontalws = /[ \t]/;

var convertSrc = function( src, results ) {
    if( results.length ) {
        results.sort(function(a, b){
            var ret = a.start - b.start;
            if( ret === 0 ) {
                ret = a.end - b.end;
            }
            return ret;
        });
        for( var i = 1; i < results.length; ++i ) {
            var item = results[i];
            if( item.start === results[i-1].start &&
                item.end === results[i-1].end ) {
                results.splice(i++, 1);
            }
        }
        var ret = "";
        var start = 0;
        for( var i = 0, len = results.length; i < len; ++i ) {
            var item = results[i];
            ret += src.substring( start, item.start );
            ret += item.toString();
            start = item.end;
        }
        ret += src.substring( start );
        return ret;
    }
    return src;
};

var rescape = /[\r\n\u2028\u2029"]/g;

var replacer = function( ch ) {
        return "\\u" + (("0000") +
            (ch.charCodeAt(0).toString(16))).slice(-4);
};

function safeToEmbedString( str ) {
    return str.replace( rescape, replacer );
}

var astPasses = module.exports = {

    removeComments: function( src ) {
        var results = [];
        var rnoremove = /^[*\s\/]*(?:@preserve|jshint|global)/;
        opts.onComment = function( block, text, start, end ) {
            if( rnoremove.test(text) ) {
                return;
            }
            var e = end + 1;
            var s = start - 1;
            while(rhorizontalws.test(src.charAt(s--)));
            while(rlineterm.test(src.charAt(e++)));
            results.push( new Empty( s + 2, e - 1 ) );
        };
        var ast = jsp.parse(src, opts);
        return convertSrc( src, results );
    },

    expandConstants: function( src ) {
        var constants = {};
        var results = [];
        var identifiers = [];
        var ignore =[];
        var ast = jsp.parse(src);
        walk.simple(ast, {
            ExpressionStatement: function( node ) {

                if( node.expression.type !== 'CallExpression' ) {
                    return;
                }

                var start = node.start;
                var end = node.end;
                node = node.expression;
                var callee = node.callee;
                if( callee.name === "CONSTANT" &&
                    callee.type === "Identifier" ) {

                    if( node.arguments.length !== 2 ) {
                        throw new Error( "Exactly 2 arguments must be passed to CONSTANT\n" +
                            src.substring(start, end)
                        );
                    }

                    if( node.arguments[0].type !== "Identifier" ) {
                        throw new Error( "Can only define identifier as a constant\n" +
                            src.substring(start, end)
                        );
                    }

                    var args = node.arguments;
                    var e = end + 1;
                    var s = start - 1;

                    while(rhorizontalws.test(src.charAt(s--)));
                    while(rlineterm.test(src.charAt(e++)));
                    results.push( new Empty( s + 2, e - 1 ) );

                    var name = args[0];
                    var nameStr = name.name;
                    var expr = args[1];

                    var e = eval;
                    constants[nameStr] = {
                        identifier: name,
                        value: e(nodeToString(expr))
                    };
                    walk.simple( expr, {
                        Identifier: function( node ) {
                            ignore.push(node);
                        }
                    });
                    global[nameStr] = constants[nameStr].value;
                }
            },

            Identifier: function( node ) {
                identifiers.push( node );
            }
        });

        for( var i = 0, len = identifiers.length; i < len; ++i ) {
            var id = identifiers[i];
            if( ignore.indexOf(id) > -1 ) {
                continue;
            }
            var constant = constants[id.name];
            if( constant === void 0 ) {
                continue;
            }
            if( constant.identifier === id ) {
                continue;
            }

            results.push( new ConstantReplacement( constant.value, id.start, id.end ) );

        }
        return convertSrc( src, results );
    },

    expandAsserts: function( src ) {
        var ast = jsp.parse(src);
        var results = [];
        walk.simple(ast, {
            CallExpression: function( node ) {

                var start = node.start;
                var end = node.end;
                var callee = node.callee;

                if( callee.type === "Identifier" &&
                    callee.name === "ASSERT" ) {
                    if( node.arguments.length !== 1 ) {
                        throw new Error( "Invalid amount of arguments to ASSERT" +
                            src.substring(start, end)
                        );
                    }

                    var expr = node.arguments[0];
                    var str = src.substring(expr.start, expr.end);
                    str = '"' + safeToEmbedString(str) + '"'
                    var assertion = new Assertion( expr, str, start, end );

                    results.push( assertion );
                }
            }
        });
        return convertSrc( src, results );
    },

    removeAsserts: function( src ) {
        var ast = jsp.parse(src);
        var results = [];
        walk.simple(ast, {
            ExpressionStatement: function( node ) {
                if( node.expression.type !== 'CallExpression' ) {
                    return;
                }
                var start = node.start;
                var end = node.end;
                node = node.expression;
                var callee = node.callee;

                if( callee.type === "Identifier" &&
                    callee.name === "ASSERT" ) {
                    if( node.arguments.length !== 1 ) {
                        throw new Error( "Invalid amount of arguments to ASSERT" +
                            src.substring(start, end)
                        );
                    }
                    var e = end + 1;
                    var s = start - 1;

                    while(rhorizontalws.test(src.charAt(s--)));
                    while(rlineterm.test(src.charAt(e++)));
                    results.push( new Empty( s + 2, e - 1) );
                }
            }
        });
        return convertSrc( src, results );
    },

    asyncConvert: function( src, objName, fnProp ) {
        var ast = jsp.parse(src);

        var results = [];
        walk.simple(ast, {
            CallExpression: function( node ) {
                var start = node.start;
                var end = node.end;
                if( node.callee.type === "MemberExpression" &&
                    node.callee.object.name === objName &&
                    node.callee.property.name === fnProp &&
                    node.arguments.length === 3
                ) {

                    var args = node.arguments;
                    var fnDereference = args[0];
                    var dynamicReceiver = args[1];
                    var arg = args[2];

                    var receiver = getReceiver(fnDereference);

                    if( receiver == null || !equals(receiver, dynamicReceiver) ) {
                        //Have to use fnDereference.call(dynamicReceiver, arg);
                        results.push(
                            new DynamicCall( dynamicReceiver, fnDereference, arg, start, end )
                        );
                    }
                    else {
                        var fnName = fnDereference.property;
                        results.push(
                            new DirectCall( receiver, fnName, arg, start, end )
                        );
                        //Can use receiver.fnName( arg );

                    }


                }
            }
        });
        return convertSrc( src, results );
    }
};
