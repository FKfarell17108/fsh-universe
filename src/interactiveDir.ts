import fs from "fs";
import path from "path";
import chalk from "chalk";
import { moveToTrash } from "./trash";
import { w, at, clr, C, R, drawNavbar, NavItem, NavRows, drawBottomBar, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";
import { getClipboard, setClipboard, clearClipboard, execCopy, execMove, execRename, uniqueDest, loadLog } from "./fileOps";
import { showFileOpsLog } from "./fileOpsLog";
import { showInlineInput } from "./interactiveLs";

export function interactiveDir(onExit: () => void): void {
  let cwd = process.cwd(); loadLog();
  function loadDirs(dir: string): { name: string; hidden: boolean }[] {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => { try { return e.isDirectory() || (e.isSymbolicLink() && fs.statSync(path.join(dir, e.name)).isDirectory()); } catch { return false; } })
        .map(e => ({ name: e.name, hidden: e.name.startsWith(".") }))
        .sort((a, b) => { if (a.hidden !== b.hidden) return Number(a.hidden) - Number(b.hidden); return a.name.localeCompare(b.name); });
    } catch { return []; }
  }
  let allEntries = loadDirs(cwd); let showHidden = false;
  const visibleEntries = () => showHidden ? allEntries : allEntries.filter(e => !e.hidden);
  let entries = visibleEntries();
  if (!process.stdin.isTTY) { console.log(entries.map(e => e.name).join("  ")); return onExit(); }
  if (allEntries.length === 0) { console.log(chalk.gray("(no subdirectories)")); return onExit(); }
  if (entries.length === 0 && allEntries.length > 0) { showHidden = true; entries = visibleEntries(); }
  if (entries.length === 0) { console.log(chalk.gray("(no subdirectories)")); return onExit(); }

  const stdin = process.stdin;
  let selIdx = 0; let scrollTop = 0; let selected = new Set<string>();
  let statusMsg = ""; let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function NAV(): NavRows {
    const cb = getClipboard() as any;
    return [
      [
        { key: "↑↓←→", label: "Navigate"   },
        { key: "Spc",   label: "Select"     },
        { key: "A",     label: "Select All" },
        { key: "Ent",   label: "Enter Dir"  },
        { key: "Tab",   label: "Parent Dir" },
        { key: "Esc",   label: cb ? "Cancel Clip" : selected.size > 0 ? "Deselect" : "Quit" },
      ],
      [
        { key: "C",  label: "Copy"    },
        { key: "X",  label: "Cut"     },
        { key: "V",  label: "Paste"   },
        { key: "R",  label: "Rename"  },
        { key: "M",  label: "Move To" },
        { key: "D",  label: "Delete"  },
        { key: ".",  label: showHidden ? "Hide Hidden" : "Show Hidden" },
        { key: "H",  label: "History" },
      ],
    ];
  }

  const NR = 3;
  function cw(): number { return !entries.length ? 16 : Math.max(...entries.map(e => e.name.length)) + 4; }
  function pr(): number { return Math.max(1, Math.floor(C() / cw())); }
  function tr(): number { return Math.ceil(entries.length / pr()); }
  function vis(): number { return Math.max(1, R() - NR - 2); }
  function adjustScroll(): void { const row = Math.floor(selIdx / pr()); const v = vis(); if (row < scrollTop) scrollTop = row; if (row >= scrollTop + v) scrollTop = row - v + 1; }

  function navigate(key: string): boolean {
    const p = pr(); const total = entries.length; if (!total) return false;
    const curRow = Math.floor(selIdx / p); const curCol = selIdx % p; let next = selIdx;
    if (key === "\u001b[A") { if (curRow === 0) return false; next = (curRow - 1) * p + curCol; if (next >= total) next = total - 1; }
    else if (key === "\u001b[B") { if (curRow >= tr() - 1) return false; next = (curRow + 1) * p + curCol; if (next >= total) next = total - 1; }
    else if (key === "\u001b[D") { if (curCol === 0) { if (curRow === 0) return false; next = (curRow - 1) * p + Math.min(p - 1, total - 1 - (curRow - 1) * p); } else next = selIdx - 1; }
    else if (key === "\u001b[C") { if (selIdx >= total - 1) return false; if (curCol >= p - 1 || selIdx + 1 >= total) { const ns = (curRow + 1) * p; if (ns >= total) return false; next = ns; } else next = selIdx + 1; }
    else if (key === "\u001b[H") { next = 0; } else if (key === "\u001b[F") { next = total - 1; }
    else return false;
    next = Math.max(0, Math.min(total - 1, next)); if (next === selIdx) return false; selIdx = next; adjustScroll(); return true;
  }

  function toggleSelect(): void { if (!entries.length) return; const n = entries[selIdx].name; if (selected.has(n)) selected.delete(n); else selected.add(n); }
  function selectAll(): void { if (selected.size === entries.length) selected.clear(); else selected = new Set(entries.map(e => e.name)); }
  function getTargets() { if (selected.size > 0) return entries.filter(e => selected.has(e.name)); return entries.length ? [entries[selIdx]] : []; }

  function buildLeft(): string {
    const home = process.env.HOME ?? ""; const rel = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
    const hidC = allEntries.filter(e => e.hidden).length; const cb = getClipboard() as any;
    let s = rel; s += `  ${entries.length}d`;
    if (!showHidden && hidC) s += chalk.dim(`  ${hidC} hidden`);
    if (selected.size) s += chalk.magenta(`  ${selected.size} sel`);
    if (cb) s += (cb.kind === "copy" ? chalk.cyan("  ⎘ ") : chalk.yellow("  ✂ ")) + chalk.dim(cb.srcName.slice(0, 20));
    return s;
  }
  function buildRight(): string { if (tr() <= vis()) return ""; const more = tr() - (scrollTop + vis()); return more > 0 ? `↓ ${more} more` : "end"; }
  function drawBottom(): void {
    if (statusMsg) { w(at(R(), 1) + clr() + statusMsg); return; }
    drawBottomBar(buildLeft(), buildRight());
  }
  function showStatus(msg: string, isErr = false): void {
    if (statusTimer) clearTimeout(statusTimer);
    statusMsg = isErr ? chalk.red(msg) : chalk.green(msg); drawBottom();
    statusTimer = setTimeout(() => { statusMsg = ""; drawBottom(); statusTimer = null; }, 2000);
  }

  function drawContent(): void {
    const start = NR + 2; const p = pr(); const cWidth = cw(); const v = vis();
    let out = "";
    for (let row = 0; row < v; row++) {
      out += at(start + row, 1) + clr(); const fr = scrollTop + row; let line = " ";
      for (let col = 0; col < p; col++) {
        const i = fr * p + col; if (i >= entries.length) break;
        const { name, hidden } = entries[i]; const isCursor = i === selIdx; const isSel = selected.has(name);
        const cb = getClipboard() as any; const clipped = cb && !cb.items && cb.srcPath === path.join(cwd, name);
        const prefix = isSel ? "✓ " : "  "; const padded = (prefix + name).padEnd(cWidth, " ");
        if (isCursor && isSel) line += chalk.bgMagenta.white.bold(padded);
        else if (isCursor) line += chalk.bgWhite.black.bold(padded);
        else if (isSel) line += chalk.magenta(padded);
        else if (clipped) line += cb.kind === "copy" ? chalk.cyan.underline(padded) : chalk.yellow.underline(padded);
        else if (hidden) line += chalk.cyan(padded);
        else line += chalk.blue.bold(padded);
      }
      out += line;
    }
    w(out);
  }

  function render(): void { drawNavbar(NAV()); drawContent(); drawBottom(); }
  function fullRedraw(): void { clearScreen(); adjustScroll(); render(); }
  function cleanup(): void { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); exitAlt(); }
  function exit(): void { process.chdir(cwd); cleanup(); setTimeout(onExit, 50); }

  function buildMultiClip(kind: "copy" | "cut") { const targets = getTargets(); const items = targets.map(t => ({ srcPath: path.join(cwd, t.name), srcName: t.name, isDir: true })); return { kind, srcPath: items[0].srcPath, srcName: items.length === 1 ? items[0].srcName : `${items.length} dirs`, isDir: true, items }; }
  function doCopy(): void { const t = getTargets(); if (!t.length) return; setClipboard(buildMultiClip("copy") as any); render(); }
  function doCut(): void { const t = getTargets(); if (!t.length) return; setClipboard(buildMultiClip("cut") as any); render(); }

  function doPaste(): void {
    const cb = getClipboard() as any; if (!cb) { showStatus("  nothing in clipboard", true); return; }
    const items: { srcPath: string; srcName: string; isDir: boolean }[] = cb.items ?? [{ srcPath: cb.srcPath, srcName: cb.srcName, isDir: cb.isDir }];
    let errors = 0; for (const item of items) { const err = cb.kind === "copy" ? execCopy(item.srcPath, uniqueDest(cwd, item.srcName)) : execMove(item.srcPath, uniqueDest(cwd, item.srcName)); if (err) errors++; }
    if (cb.kind === "cut") clearClipboard(); selected.clear();
    if (errors > 0) showStatus(`  ${errors} error(s) during paste`, true); else showStatus(`  ${cb.kind === "copy" ? "Copied" : "Moved"}: ${items.length} item${items.length > 1 ? "s" : ""}`);
    allEntries = loadDirs(cwd); entries = visibleEntries(); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); adjustScroll(); render();
  }

  function doRename(): void {
    if (!entries.length) return; if (selected.size > 1) { showStatus("  rename: select one item at a time", true); return; }
    const e = entries[selIdx]; const full = path.join(cwd, e.name);
    process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey);
    showInlineInput(stdin, "Rename:", e.name,
      (newName) => {
        process.stdout.on("resize", onResize);
        if (!newName || newName === e.name) { fullRedraw(); stdin.on("data", onKey); return; }
        if (fs.existsSync(path.join(cwd, newName))) { showStatus(`  '${newName}' already exists`, true); fullRedraw(); stdin.on("data", onKey); return; }
        const err = execRename(full, newName); if (err) showStatus("  Error: " + err, true); else showStatus(`  Renamed: ${e.name}  →  ${newName}`);
        selected.clear(); allEntries = loadDirs(cwd); entries = visibleEntries();
        const idx = entries.findIndex(e2 => e2.name === newName); selIdx = idx >= 0 ? idx : Math.min(selIdx, Math.max(0, entries.length - 1));
        adjustScroll(); fullRedraw(); stdin.on("data", onKey);
      },
      () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function doMoveTo(): void {
    const targets = getTargets(); if (!targets.length) return;
    process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey);
    showInlineInput(stdin, "Move to:", cwd + "/",
      (destDir) => {
        process.stdout.on("resize", onResize);
        const expanded = destDir.replace(/^~/, process.env.HOME ?? "~").replace(/\/$/, "");
        if (!fs.existsSync(expanded)) { try { fs.mkdirSync(expanded, { recursive: true }); } catch (ex: any) { showStatus("  Error: " + ex.message, true); fullRedraw(); stdin.on("data", onKey); return; } }
        let errors = 0; for (const t of targets) { const err = execMove(path.join(cwd, t.name), uniqueDest(expanded, t.name)); if (err) errors++; }
        selected.clear();
        if (errors > 0) { showStatus(`  ${errors} error(s)`, true); } else { const home = process.env.HOME ?? ""; const rel = expanded.startsWith(home) ? "~" + expanded.slice(home.length) : expanded; showStatus(`  Moved ${targets.length} item${targets.length > 1 ? "s" : ""}  →  ${rel}`); }
        allEntries = loadDirs(cwd); entries = visibleEntries(); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); adjustScroll(); fullRedraw(); stdin.on("data", onKey);
      },
      () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function reloadEntries(newCwd: string, restoreName?: string): void {
    cwd = newCwd; allEntries = loadDirs(cwd); entries = visibleEntries();
    if (!entries.length && allEntries.length) { showHidden = true; entries = visibleEntries(); }
    selIdx = 0; scrollTop = 0; if (restoreName) { const idx = entries.findIndex(e => e.name === restoreName); if (idx >= 0) selIdx = idx; } adjustScroll();
  }
  function goUp(): void { const parent = path.dirname(cwd); if (parent === cwd) return; const prev = path.basename(cwd); reloadEntries(parent, prev); if (!entries.length) { process.chdir(cwd); return exit(); } render(); }
  function goInto(name: string): void { const target = path.join(cwd, name); reloadEntries(target); if (!entries.length) { process.chdir(target); return exit(); } render(); }
  function toggleHidden(): void { const prev = entries[selIdx]?.name; showHidden = !showHidden; entries = visibleEntries(); selIdx = 0; scrollTop = 0; if (prev) { const idx = entries.findIndex(e => e.name === prev); if (idx >= 0) selIdx = idx; } adjustScroll(); render(); }

  function showDeleteConfirm(): void {
    const targets = getTargets(); if (!targets.length) return; const multi = targets.length > 1;
    const confirmNav: NavItem[] = [{ key: "Y", label: "Move to Trash" }, { key: "N/Esc", label: "Cancel" }];
    function drawConfirm(): void {
      const start = 3; const avail = R() - 3; const cols = C();
      drawNavbar(confirmNav, confirmNav.length);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(start + ln, 1) + clr() + s; ln++; }
      if (multi) {
        line(chalk.bold(`  Move ${targets.length} dirs to trash`)); line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));
        for (const t of targets.slice(0, avail - 3)) line(chalk.blue("  ▸ ") + chalk.white(t.name));
        if (targets.length > avail - 3) line(chalk.gray(`  ... and ${targets.length - (avail - 3)} more`));
      } else {
        const full = path.join(cwd, targets[0].name); line(chalk.bold("  dir  " + targets[0].name)); line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));
        try { const ch = fs.readdirSync(full, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, avail - 3)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > avail - 3) line(chalk.gray(`  ... and ${ch.length - (avail - 3)} more`)); } } catch { line(chalk.red("  cannot read directory")); }
      }
      for (let i = ln; i < avail; i++) out += at(start + i, 1) + clr();
      w(out); drawBottomBar("Move to Trash?", "");
    }
    process.stdout.removeListener("resize", onResize);
    const onCR = () => { clearScreen(); drawConfirm(); }; process.stdout.on("resize", onCR); stdin.removeListener("data", onKey);
    function onConfirm(k: string): void {
      if (k === "y" || k === "Y") {
        stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onCR); process.stdout.on("resize", onResize);
        let errors = 0; for (const t of targets) { try { moveToTrash(path.join(cwd, t.name)); allEntries = allEntries.filter(e => e.name !== t.name); } catch { errors++; } }
        entries = visibleEntries(); selected.clear();
        if (!entries.length && !allEntries.length) { process.chdir(cwd); return exit(); }
        if (errors) showStatus(`  ${errors} error(s)`, true); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); stdin.on("data", onKey); fullRedraw(); return;
      }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onCR); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }
    }
    stdin.on("data", onConfirm); clearScreen(); drawConfirm();
  }

  function openLog(): void { process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey); showFileOpsLog(() => { enterAlt(); process.stdout.on("resize", onResize); clearScreen(); fullRedraw(); stdin.on("data", onKey); }); }
  function onResize(): void { fullRedraw(); }
  function onKey(k: string): void {
    if (k === "\u0003") { process.chdir(cwd); return exit(); }
    if (k === "\u001b") { if (getClipboard()) { clearClipboard(); render(); } else if (selected.size > 0) { selected.clear(); render(); } else { process.chdir(cwd); exit(); } return; }
    if (k === "h") { openLog(); return; }
    if (k === "\r") { if (entries.length) goInto(entries[selIdx].name); return; }
    if (k === "\t") { goUp(); return; } if (k === ".") { toggleHidden(); return; }
    if (k === " ") { toggleSelect(); render(); return; } if (k === "a") { selectAll(); render(); return; }
    if (k === "c") { doCopy(); return; } if (k === "x") { doCut(); return; } if (k === "v") { doPaste(); return; }
    if (k === "r") { doRename(); return; } if (k === "m") { doMoveTo(); return; }
    if (k === "d" || k === "D") { if (entries.length) showDeleteConfirm(); return; }
    if (navigate(k)) render();
  }
  process.stdout.on("resize", onResize); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8"); stdin.on("data", onKey);
  enterAlt(); fullRedraw();
}