import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import chalk from "chalk";
import { w, at, clr, C, R, NAVBAR_ROWS, FOOTER_ROWS, visibleLen, padOrTrim, kb, enterAlt, exitAlt } from "./tui";
import { HistoryEntry } from "./historyManager";
import { getAllAliases } from "./aliases";

type ResultKind = "history" | "file" | "dir" | "executable" | "builtin" | "alias";

interface SearchResult {
  kind:     ResultKind;
  value:    string;
  display:  string;
  sub:      string;
  fullPath: string;
}

const BUILTINS = [
  "exit", "echo", "type", "pwd", "cd", "ls", "dir", "alias", "unalias",
  "clear", "history", "trash", "fshrc", "neofetch",
];

const EDITOR_CANDIDATES = [
  "nvim", "vim", "vi", "nano", "emacs", "micro", "hx", "helix", "code", "gedit",
];

const CATEGORY_ORDER: ResultKind[] = ["history", "dir", "file", "builtin", "alias", "executable"];

const CATEGORY_LABEL: Record<ResultKind, string> = {
  history:    "Command history",
  dir:        "Directories",
  file:       "Files",
  builtin:    "Builtins",
  alias:      "Aliases",
  executable: "Executables",
};

const CATEGORY_ICON: Record<ResultKind, string> = {
  history:    "  ",
  dir:        "▸ ",
  file:       "  ",
  builtin:    "  ",
  alias:      "⚡ ",
  executable: "  ",
};

function shortenPath(p: string): string {
  const home = process.env.HOME ?? "";
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function fuzzyScore(query: string, target: string): number {
  if (query === "") return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q)          return 100;
  if (t.startsWith(q))  return 80;
  if (t.includes(q))    return 60;

  let qi = 0, score = 0, consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { consecutive++; score += 10 + consecutive * 2; qi++; }
    else consecutive = 0;
  }
  if (qi < q.length) return 0;
  return score;
}

function getInstalledEditors(): string[] {
  return EDITOR_CANDIDATES.filter((e) => {
    try { execFileSync("which", [e], { stdio: "ignore" }); return true; }
    catch { return false; }
  });
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "dist", "build", "out", ".next", ".nuxt",
  "__pycache__", ".pytest_cache", ".mypy_cache",
  ".cache", ".npm", ".yarn",
  "proc", "sys", "dev",
]);

function searchFilesystem(query: string, rootDirs: string[], maxResults = 40): SearchResult[] {
  const results: { r: SearchResult; score: number }[] = [];
  const visited = new Set<string>();

  function walk(dir: string, depth: number) {
    if (depth > 4 || results.length > maxResults * 2) return;
    if (visited.has(dir)) return;
    visited.add(dir);

    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (e.name.startsWith(".") && depth > 1) continue;

      const score = fuzzyScore(query, e.name);
      if (score > 0) {
        const full    = path.join(dir, e.name);
        const isDir   = e.isDirectory();
        const parent  = shortenPath(dir);
        results.push({
          r: {
            kind:     isDir ? "dir" : "file",
            value:    e.name,
            display:  e.name,
            sub:      parent,
            fullPath: full,
          },
          score,
        });
      }

      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  }

  for (const root of rootDirs) walk(root, 0);

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((x) => x.r);
}

function searchHistory(query: string, entries: HistoryEntry[]): SearchResult[] {
  return entries
    .map((e) => ({ e, score: fuzzyScore(query, e.cmd) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ e }) => ({
      kind:     "history" as ResultKind,
      value:    e.cmd,
      display:  e.cmd,
      fullPath: "",
      sub:      e.ts
        ? new Date(e.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "",
    }));
}

function searchExecutables(query: string): SearchResult[] {
  if (query.length < 2) return [];
  const seen = new Set<string>();
  const hits: { name: string; score: number; dir: string }[] = [];

  for (const dir of (process.env.PATH ?? "").split(":")) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const score = fuzzyScore(query, entry);
        if (score > 0 && !seen.has(entry)) {
          seen.add(entry);
          hits.push({ name: entry, score, dir });
        }
      }
    } catch {}
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((h) => ({
      kind:     "executable" as ResultKind,
      value:    h.name,
      display:  h.name,
      fullPath: path.join(h.dir, h.name),
      sub:      shortenPath(h.dir),
    }));
}

function searchBuiltins(query: string): SearchResult[] {
  return BUILTINS
    .filter((b) => fuzzyScore(query, b) > 0)
    .map((b) => ({
      kind: "builtin" as ResultKind, value: b, display: b, fullPath: "", sub: "fsh builtin",
    }));
}

function searchAliases(query: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const [name, val] of getAllAliases()) {
    if (fuzzyScore(query, name) > 0)
      results.push({ kind: "alias" as ResultKind, value: name, display: name, fullPath: "", sub: val });
  }
  return results;
}

type Row =
  | { kind: "header"; category: ResultKind; count: number }
  | { kind: "result"; result: SearchResult };

function buildRows(grouped: Map<ResultKind, SearchResult[]>): Row[] {
  const rows: Row[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    rows.push({ kind: "header", category: cat, count: items.length });
    for (const r of items) rows.push({ kind: "result", result: r });
  }
  return rows;
}

function kindColor(kind: ResultKind, hidden = false): (s: string) => string {
  switch (kind) {
    case "history":    return chalk.white;
    case "dir":        return hidden ? chalk.cyan : chalk.blue.bold;
    case "file":       return hidden ? chalk.gray : chalk.white;
    case "builtin":    return chalk.green.bold;
    case "alias":      return chalk.green;
    case "executable": return chalk.hex("#C3E88D");
  }
}

export function showSearch(
  historyEntries: HistoryEntry[],
  onSelect: (value: string) => void,
  onCancel: () => void
) {
  const stdin   = process.stdin;
  let query     = "";
  let selIdx    = 0;
  let scrollTop = 0;
  let rows: Row[]        = [];
  let searching          = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const home     = process.env.HOME ?? "";
  const cwd      = process.cwd();
  const rootDirs = Array.from(new Set([cwd, home])).filter(Boolean);

  function vis(): number {
    return Math.max(1, R() - NAVBAR_ROWS - FOOTER_ROWS - 2);
  }

  function adjustScroll() {
    const v = vis();
    if (selIdx < scrollTop) scrollTop = selIdx;
    if (selIdx >= scrollTop + v) scrollTop = selIdx - v + 1;
  }

  function runSearch() {
    const grouped = new Map<ResultKind, SearchResult[]>();

    if (query.length === 0) {
      grouped.set("history", historyEntries.slice(0, 30).map((e) => ({
        kind: "history" as ResultKind, value: e.cmd, display: e.cmd, fullPath: "",
        sub: e.ts ? new Date(e.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
      })));
    } else {
      const hist  = searchHistory(query, historyEntries);
      const fsRes = searchFilesystem(query, rootDirs);
      const dirs  = fsRes.filter((f) => f.kind === "dir");
      const files = fsRes.filter((f) => f.kind === "file");
      const execs = searchExecutables(query);
      const bltns = searchBuiltins(query);
      const alsas = searchAliases(query);

      if (hist.length)  grouped.set("history",    hist);
      if (dirs.length)  grouped.set("dir",         dirs);
      if (files.length) grouped.set("file",        files);
      if (bltns.length) grouped.set("builtin",     bltns);
      if (alsas.length) grouped.set("alias",       alsas);
      if (execs.length) grouped.set("executable",  execs);
    }

    rows      = buildRows(grouped);
    selIdx    = 0;
    scrollTop = 0;
    const first = rows.findIndex((r) => r.kind === "result");
    if (first >= 0) selIdx = first;
    adjustScroll();
  }

  function totalResults(): number {
    return rows.filter((r) => r.kind === "result").length;
  }

  function buildNavbarStr(): string {
    const cols      = C();
    const rightStr  = ` ${totalResults()} results `;
    const rightLen  = visibleLen(rightStr);
    const available = cols - 2 - rightLen;

    const hints = [
      kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" select  ") + kb("esc") + chalk.gray(" cancel"),
      kb("↑↓") + chalk.gray(" move  ") + kb("esc")   + chalk.gray(" cancel"),
    ];
    let chosen = hints[hints.length - 1];
    for (const h of hints) {
      if (visibleLen(h) <= available) { chosen = h; break; }
    }

    const leftPart  = padOrTrim(" " + chosen, cols - rightLen);
    const rightPart = chalk.bgBlack.dim(rightStr);
    return at(1, 1) + clr() + chalk.bgBlack.white(leftPart) + rightPart +
           at(2, 1) + clr() + chalk.dim("─".repeat(cols));
  }

  function buildSearchBarStr(): string {
    const cols   = C();
    const prefix = chalk.bgBlack.white(" search ") + " ";
    const cursor = chalk.bgWhite.black(" ");
    const padLen = Math.max(0, cols - visibleLen(prefix) - query.length - 1);
    return at(3, 1) + clr() + prefix + chalk.white(query) + cursor + " ".repeat(padLen);
  }

  function buildContentStr(): string {
    const cols = C();
    const v    = vis();
    let out    = "";

    for (let i = 0; i < v; i++) {
      out += at(4 + i, 1) + clr();
      const row = rows[scrollTop + i];
      if (!row) continue;

      const active = (scrollTop + i) === selIdx;

      if (row.kind === "header") {
        const label = `  ${CATEGORY_LABEL[row.category]}  (${row.count})`;
        out += active
          ? chalk.bgYellow.black.bold(label.slice(0, cols).padEnd(cols))
          : chalk.yellow.bold(label.slice(0, cols));
      } else {
        const r      = row.result;
        const icon   = CATEGORY_ICON[r.kind];
        const hidden = r.display.startsWith(".");
        const color  = kindColor(r.kind, hidden);
        const subLen = visibleLen(r.sub);
        const maxDisp = Math.max(8, cols - icon.length - subLen - 6);
        const display = r.display.length > maxDisp
          ? r.display.slice(0, maxDisp - 1) + "…"
          : r.display;
        const left   = ("  " + icon + display).padEnd(cols - subLen - 2);

        out += active
          ? chalk.bgWhite.black.bold(left) + "  " + chalk.bgWhite.dim(r.sub.slice(0, subLen))
          : color(left)                    + "  " + chalk.dim(r.sub);
      }
    }

    for (let i = Math.max(0, rows.length - scrollTop); i < v; i++) {
      out += at(4 + i, 1) + clr();
    }

    const footerRow = 4 + v;
    const more      = rows.length - (scrollTop + v);
    out += at(footerRow, 1) + clr();
    if (rows.length > v) out += chalk.dim(more > 0 ? `  ↓ ${more} more` : "  (end)");
    if (rows.length === 0 && query.length > 0) out += at(4, 1) + clr() + chalk.gray("  (no results)");

    return out;
  }

  function render() {
    w(buildNavbarStr() + buildSearchBarStr() + buildContentStr());
  }

  function fullRedraw() {
    w("\x1b[2J");
    runSearch();
    render();
  }

  function cleanup() {
    if (searchTimer) clearTimeout(searchTimer);
    process.stdout.removeListener("resize", onResize);
    stdin.removeAllListeners("data");
    if (stdin.isTTY) stdin.setRawMode(false);
    exitAlt();
  }

  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      runSearch();
      render();
    }, query.length < 2 ? 0 : 120);
  }

  function handleSelect(result: SearchResult) {
    if (result.kind === "history" || result.kind === "builtin" || result.kind === "alias" || result.kind === "executable") {
      cleanup();
      setTimeout(() => onSelect(result.value), 20);
      return;
    }

    if (result.kind === "dir") {
      showDirAction(result);
      return;
    }

    if (result.kind === "file") {
      showFileAction(result);
      return;
    }
  }

  function showDirAction(result: SearchResult) {
    const cols = C();
    const full = result.fullPath;

    function buildActionNavHints(): string[] {
      return [
        kb("enter") + chalk.gray(" / ") + kb("c") + chalk.gray(" cd into  ") + kb("esc") + chalk.gray(" back"),
        kb("enter") + chalk.gray(" cd  ") + kb("esc") + chalk.gray(" back"),
      ];
    }

    function drawActionScreen() {
      const avail = R() - NAVBAR_ROWS;
      let out = buildNavbarStr();
      let lineNum = 0;

      function line(content: string) {
        if (lineNum >= avail) return;
        out += at(NAVBAR_ROWS + 1 + lineNum, 1) + clr() + content;
        lineNum++;
      }

      line(chalk.blue.bold("▸ " + result.display) + "  " + chalk.dim(result.sub));
      line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));

      try {
        const children = fs.readdirSync(full, { withFileTypes: true }).slice(0, avail - 6);
        if (children.length === 0) {
          line(chalk.gray("  (empty directory)"));
        } else {
          for (const c of children) {
            line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name));
          }
          const total = fs.readdirSync(full).length;
          if (total > avail - 6) line(chalk.gray(`  ... and ${total - (avail - 6)} more`));
        }
      } catch { line(chalk.red("  cannot read directory")); }

      for (let i = lineNum; i < avail - 2; i++) { out += at(NAVBAR_ROWS + 1 + i, 1) + clr(); lineNum++; }
      out += at(R() - 1, 1) + clr() + chalk.dim("─".repeat(Math.min(cols - 2, 60)));
      out += at(R(), 1) + clr() +
        "  " + chalk.bgBlue.white.bold(" enter ") + " " + chalk.white("cd into  ") +
        chalk.bgGray.white(" esc ") + " " + chalk.gray("back to search");
      w(out);
    }

    function onActionResize() { w("\x1b[2J"); drawActionScreen(); }
    process.stdout.removeListener("resize", onResize);
    process.stdout.on("resize", onActionResize);
    stdin.removeListener("data", onKey);

    function onActionKey(k: string) {
      if (k === "\u001b" || k === "\u0003") {
        stdin.removeListener("data", onActionKey);
        process.stdout.removeListener("resize", onActionResize);
        process.stdout.on("resize", onResize);
        w("\x1b[2J");
        render();
        stdin.on("data", onKey);
        return;
      }
      if (k === "\r" || k === "c" || k === "C") {
        stdin.removeListener("data", onActionKey);
        process.stdout.removeListener("resize", onActionResize);
        try { process.chdir(full); } catch {}
        cleanup();
        setTimeout(() => onCancel(), 20);
      }
    }

    stdin.on("data", onActionKey);
    w("\x1b[2J");
    drawActionScreen();
  }

  function showFileAction(result: SearchResult) {
    const full    = result.fullPath;
    const editors = getInstalledEditors();
    const cols    = C();

    if (editors.length === 0) {
      cleanup();
      setTimeout(() => onCancel(), 20);
      return;
    }

    const EW      = Math.max(...editors.map((e) => e.length)) + 2;
    let eSelIdx   = 0;

    function ePerRow(): number { return Math.max(1, Math.floor(C() / EW)); }

    function drawFileScreen() {
      const avail = R() - NAVBAR_ROWS;
      let out = buildNavbarStr();
      let lineNum = 0;

      function line(content: string) {
        if (lineNum >= avail) return;
        out += at(NAVBAR_ROWS + 1 + lineNum, 1) + clr() + content;
        lineNum++;
      }

      const hidden = result.display.startsWith(".");
      const col    = hidden ? chalk.gray : chalk.white;
      line(col("  " + result.display) + "  " + chalk.dim(result.sub));
      line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));

      try {
        const lines = fs.readFileSync(full, "utf8").split("\n").slice(0, avail - 8);
        for (const fl of lines) {
          const d = fl.length > cols - 4 ? fl.slice(0, cols - 5) + "…" : fl;
          line(chalk.white("  " + d));
        }
        const total = fs.readFileSync(full, "utf8").split("\n").length;
        if (total > avail - 8) line(chalk.gray(`  ... ${total - (avail - 8)} more lines`));
      } catch { line(chalk.gray("  (binary file)")); }

      for (let i = lineNum; i < avail - 4; i++) { out += at(NAVBAR_ROWS + 1 + i, 1) + clr(); lineNum++; }

      out += at(R() - 2, 1) + clr() + chalk.dim("─".repeat(Math.min(cols - 2, 60)));
      out += at(R() - 1, 1) + clr() + chalk.gray("  open with:  ");

      const pr   = ePerRow();
      let eLine  = "  ";
      for (let i = 0; i < editors.length; i++) {
        const name   = editors[i].padEnd(EW, " ");
        eLine += i === eSelIdx ? chalk.bgWhite.black.bold(name) : chalk.cyan(name);
      }
      out += at(R(), 1) + clr() + eLine;
      w(out);
    }

    function onFileResize() { w("\x1b[2J"); drawFileScreen(); }
    process.stdout.removeListener("resize", onResize);
    process.stdout.on("resize", onFileResize);
    stdin.removeListener("data", onKey);

    function onFileKey(k: string) {
      if (k === "\u001b" || k === "\u0003") {
        stdin.removeListener("data", onFileKey);
        process.stdout.removeListener("resize", onFileResize);
        process.stdout.on("resize", onResize);
        w("\x1b[2J");
        render();
        stdin.on("data", onKey);
        return;
      }
      if (k === "\r") {
        const chosen = editors[eSelIdx];
        stdin.removeListener("data", onFileKey);
        process.stdout.removeListener("resize", onFileResize);
        cleanup();
        setTimeout(() => onSelect(`${chosen} "${full}"`), 20);
        return;
      }
      const pr = ePerRow();
      let i = eSelIdx;
      if (k === "\u001b[C") i = Math.min(editors.length - 1, i + 1);
      if (k === "\u001b[D") i = Math.max(0, i - 1);
      if (k === "\u001b[A") i = Math.max(0, i - pr);
      if (k === "\u001b[B") i = Math.min(editors.length - 1, i + pr);
      if (i !== eSelIdx) { eSelIdx = i; drawFileScreen(); }
    }

    stdin.on("data", onFileKey);
    w("\x1b[2J");
    drawFileScreen();
  }

  function navigate(key: string): boolean {
    const total = rows.length;
    if (total === 0) return false;
    let next = selIdx;

    if (key === "\u001b[A") {
      next = selIdx - 1;
      while (next >= 0 && rows[next].kind === "header") next--;
      if (next < 0) return false;
    } else if (key === "\u001b[B") {
      next = selIdx + 1;
      while (next < total && rows[next].kind === "header") next++;
      if (next >= total) return false;
    } else { return false; }

    selIdx = next;
    adjustScroll();
    return true;
  }

  function onResize() { w("\x1b[2J"); render(); }

  function onKey(k: string) {
    if (k === "\u0003" || k === "\u001b") {
      cleanup();
      setTimeout(onCancel, 20);
      return;
    }

    if (k === "\r") {
      const row = rows[selIdx];
      if (row?.kind === "result") handleSelect(row.result);
      return;
    }

    if (navigate(k)) { render(); return; }

    if (k === "\x7f" || k === "\u0008") {
      if (query.length > 0) {
        query = query.slice(0, -1);
        scheduleSearch();
        render();
      }
      return;
    }

    if (k.length === 1 && k >= " ") {
      query += k;
      scheduleSearch();
      render();
      return;
    }
  }

  process.stdout.on("resize", onResize);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", onKey);

  enterAlt();
  fullRedraw();
}