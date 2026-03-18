export type Redirect = {
  type: ">" | ">>" | "<";
  file: string;
};

export type Command = {
  cmd: string;
  args: string[];
  redirects: Redirect[];
};

export type Pipeline = {
  commands: Command[];
  background: boolean;
};

export type Statement =
  | { kind: "pipeline"; pipeline: Pipeline }
  | { kind: "and"; left: Statement; right: Statement } 
  | { kind: "or"; left: Statement; right: Statement }
  | { kind: "seq"; left: Statement; right: Statement }; 

type Token =
  | { type: "word"; value: string }
  | { type: "pipe" }
  | { type: "and" }
  | { type: "or" }
  | { type: "semi" }
  | { type: "amp" }
  | { type: "redir"; op: ">" | ">>" | "<" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  function expandVars(s: string): string {
    return s.replace(/\$([A-Za-z_][A-Za-z0-9_]*|\?)/g, (_, name) => {
      if (name === "?") return String(process.exitCode ?? 0);
      return process.env[name] ?? "";
    });
  }

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t") { i++; continue; }

    if (ch === "&" && input[i + 1] === "&") { tokens.push({ type: "and" }); i += 2; continue; }
    if (ch === "|" && input[i + 1] === "|") { tokens.push({ type: "or" }); i += 2; continue; }
    if (ch === ">" && input[i + 1] === ">") { tokens.push({ type: "redir", op: ">>" }); i += 2; continue; }
    if (ch === ">") { tokens.push({ type: "redir", op: ">" }); i++; continue; }
    if (ch === "<") { tokens.push({ type: "redir", op: "<" }); i++; continue; }
    if (ch === "|") { tokens.push({ type: "pipe" }); i++; continue; }
    if (ch === ";") { tokens.push({ type: "semi" }); i++; continue; }
    if (ch === "&") { tokens.push({ type: "amp" }); i++; continue; }

    let word = "";
    let escape = false;

    while (i < input.length) {
      const c = input[i];

      if (escape) { word += c; escape = false; i++; continue; }
      if (c === "\\") { escape = true; i++; continue; }

      if (c === '"') {
        i++;
        while (i < input.length && input[i] !== '"') {
          if (input[i] === "\\" && i + 1 < input.length) {
            i++;
            word += input[i];
          } else {
            word += input[i];
          }
          i++;
        }
        i++;
        continue;
      }

      if (c === "'") {
        i++;
        while (i < input.length && input[i] !== "'") {
          word += input[i++];
        }
        i++;
        continue;
      }

      if (
        c === " " || c === "\t" ||
        c === "|" || c === ">" || c === "<" ||
        c === ";" || c === "&"
      ) break;

      word += c;
      i++;
    }

    if (word.length > 0) {
      tokens.push({ type: "word", value: expandVars(word) });
    }
  }

  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  peek(): Token | undefined { return this.tokens[this.pos]; }
  consume(): Token { return this.tokens[this.pos++]; }

  parseStatement(): Statement | null {
    let left = this.parseAndOr();
    if (!left) return null;

    while (this.peek()?.type === "semi") {
      this.consume();
      const right = this.parseAndOr();
      if (!right) break;
      left = { kind: "seq", left, right };
    }

    return left;
  }

  parseAndOr(): Statement | null {
    let left = this.parsePipeline();
    if (!left) return null;

    while (true) {
      const t = this.peek();
      if (t?.type === "and") {
        this.consume();
        const right = this.parsePipeline();
        if (!right) break;
        left = { kind: "and", left, right };
      } else if (t?.type === "or") {
        this.consume();
        const right = this.parsePipeline();
        if (!right) break;
        left = { kind: "or", left, right };
      } else {
        break;
      }
    }

    return left;
  }

  parsePipeline(): Statement | null {
    const first = this.parseCommand();
    if (!first) return null;

    const commands: Command[] = [first];

    while (this.peek()?.type === "pipe") {
      this.consume();
      const cmd = this.parseCommand();
      if (cmd) commands.push(cmd);
    }

    let background = false;
    if (this.peek()?.type === "amp") {
      this.consume();
      background = true;
    }

    return { kind: "pipeline", pipeline: { commands, background } };
  }

  parseCommand(): Command | null {
    const words: string[] = [];
    const redirects: Redirect[] = [];

    while (true) {
      const t = this.peek();
      if (!t) break;

      if (t.type === "word") {
        this.consume();
        words.push(t.value);
      } else if (t.type === "redir") {
        this.consume();
        const fileToken = this.peek();
        if (fileToken?.type === "word") {
          this.consume();
          redirects.push({ type: t.op, file: fileToken.value });
        }
      } else {
        break;
      }
    }

    if (words.length === 0) return null;

    return {
      cmd: words[0],
      args: words.slice(1),
      redirects,
    };
  }
}

export function parseInput(input: string): Statement | null {
  const tokens = tokenize(input);
  if (tokens.length === 0) return null;
  const parser = new Parser(tokens);
  return parser.parseStatement();
}