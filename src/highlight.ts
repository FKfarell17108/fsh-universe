import chalk from "chalk";
import fs from "fs";
import path from "path";
import { getAllAliases } from "./aliases";

const BUILTINS = new Set([
  "exit", "echo", "type", "pwd", "cd", "ls", "dir", "alias", "unalias",
  "clear", "history", "trash", "fshrc", "neofetch",
]);

const CMD_EDITORS = new Set([
  "vim", "vi", "nvim", "nano", "emacs", "micro", "hx", "helix",
  "code", "gedit", "kate", "subl", "atom",
]);

const CMD_GIT = new Set([
  "git", "gh", "hub",
]);

const CMD_NODE = new Set([
  "node", "npm", "npx", "yarn", "pnpm", "bun", "deno", "ts-node",
]);

const CMD_PYTHON = new Set([
  "python", "python3", "python2", "pip", "pip3", "pipenv", "poetry", "uv",
]);

const CMD_SYSTEM = new Set([
  "sudo", "su", "systemctl", "service", "journalctl",
  "apt", "apt-get", "dpkg", "snap",
  "pacman", "yay", "brew",
  "kill", "killall", "pkill", "top", "htop", "btop",
  "ps", "pgrep", "lsof", "df", "du", "free", "uname",
]);

const CMD_NETWORK = new Set([
  "curl", "wget", "ssh", "scp", "sftp", "rsync",
  "ping", "traceroute", "netstat", "ss", "ip", "ifconfig",
  "nmap", "dig", "nslookup", "host",
]);

const CMD_FILE_OPS = new Set([
  "mkdir", "rmdir", "rm", "cp", "mv", "touch", "ln",
  "chmod", "chown", "chgrp", "find", "locate",
  "tar", "zip", "unzip", "gzip", "gunzip", "7z",
  "cat", "less", "more", "head", "tail", "tee",
  "grep", "awk", "sed", "sort", "uniq", "wc", "cut",
  "diff", "patch", "xargs",
]);

const CMD_DOCKER = new Set([
  "docker", "docker-compose", "podman", "kubectl", "helm", "k3s",
]);

const CMD_BUILD = new Set([
  "make", "cmake", "gcc", "g++", "clang", "rustc", "cargo",
  "go", "javac", "java", "mvn", "gradle",
  "tsc", "webpack", "vite", "rollup", "esbuild",
]);

const CMD_SHELL = new Set([
  "bash", "zsh", "fish", "sh", "dash",
  "source", "export", "env", "printenv", "set", "unset",
  "which", "whereis", "man", "tldr", "info",
  "date", "time", "watch", "sleep",
]);

function cmdColor(cmd: string): string {
  const base = cmd.split("/").pop() ?? cmd;
  if (BUILTINS.has(base))       return chalk.green.bold(cmd);
  if (getAllAliases().has(base)) return chalk.green(cmd);
  if (CMD_EDITORS.has(base))    return chalk.hex("#C792EA")(cmd);
  if (CMD_GIT.has(base))        return chalk.hex("#F78C6C")(cmd);
  if (CMD_NODE.has(base))       return chalk.hex("#80CBC4")(cmd);
  if (CMD_PYTHON.has(base))     return chalk.hex("#FFCB6B")(cmd);
  if (CMD_SYSTEM.has(base))     return chalk.hex("#FF5572")(cmd);
  if (CMD_NETWORK.has(base))    return chalk.hex("#89DDFF")(cmd);
  if (CMD_FILE_OPS.has(base))   return chalk.hex("#C3E88D")(cmd);
  if (CMD_DOCKER.has(base))     return chalk.hex("#4FC3F7")(cmd);
  if (CMD_BUILD.has(base))      return chalk.hex("#F9A825")(cmd);
  if (CMD_SHELL.has(base))      return chalk.hex("#A6ACCD")(cmd);
  return chalk.green(cmd);
}

let execCache     = new Set<string>();
let execCacheTime = 0;
let refreshPending = false;
const CACHE_TTL   = 5_000;

function refreshExecutables(): void {
  refreshPending = false;
  const set = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(":")) {
    try { for (const entry of fs.readdirSync(dir)) set.add(entry); }
    catch {}
  }
  execCache     = set;
  execCacheTime = Date.now();
}

refreshExecutables();

function getExecutables(): Set<string> {
  if (!refreshPending && Date.now() - execCacheTime > CACHE_TTL) {
    refreshPending = true;
    setImmediate(refreshExecutables);
  }
  return execCache;
}

function commandExists(cmd: string): boolean {
  if (!cmd) return false;
  const base = cmd.split("/").pop() ?? cmd;
  if (BUILTINS.has(base)) return true;
  if (getAllAliases().has(base)) return true;
  if (cmd.startsWith("/") || cmd.startsWith("./") || cmd.startsWith("../")) {
    try { fs.accessSync(cmd, fs.constants.X_OK); return true; } catch { return false; }
  }
  return getExecutables().has(base);
}

type FsKind = "dir" | "dir_hidden" | "file" | "file_hidden" | "none";

function resolveFsKind(word: string): FsKind {
  let resolved = word;
  const home   = process.env.HOME ?? "";

  if (word.startsWith("~/")) {
    resolved = path.join(home, word.slice(2));
  } else if (!word.startsWith("/")) {
    resolved = path.join(process.cwd(), word);
  }

  try {
    const stat    = fs.statSync(resolved);
    const base    = path.basename(resolved);
    const hidden  = base.startsWith(".");
    if (stat.isDirectory()) return hidden ? "dir_hidden" : "dir";
    return hidden ? "file_hidden" : "file";
  } catch {
    return "none";
  }
}

function colorArg(word: string): string {
  if (word.startsWith("-")) return chalk.yellow(word);

  const looksLikePath = word.includes("/") || word.startsWith("~/") ||
    word.startsWith("./") || word.startsWith("../");

  if (looksLikePath || !word.includes(" ")) {
    const kind = resolveFsKind(word);
    const base = path.basename(word);
    const hidden = base.startsWith(".");

    switch (kind) {
      case "dir":        return chalk.blue.bold(word);
      case "dir_hidden": return chalk.cyan(word);
      case "file":       return chalk.white(word);
      case "file_hidden":return chalk.gray(word);
      case "none":
        if (looksLikePath) return chalk.red.dim(word);
        return chalk.white(word);
    }
  }

  return chalk.white(word);
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
  | "incomplete_s";

type Token = { type: TokenType; value: string };

function tokenizeForHighlight(input: string): Token[] {
  const tokens: Token[] = [];
  let i         = 0;
  let expectCmd = true;

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t") {
      tokens.push({ type: "arg", value: ch });
      i++;
      continue;
    }

    if (ch === "&" && input[i + 1] === "&") { tokens.push({ type: "operator", value: "&&" }); i += 2; expectCmd = true; continue; }
    if (ch === "|" && input[i + 1] === "|") { tokens.push({ type: "operator", value: "||" }); i += 2; expectCmd = true; continue; }
    if (ch === "|")                          { tokens.push({ type: "operator", value: "|"  }); i++;    expectCmd = true; continue; }
    if (ch === ";")                          { tokens.push({ type: "operator", value: ";"  }); i++;    expectCmd = true; continue; }
    if (ch === "&")                          { tokens.push({ type: "operator", value: "&"  }); i++;    continue; }

    if (ch === ">" && input[i + 1] === ">") { tokens.push({ type: "redirect", value: ">>" }); i += 2; continue; }
    if (ch === ">")                          { tokens.push({ type: "redirect", value: ">"  }); i++;    continue; }
    if (ch === "<")                          { tokens.push({ type: "redirect", value: "<"  }); i++;    continue; }

    if (ch === '"') {
      let s = '"'; i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) { s += input[i] + input[i + 1]; i += 2; }
        else { s += input[i++]; }
      }
      if (i < input.length) { s += '"'; i++; tokens.push({ type: "string_d", value: s }); }
      else { tokens.push({ type: "incomplete_s", value: s }); }
      continue;
    }

    if (ch === "'") {
      let s = "'"; i++;
      while (i < input.length && input[i] !== "'") { s += input[i++]; }
      if (i < input.length) { s += "'"; i++; tokens.push({ type: "string_s", value: s }); }
      else { tokens.push({ type: "incomplete_s", value: s }); }
      continue;
    }

    if (ch === "$") {
      let s = "$"; i++;
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
    ) { word += input[i++]; }

    if (!word) { i++; continue; }

    if (expectCmd) {
      tokens.push({ type: "command", value: word });
      expectCmd = false;
    } else if (word.startsWith("-")) {
      tokens.push({ type: "flag", value: word });
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
        out += commandExists(tok.value) ? cmdColor(tok.value) : chalk.red(tok.value);
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
      case "arg":
        out += tok.value === " " || tok.value === "\t"
          ? tok.value
          : colorArg(tok.value);
        break;
      default:
        out += tok.value;
    }
  }

  return out;
}