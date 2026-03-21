import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getAllAliases } from "./aliases";
import { w, at, clr, C, R, drawNavbar, NavItem, drawBottomBar, enterAlt, exitAlt, clearScreen, visibleLen } from "./tui";

const BUILTINS = ["exit", "echo", "type", "pwd", "cd", "ls", "dir", "alias", "unalias", "clear", "history", "trash", "fshrc", "neofetch"];

export function getCandidates(line: string): { candidates: string[]; partial: string } {
  const tokens = tokenizeLine(line); const isFirstWord = tokens.length === 0 || (tokens.length === 1 && !line.endsWith(" "));
  if (isFirstWord) { const partial = tokens[0] ?? ""; return { candidates: getCommandCandidates(partial), partial }; }
  else { const partial = line.endsWith(" ") ? "" : tokens[tokens.length - 1]; const { candidates } = getFileCandidates(partial); return { candidates, partial }; }
}

function getCommandCandidates(partial: string): string[] {
  const candidates: string[] = []; const seen = new Set<string>();
  for (const b of BUILTINS) { if (b.startsWith(partial)) { candidates.push(b); seen.add(b); } }
  for (const name of getAllAliases().keys()) { if (name.startsWith(partial) && !seen.has(name)) { candidates.push(name); seen.add(name); } }
  for (const dir of (process.env.PATH ?? "").split(":")) { try { for (const entry of fs.readdirSync(dir)) { if (!entry.startsWith(partial) || seen.has(entry)) continue; try { fs.accessSync(path.join(dir, entry), fs.constants.X_OK); candidates.push(entry); seen.add(entry); } catch {} } } catch {} }
  return candidates.sort();
}

export function getFileCandidates(partial: string): { candidates: string[]; baseDir: string; prefix: string } {
  let dir: string; let prefix: string;
  if (partial === "" || partial === ".") { dir = process.cwd(); prefix = ""; }
  else if (partial.startsWith("~/")) { const home = process.env.HOME ?? ""; const rest = partial.slice(2); const ls = rest.lastIndexOf("/"); dir = ls === -1 ? home : path.join(home, rest.slice(0, ls)); prefix = ls === -1 ? rest : rest.slice(ls + 1); }
  else if (partial.includes("/")) { const ls = partial.lastIndexOf("/"); dir = path.resolve(partial.slice(0, ls) || "/"); prefix = partial.slice(ls + 1); }
  else { dir = process.cwd(); prefix = partial; }
  let entries: fs.Dirent[] = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
  const candidates = entries.filter(e => e.name.startsWith(prefix))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map(e => { const name = e.name + (e.isDirectory() ? "/" : ""); if (partial.startsWith("~/")) { const rest = partial.slice(2); const ls = rest.lastIndexOf("/"); return (ls === -1 ? "~/" : "~/" + rest.slice(0, ls + 1)) + name; } if (partial.includes("/")) return partial.slice(0, partial.lastIndexOf("/") + 1) + name; return name; });
  return { candidates, baseDir: dir, prefix };
}

export function commonPrefix(strs: string[]): string {
  if (!strs.length) return ""; let prefix = strs[0];
  for (const s of strs.slice(1)) { while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1); if (!prefix) break; }
  return prefix;
}

export function showPicker(candidates: string[], onSelect: (chosen: string) => void, onCancel: () => void, onHistory?: () => void): void {
  if (!candidates.length) return onCancel();
  const stdin = process.stdin; let selIdx = 0; let scrollTop = 0;

  function NAV(): NavItem[] {
    const items: NavItem[] = [{ key: "↑↓←→", label: "Navigate" }, { key: "Ent", label: "Select" }, { key: "Esc", label: "Cancel" }];
    if (onHistory) items.push({ key: "Tab", label: "History" });
    return items;
  }
  const NR = 2;

  function cw(): number { return Math.max(Math.max(...candidates.map(c => c.length)) + 2, 16); }
  function pr(): number { return Math.max(1, Math.floor(C() / cw())); }
  function tr(): number { return Math.ceil(candidates.length / pr()); }
  function vis(): number { return Math.max(1, R() - NR - 2); }
  function adjustScroll(): void { const row = Math.floor(selIdx / pr()); const v = vis(); if (row < scrollTop) scrollTop = row; if (row >= scrollTop + v) scrollTop = row - v + 1; }

  function buildLeft(): string {
    const dirs = candidates.filter(c => c.endsWith("/")).length; const cmds = candidates.length - dirs;
    const parts: string[] = []; if (dirs > 0) parts.push(`${dirs}d`); if (cmds > 0) parts.push(`${cmds} item${cmds === 1 ? "" : "s"}`);
    if (!parts.length) parts.push(`${candidates.length} items`); return parts.join("  ");
  }
  function buildRight(): string { if (tr() <= vis()) return ""; const more = tr() - (scrollTop + vis()); return more > 0 ? `↓ ${more} more` : "end"; }

  function drawContent(): void {
    const start = NR + 2; const p = pr(); const c = cw(); const v = vis(); let out = "";
    for (let row = 0; row < v; row++) {
      out += at(start + row, 1) + clr(); const fr = scrollTop + row; let line = " ";
      for (let col = 0; col < p; col++) {
        const i = fr * p + col; if (i >= candidates.length) break;
        const name = candidates[i]; const padded = name.padEnd(c, " "); const isSel = i === selIdx; const isDir = name.endsWith("/");
        if      (isSel)  line += chalk.bgWhite.black.bold(padded);
        else if (isDir)  line += name.startsWith(".") ? chalk.cyan(padded) : chalk.blue.bold(padded);
        else             line += name.startsWith(".") ? chalk.gray(padded) : chalk.white(padded);
      }
      out += line;
    }
    w(out);
  }
  function render(): void { drawNavbar(NAV(), NAV().length); drawContent(); drawBottomBar(buildLeft(), buildRight()); }
  function fullRedraw(): void { clearScreen(); adjustScroll(); render(); }
  function cleanup(): void { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); exitAlt(); }
  function exit(chosen?: string): void { cleanup(); setTimeout(() => { if (chosen !== undefined) onSelect(chosen); else onCancel(); }, 20); }
  function onResize(): void { fullRedraw(); }
  process.stdout.on("resize", onResize); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  stdin.on("data", (key: string) => {
    const p = pr();
    if (key === "\u0003" || key === "\u001b") { exit(); return; }
    if (key === "\t" && onHistory) { cleanup(); setTimeout(onHistory, 20); return; }
    if (key === "\r") { exit(candidates[selIdx]); return; }
    let idx = selIdx;
    if      (key === "\u001b[A") idx -= p; else if (key === "\u001b[B") idx += p;
    else if (key === "\u001b[C") idx += 1; else if (key === "\u001b[D") idx -= 1;
    else if (key === "\u001b[H") idx = 0; else if (key === "\u001b[F") idx = candidates.length - 1;
    idx = Math.max(0, Math.min(candidates.length - 1, idx));
    if (idx !== selIdx) { selIdx = idx; adjustScroll(); drawContent(); drawBottomBar(buildLeft(), buildRight()); }
  });
  enterAlt(); fullRedraw();
}

export function tokenizeLine(line: string): string[] {
  const tokens: string[] = []; let current = ""; let inDouble = false; let inSingle = false;
  for (const ch of line) {
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === " " && !inDouble && !inSingle) { if (current) { tokens.push(current); current = ""; } continue; }
    current += ch;
  }
  if (current) tokens.push(current); return tokens;
}