import chalk from "chalk";
import fs from "fs";
import path from "path";
import { getAllAliases } from "./aliases";

const BUILTINS = new Set([
  "exit", "echo", "type", "pwd", "cd", "ls", "alias", "unalias",
  "clear", "history",
]);

let execCache = new Set<string>();
let execCacheTime = 0;
const CACHE_TTL = 30_000;

function refreshExecutables(): void {
  const set = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(":")) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        set.add(entry);
      }
    } catch {}
  }
  execCache = set;
  execCacheTime = Date.now();
}

refreshExecutables();

function getExecutables(): Set<string> {
  if (Date.now() - execCacheTime > CACHE_TTL) {
    setImmediate(refreshExecutables);
  }
  return execCache;
}

function commandExists(cmd: string): boolean {
  if (!cmd) return false;
  if (BUILTINS.has(cmd)) return true;
  if (getAllAliases().has(cmd)) return true;
  if (cmd.startsWith("/") || cmd.startsWith("./") || cmd.startsWith("../")) {
    try { fs.accessSync(cmd, fs.constants.X_OK); return true; } catch { return false; }
  }
  return getExecutables().has(cmd);
}

type TokenType =
  | "command"       
  | "arg"           
  | "flag"          
  | "operator"     
  | "redirect"    
  | "string_d"     
  | "string_s"    
  | "variable"     
  | "path"     
  | "incomplete_s"

type Token = { type: TokenType; value: string };

function tokenizeForHighlight(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let expectCmd = true;

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t") {
      tokens.push({ type: "arg", value: ch });
      i++;
      continue;
    }

    if (ch === "&" && input[i + 1] === "&") {
      tokens.push({ type: "operator", value: "&&" });
      i += 2; expectCmd = true; continue;
    }
    if (ch === "|" && input[i + 1] === "|") {
      tokens.push({ type: "operator", value: "||" });
      i += 2; expectCmd = true; continue;
    }
    if (ch === "|") {
      tokens.push({ type: "operator", value: "|" });
      i++; expectCmd = true; continue;
    }
    if (ch === ";") {
      tokens.push({ type: "operator", value: ";" });
      i++; expectCmd = true; continue;
    }
    if (ch === "&") {
      tokens.push({ type: "operator", value: "&" });
      i++; continue;
    }

    if (ch === ">" && input[i + 1] === ">") {
      tokens.push({ type: "redirect", value: ">>" });
      i += 2; continue;
    }
    if (ch === ">") {
      tokens.push({ type: "redirect", value: ">" });
      i++; continue;
    }
    if (ch === "<") {
      tokens.push({ type: "redirect", value: "<" });
      i++; continue;
    }

    if (ch === '"') {
      let s = '"';
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) { s += input[i] + input[i + 1]; i += 2; }
        else { s += input[i++]; }
      }
      if (i < input.length) { s += '"'; i++; tokens.push({ type: "string_d", value: s }); }
      else { tokens.push({ type: "incomplete_s", value: s }); }
      continue;
    }

    if (ch === "'") {
      let s = "'";
      i++;
      while (i < input.length && input[i] !== "'") { s += input[i++]; }
      if (i < input.length) { s += "'"; i++; tokens.push({ type: "string_s", value: s }); }
      else { tokens.push({ type: "incomplete_s", value: s }); }
      continue;
    }

    if (ch === "$") {
      let s = "$";
      i++;
      while (i < input.length && /[A-Za-z0-9_?]/.test(input[i])) { s += input[i++]; }
      tokens.push({ type: "variable", value: s });
      continue;
    }

    let word = "";
    while (
      i < input.length &&
      input[i] !== " " && input[i] !== "\t" &&
      input[i] !== "|" && input[i] !== ">" && input[i] !== "<" &&
      input[i] !== ";" && input[i] !== "&" &&
      input[i] !== '"' && input[i] !== "'"
    ) {
      word += input[i++];
    }

    if (!word) { i++; continue; }

    if (expectCmd) {
      tokens.push({ type: "command", value: word });
      expectCmd = false;
    } else if (word.startsWith("-")) {
      tokens.push({ type: "flag", value: word });
    } else if (word.includes("/") || word.startsWith("~")) {
      tokens.push({ type: "path", value: word });
    } else {
      tokens.push({ type: "arg", value: word });
    }
  }

  return tokens;
}

export function highlight(input: string): string {
  const tokens = tokenizeForHighlight(input);
  let out = "";

  for (const tok of tokens) {
    switch (tok.type) {
      case "command":
        out += commandExists(tok.value)
          ? chalk.green(tok.value)
          : chalk.red(tok.value);
        break;
      case "flag":
        out += chalk.yellow(tok.value);
        break;
      case "operator":
        out += chalk.cyan.bold(tok.value);
        break;
      case "redirect":
        out += chalk.cyan(tok.value);
        break;
      case "string_d":
        out += chalk.hex("#E5A050")(tok.value); 
        break;
      case "string_s":
        out += chalk.hex("#E5A050")(tok.value);
        break;
      case "incomplete_s":
        out += chalk.hex("#E5A050").dim(tok.value);
        break;
      case "variable":
        out += chalk.magenta(tok.value);
        break;
      case "path":
        out += chalk.blue(tok.value);
        break;
      case "arg":
      default:
        out += tok.value;
        break;
    }
  }

  return out;
}