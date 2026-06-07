// src/selector/lexer.ts
function tokenize(input) {
  const tokens = [];
  let pos = 0;
  function skipWhitespace() {
    while (pos < input.length && /\s/.test(input[pos])) pos++;
  }
  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;
    const start = pos;
    const ch = input[pos];
    if (ch === "+") {
      tokens.push({ type: "AND", value: "+", position: start });
      pos++;
      continue;
    }
    if (ch === "|") {
      tokens.push({ type: "OR", value: "|", position: start });
      pos++;
      continue;
    }
    if (ch === "-") {
      tokens.push({ type: "NOT", value: "-", position: start });
      pos++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(", position: start });
      pos++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")", position: start });
      pos++;
      continue;
    }
    if (ch === "#") {
      pos++;
      const tagStart = pos;
      while (pos < input.length && /[a-zA-Z0-9_-]/.test(input[pos])) pos++;
      const tagValue = input.slice(tagStart, pos);
      if (!tagValue) {
        throw new Error(`Invalid tag at position ${start}: expected tag name after #`);
      }
      tokens.push({ type: "TAG", value: tagValue, position: start });
      continue;
    }
    if (input.slice(pos).startsWith("contextnest://")) {
      const uriStart = pos;
      pos += "contextnest://".length;
      while (pos < input.length && !/[\s+|\-()]/.test(input[pos])) pos++;
      tokens.push({ type: "URI", value: input.slice(uriStart, pos), position: uriStart });
      continue;
    }
    if (ch === '"') {
      pos++;
      const strStart = pos;
      while (pos < input.length && input[pos] !== '"') pos++;
      const value = input.slice(strStart, pos);
      pos++;
      if (value.startsWith("contextnest://")) {
        tokens.push({ type: "URI", value, position: start });
      } else if (value.startsWith("#")) {
        tokens.push({ type: "TAG", value: value.slice(1), position: start });
      } else if (value.startsWith("pack:")) {
        tokens.push({ type: "PACK", value: value.slice(5), position: start });
      } else {
        tokens.push({ type: "URI", value, position: start });
      }
      continue;
    }
    const wordMatch = input.slice(pos).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (wordMatch) {
      const word = wordMatch[1];
      const afterWord = pos + word.length;
      if (afterWord < input.length && input[afterWord] === ":") {
        pos = afterWord + 1;
        const valueStart = pos;
        while (pos < input.length && /[a-zA-Z0-9_-]/.test(input[pos])) pos++;
        const filterValue = input.slice(valueStart, pos);
        switch (word) {
          case "type":
            tokens.push({ type: "TYPE_FILTER", value: filterValue, position: start });
            break;
          case "status":
            tokens.push({ type: "STATUS_FILTER", value: filterValue, position: start });
            break;
          case "transport":
            tokens.push({ type: "TRANSPORT_FILTER", value: filterValue, position: start });
            break;
          case "server":
            tokens.push({ type: "SERVER_FILTER", value: filterValue, position: start });
            break;
          case "pack":
            const packStart = pos - filterValue.length;
            pos = packStart;
            while (pos < input.length && /[a-zA-Z0-9_.-]/.test(input[pos])) pos++;
            tokens.push({
              type: "PACK",
              value: input.slice(packStart, pos),
              position: start
            });
            break;
          default:
            throw new Error(`Unknown filter type "${word}" at position ${start}`);
        }
        continue;
      }
      throw new Error(`Unexpected token "${word}" at position ${start}`);
    }
    throw new Error(`Unexpected character "${ch}" at position ${pos}`);
  }
  tokens.push({ type: "EOF", value: "", position: pos });
  return tokens;
}

// src/selector/parser.ts
var ATOM_TYPES = [
  "TAG",
  "URI",
  "PACK",
  "TYPE_FILTER",
  "STATUS_FILTER",
  "TRANSPORT_FILTER",
  "SERVER_FILTER"
];
var SelectorParser = class {
  tokens;
  pos = 0;
  constructor(tokens) {
    this.tokens = tokens;
  }
  peek() {
    return this.tokens[this.pos];
  }
  advance() {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }
  expect(type) {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(
        `Expected ${type} but got ${token.type} ("${token.value}") at position ${token.position}`
      );
    }
    return this.advance();
  }
  isAtom() {
    return ATOM_TYPES.includes(this.peek().type) || this.peek().type === "LPAREN";
  }
  parse() {
    const result = this.parseOrExpr();
    if (this.peek().type !== "EOF") {
      throw new Error(
        `Unexpected token "${this.peek().value}" at position ${this.peek().position}`
      );
    }
    return result;
  }
  // or_expr → not_expr ("|" not_expr)*
  parseOrExpr() {
    let left = this.parseNotExpr();
    while (this.peek().type === "OR") {
      this.advance();
      const right = this.parseNotExpr();
      left = { type: "or", left, right };
    }
    return left;
  }
  // not_expr → and_expr ("-" and_expr)*
  parseNotExpr() {
    let left = this.parseAndExpr();
    while (this.peek().type === "NOT") {
      this.advance();
      const right = this.parseAndExpr();
      left = { type: "not", left, right };
    }
    return left;
  }
  // and_expr → atom (("+" | implicit) atom)*
  parseAndExpr() {
    let left = this.parseAtom();
    while (true) {
      if (this.peek().type === "AND") {
        this.advance();
        const right = this.parseAtom();
        left = { type: "and", left, right };
      } else if (this.isAtom()) {
        const right = this.parseAtom();
        left = { type: "and", left, right };
      } else {
        break;
      }
    }
    return left;
  }
  // atom → TAG | URI | PACK | TYPE_FILTER | STATUS_FILTER |
  //        TRANSPORT_FILTER | SERVER_FILTER | "(" expr ")"
  parseAtom() {
    const token = this.peek();
    switch (token.type) {
      case "TAG":
        this.advance();
        return { type: "tag", value: token.value };
      case "URI":
        this.advance();
        return { type: "uri", value: token.value };
      case "PACK":
        this.advance();
        return { type: "pack", value: token.value };
      case "TYPE_FILTER":
        this.advance();
        return { type: "typeFilter", value: token.value };
      case "STATUS_FILTER":
        this.advance();
        return { type: "statusFilter", value: token.value };
      case "TRANSPORT_FILTER":
        this.advance();
        return { type: "transportFilter", value: token.value };
      case "SERVER_FILTER":
        this.advance();
        return { type: "serverFilter", value: token.value };
      case "LPAREN": {
        this.advance();
        const expr = this.parseOrExpr();
        this.expect("RPAREN");
        return expr;
      }
      default:
        throw new Error(
          `Unexpected token "${token.value}" at position ${token.position}`
        );
    }
  }
};
function parseSelector(input) {
  const tokens = tokenize(input);
  const parser = new SelectorParser(tokens);
  return parser.parse();
}

export {
  tokenize,
  parseSelector
};
