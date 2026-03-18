import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getAllAliases } from "./aliases";

const BUILTINS = ["exit", "echo", "type", "pwd", "cd", "ls", "alias", "unalias"];

export function getCandidates(line: string): { candidates: string[]; partial: string } {
  const tokens = tokenizeLine(line);
  const isFirstWord = tokens.length === 0 || (tokens.length === 1 && !line.endsWith(" "));

  if (isFirstWord) {
    const partial = tokens[0] ?? "";
    return { candidates: getCommandCandidates(partial), partial };
  } else {
    const partial = line.endsWith(" ") ? "" : tokens[tokens.length - 1];
    const { candidates } = getFileCandidates(partial);
    return { candidates, partial };
  }
}

function getCommandCandidates(partial: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const b of BUILTINS) {
    if (b.startsWith(partial)) { candidates.push(b); seen.add(b); }
  }
  for (const name of getAllAliases().keys()) {
    if (name.startsWith(partial) && !seen.has(name)) { candidates.push(name); seen.add(name); }
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.startsWith(partial) || seen.has(entry)) continue;
        try {
          fs.accessSync(path.join(dir, entry), fs.constants.X_OK);
          candidates.push(entry);
          seen.add(entry);
        } catch {}
      }
    } catch {}
  }

  return candidates.sort();
}

export function getFileCandidates(partial: string): { candidates: string[]; baseDir: string; prefix: string } {
  let dir: string;
  let prefix: string;

  if (partial === "" || partial === ".") {
    dir = process.cwd(); prefix = "";
  } else if (partial.startsWith("~/")) {
    const home = process.env.HOME ?? "";
    const rest = partial.slice(2);
    const lastSlash = rest.lastIndexOf("/");
    dir = lastSlash === -1 ? home : path.join(home, rest.slice(0, lastSlash));
    prefix = lastSlash === -1 ? rest : rest.slice(lastSlash + 1);
  } else if (partial.includes("/")) {
    const lastSlash = partial.lastIndexOf("/");
    dir = path.resolve(partial.slice(0, lastSlash) || "/");
    prefix = partial.slice(lastSlash + 1);
  } else {
    dir = process.cwd(); prefix = partial;
  }

  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}

  const candidates = entries
    .filter((e) => e.name.startsWith(prefix))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => {
      const name = e.name + (e.isDirectory() ? "/" : "");
      if (partial.startsWith("~/")) {
        const rest = partial.slice(2);
        const lastSlash = rest.lastIndexOf("/");
        return (lastSlash === -1 ? "~/" : "~/" + rest.slice(0, lastSlash + 1)) + name;
      } else if (partial.includes("/")) {
        return partial.slice(0, partial.lastIndexOf("/") + 1) + name;
      }
      return name;
    });

  return { candidates, baseDir: dir, prefix };
}

export function commonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let prefix = strs[0];
  for (const s of strs.slice(1)) {
    while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (!prefix) break;
  }
  return prefix;
}

export function showPicker(
  candidates: string[],
  onSelect: (chosen: string) => void,
  onCancel: () => void
) {
  if (candidates.length === 0) return onCancel();

  const stdin = process.stdin;
  const maxNameLen = Math.max(...candidates.map((c) => c.length));
  const COL_WIDTH = Math.max(maxNameLen + 2, 16);
  let selectedIndex = 0;
  let pickerLines = 0;

  function getPerRow() {
    return Math.max(1, Math.floor((process.stdout.columns || 80) / COL_WIDTH));
  }

  function render() {
    const perRow = getPerRow();
    const totalRows = Math.ceil(candidates.length / perRow);
    let frame = "";

    if (pickerLines > 0) {
      frame += `\x1b[${pickerLines}A\r\x1b[J`;
    }

    const key = (k: string) => chalk.bgGray.white.bold(` ${k} `);
    const hint = " " + key("↑↓←→") + chalk.gray(" move  ") + key("enter") + chalk.gray(" select  ") + key("esc") + chalk.gray(" cancel");
    frame += "\n" + hint + "\x1b[K\n\x1b[K";

    for (let row = 0; row < totalRows; row++) {
      let line = "\n ";
      for (let col = 0; col < perRow; col++) {
        const i = row * perRow + col;
        if (i >= candidates.length) break;
        const name = candidates[i];
        const padded = name.padEnd(COL_WIDTH, " ");
        const isSelected = i === selectedIndex;
        const isDir = name.endsWith("/");

        let cell: string;
        if (isSelected) {
          cell = chalk.bgWhite.black.bold(padded);
        } else if (isDir) {
          cell = name.startsWith(".") ? chalk.cyan(padded) : chalk.blue.bold(padded);
        } else {
          cell = name.startsWith(".") ? chalk.gray(padded) : chalk.white(padded);
        }
        line += cell;
      }
      frame += line + "\x1b[K";
    }

    pickerLines = 2 + totalRows;

    process.stdout.write(frame);
  }

  function clearPicker() {
    if (pickerLines > 0) {
      process.stdout.write(`\x1b[${pickerLines}A\r\x1b[J`);
      pickerLines = 0;
    }
  }

  function cleanup() {
    stdin.removeAllListeners("data");
    if (stdin.isTTY) stdin.setRawMode(false);
    process.stdout.write("\x1b[?25h");
  }

  function exit(chosen?: string) {
    clearPicker();
    cleanup();
    setTimeout(() => {
      if (chosen !== undefined) onSelect(chosen);
      else onCancel();
    }, 20);
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write("\x1b[?25l");

  stdin.on("data", (key: string) => {
    const perRow = getPerRow();
    if (key === "\u0003" || key === "\u001b" || key === "\t") return exit();
    if (key === "\r") return exit(candidates[selectedIndex]);

    let idx = selectedIndex;
    if (key === "\u001b[A") idx -= perRow;
    if (key === "\u001b[B") idx += perRow;
    if (key === "\u001b[C") idx += 1;
    if (key === "\u001b[D") idx -= 1;
    if (key === "\u001b[H") idx = 0;
    if (key === "\u001b[F") idx = candidates.length - 1;

    idx = Math.max(0, Math.min(candidates.length - 1, idx));
    if (idx !== selectedIndex) { selectedIndex = idx; render(); }
  });

  render();
}

export function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;

  for (const ch of line) {
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === " " && !inDouble && !inSingle) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}