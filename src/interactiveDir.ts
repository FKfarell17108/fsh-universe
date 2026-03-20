import fs from "fs";
import path from "path";
import chalk from "chalk";
import { moveToTrash } from "./trash";
import { w, at, clr, C, R, NAVBAR_ROWS, FOOTER_ROWS, getNR, drawNavbar, drawFooter, kb, enterAlt, exitAlt, visibleLen, padOrTrim } from "./tui";
import { getClipboard, setClipboard, clearClipboard, execCopy, execMove, execRename, uniqueDest, loadLog } from "./fileOps";
import { showFileOpsLog } from "./fileOpsLog";

export function interactiveDir(onExit: () => void) {
  let cwd = process.cwd();
  loadLog();

  function loadDirs(dir: string): { name: string; hidden: boolean }[] {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => { try { return e.isDirectory() || (e.isSymbolicLink() && fs.statSync(path.join(dir, e.name)).isDirectory()); } catch { return false; } })
        .map((e) => ({ name: e.name, hidden: e.name.startsWith(".") }))
        .sort((a, b) => { if (a.hidden !== b.hidden) return Number(a.hidden) - Number(b.hidden); return a.name.localeCompare(b.name); });
    } catch { return []; }
  }

  let allEntries = loadDirs(cwd);
  let showHidden = false;
  function visibleEntries() { return showHidden ? allEntries : allEntries.filter((e) => !e.hidden); }
  let entries = visibleEntries();

  if (!process.stdin.isTTY) { console.log(entries.map((e) => e.name).join("  ")); return onExit(); }
  if (allEntries.length === 0) { console.log(chalk.gray("(no subdirectories)")); return onExit(); }
  if (entries.length === 0 && allEntries.length > 0) { showHidden = true; entries = visibleEntries(); }
  if (entries.length === 0) { console.log(chalk.gray("(no subdirectories)")); return onExit(); }

  const stdin   = process.stdin;
  let selIdx    = 0;
  let scrollTop = 0;

  function cw() { if (!entries.length) return 16; return Math.max(...entries.map((e) => e.name.length)) + 2; }
  function pr() { return Math.max(1, Math.floor(C() / cw())); }
  function tr() { return Math.ceil(entries.length / pr()); }
  function vis() { return Math.max(1, R() - getNR() - FOOTER_ROWS); }

  function adjustScroll() { const row = Math.floor(selIdx / pr()); const v = vis(); if (row < scrollTop) scrollTop = row; if (row >= scrollTop + v) scrollTop = row - v + 1; }

  function navigate(key: string): boolean {
    const p = pr(); const total = entries.length; if (!total) return false;
    const curRow = Math.floor(selIdx / p); const curCol = selIdx % p; let next = selIdx;
    if      (key === "\u001b[A") { if (curRow === 0) return false; next = (curRow - 1) * p + curCol; if (next >= total) next = total - 1; }
    else if (key === "\u001b[B") { if (curRow >= tr() - 1) return false; next = (curRow + 1) * p + curCol; if (next >= total) next = total - 1; }
    else if (key === "\u001b[D") { if (curCol === 0) { if (curRow === 0) return false; next = (curRow - 1) * p + Math.min(p - 1, total - 1 - (curRow - 1) * p); } else next = selIdx - 1; }
    else if (key === "\u001b[C") { if (selIdx >= total - 1) return false; if (curCol >= p - 1 || selIdx + 1 >= total) { const ns = (curRow + 1) * p; if (ns >= total) return false; next = ns; } else next = selIdx + 1; }
    else if (key === "\u001b[H") { next = 0; }
    else if (key === "\u001b[F") { next = total - 1; }
    else return false;
    next = Math.max(0, Math.min(total - 1, next));
    if (next === selIdx) return false;
    selIdx = next; adjustScroll(); return true;
  }

  function clipBadge(): string {
    const cb = getClipboard(); if (!cb) return "";
    const icon = cb.kind === "copy" ? chalk.cyan("⎘") : chalk.yellow("✂");
    const short = cb.srcName.length > 16 ? cb.srcName.slice(0, 15) + "…" : cb.srcName;
    return "  " + icon + chalk.dim(" " + short + "  ") + chalk.dim.underline("esc") + chalk.dim(" cancel");
  }

  function navRight() { return `${tr()}R × ${pr()}C`; }

  function statLeft(): string {
    const hidC = allEntries.filter((e) => e.hidden).length;
    const parts: string[] = [`${entries.length} ${entries.length === 1 ? "dir" : "dirs"}`];
    if (!showHidden && hidC > 0) parts.push(chalk.dim(`${hidC} hidden`));
    return parts.join("  ");
  }

  function cwdLabel(): string {
    const home = process.env.HOME ?? "";
    return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  }

  function buildNavHints(): string[] {
    const r = tr(); const v = vis();
    const si  = r > v ? chalk.dim(` [row ${Math.floor(selIdx / pr()) + 1}/${r}]`) : "";
    const dot = showHidden ? " hide hidden  " : " show hidden  ";
    const cb  = clipBadge();
    const esc = getClipboard() ? " cancel clipboard" : " quit";
    return [
      kb("↑↓←→") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" cd  ") + kb("tab") + chalk.gray(" up  ") + kb("c") + chalk.gray(" copy  ") + kb("x") + chalk.gray(" cut  ") + kb("v") + chalk.gray(" paste  ") + kb("r") + chalk.gray(" rename  ") + kb("m") + chalk.gray(" move  ") + kb("d") + chalk.gray(" delete  ") + kb("^H") + chalk.gray(" log  ") + kb(".") + chalk.gray(dot) + kb("esc") + chalk.gray(esc) + cb + si,
      kb("↑↓←→") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" cd  ") + kb("tab") + chalk.gray(" up  ") + kb("c") + chalk.gray(" copy  ") + kb("x") + chalk.gray(" cut  ") + kb("v") + chalk.gray(" paste  ") + kb("r") + chalk.gray(" rename  ") + kb("d") + chalk.gray(" del  ") + kb("^H") + chalk.gray(" log  ") + kb("esc") + chalk.gray(esc) + cb + si,
      kb("↑↓←→") + chalk.gray(" move  ") + kb("tab") + chalk.gray(" up  ") + kb("c") + chalk.gray(" copy  ") + kb("x") + chalk.gray(" cut  ") + kb("v") + chalk.gray(" paste  ") + kb("r") + chalk.gray(" rename  ") + kb("d") + chalk.gray(" del  ") + kb("esc") + chalk.gray(esc) + si,
      kb("↑↓←→") + chalk.gray(" move  ") + kb("tab") + chalk.gray(" up  ") + kb("c") + chalk.gray(" copy  ") + kb("v") + chalk.gray(" paste  ") + kb("esc") + chalk.gray(esc) + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("tab") + chalk.gray(" up  ") + kb("esc") + chalk.gray(esc),
    ];
  }

  function render() {
    drawNavbar(buildNavHints(), navRight());
    const p = pr(); const c = cw(); const v = vis();
    let out = "";
    for (let row = 0; row < v; row++) {
      out += at(getNR() + 1 + row, 1) + clr();
      const fr = scrollTop + row; let line = " ";
      for (let col = 0; col < p; col++) {
        const i = fr * p + col; if (i >= entries.length) break;
        const { name, hidden } = entries[i]; const isSel = i === selIdx; const padded = name.padEnd(c, " ");
        const cb = getClipboard(); const clipped = cb && cb.srcPath === path.join(cwd, name);
        if (isSel)       line += chalk.bgWhite.black.bold(padded);
        else if (clipped) line += cb!.kind === "copy" ? chalk.cyan.underline(padded) : chalk.yellow.underline(padded);
        else if (hidden)  line += chalk.cyan(padded);
        else              line += chalk.blue.bold(padded);
      }
      out += line;
    }
    const more = tr() - (scrollTop + v); const ls = "  " + statLeft(); const rs2 = tr() > v ? (more > 0 ? `  ↓ ${more} more  ·  ` : "  ") : "  "; const cwdStr = cwdLabel() + "  ";
    const rightFull = rs2 + cwdStr; const gap = Math.max(0, C() - visibleLen(ls) - visibleLen(rightFull));
    out += at(getNR() + 1 + v, 1) + clr() + chalk.dim(ls) + " ".repeat(gap) + chalk.dim(rightFull);
    w(out);
  }

  function fullRedraw() { w("\x1b[2J"); adjustScroll(); render(); }

  function cleanup() { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); exitAlt(); }
  function exit() { process.chdir(cwd); cleanup(); setTimeout(onExit, 50); }

  function showStatus(msg: string, isErr = false) {
    w(at(R(), 1) + clr() + (isErr ? chalk.red(msg) : chalk.green(msg)));
    setTimeout(() => w(at(R(), 1) + clr()), 2000);
  }

  function doCopy() { if (!entries.length) return; const e = entries[selIdx]; setClipboard({ kind: "copy", srcPath: path.join(cwd, e.name), srcName: e.name, isDir: true }); render(); }
  function doCut()  { if (!entries.length) return; const e = entries[selIdx]; setClipboard({ kind: "cut",  srcPath: path.join(cwd, e.name), srcName: e.name, isDir: true }); render(); }

  function doPaste() {
    const cb = getClipboard(); if (!cb) { showStatus("  nothing in clipboard", true); return; }
    const dest = uniqueDest(cwd, cb.srcName); const err = cb.kind === "copy" ? execCopy(cb.srcPath, dest) : execMove(cb.srcPath, dest);
    if (!err && cb.kind === "cut") clearClipboard();
    if (err) showStatus("  Error: " + err, true); else showStatus(`  ${cb.kind === "copy" ? "Copied" : "Moved"}: ${cb.srcName}  →  ${path.basename(dest)}`);
    allEntries = loadDirs(cwd); entries = visibleEntries(); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); adjustScroll(); render();
  }

  function showInlineInput(label: string, defVal: string, onSubmit: (v: string) => void, onCancel: () => void) {
    let value = defVal; let cursor = value.length;
    const rows = R(); const cols = C();
    function draw() { w(at(rows - 1, 1) + clr() + chalk.dim("─".repeat(cols))); w(at(rows, 1) + clr() + chalk.bgBlack.white(padOrTrim(" " + label + " " + value, cols))); w(`\x1b[${rows};${2 + label.length + 1 + cursor}H\x1b[?25h`); }
    stdin.setRawMode(false); stdin.removeListener("data", onKey); draw();
    function onData(chunk: Buffer | string) {
      const s = chunk.toString("utf8");
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]; const code = ch.charCodeAt(0);
        if (ch === "\r" || ch === "\n") { w("\x1b[?25l" + at(rows - 1, 1) + clr() + at(rows, 1) + clr()); stdin.removeListener("data", onData); stdin.setRawMode(true); onSubmit(value.trim()); return; }
        if (ch === "\u001b" || ch === "\u0003") { w("\x1b[?25l" + at(rows - 1, 1) + clr() + at(rows, 1) + clr()); stdin.removeListener("data", onData); stdin.setRawMode(true); onCancel(); return; }
        if (ch === "\x7f" || code === 8) { if (cursor > 0) { value = value.slice(0, cursor - 1) + value.slice(cursor); cursor--; } }
        else if (code >= 32) { value = value.slice(0, cursor) + ch + value.slice(cursor); cursor++; }
        draw();
      }
    }
    stdin.on("data", onData);
  }

  function doRename() {
    if (!entries.length) return;
    const e = entries[selIdx]; const full = path.join(cwd, e.name);
    showInlineInput("Rename:", e.name,
      (newName) => {
        if (!newName || newName === e.name) { fullRedraw(); stdin.on("data", onKey); return; }
        if (fs.existsSync(path.join(cwd, newName))) { showStatus(`  '${newName}' already exists`, true); fullRedraw(); stdin.on("data", onKey); return; }
        const err = execRename(full, newName);
        if (err) showStatus("  Error: " + err, true); else showStatus(`  Renamed: ${e.name}  →  ${newName}`);
        allEntries = loadDirs(cwd); entries = visibleEntries(); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); adjustScroll(); fullRedraw(); stdin.on("data", onKey);
      },
      () => { fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function doMoveTo() {
    if (!entries.length) return;
    const e = entries[selIdx]; const full = path.join(cwd, e.name);
    showInlineInput("Move to:", cwd + "/",
      (destDir) => {
        const expanded = destDir.replace(/^~/, process.env.HOME ?? "~").replace(/\/$/, "");
        if (!fs.existsSync(expanded)) { try { fs.mkdirSync(expanded, { recursive: true }); } catch (ex: any) { showStatus("  Error: " + ex.message, true); fullRedraw(); stdin.on("data", onKey); return; } }
        const dest = uniqueDest(expanded, e.name); const err = execMove(full, dest);
        const home = process.env.HOME ?? ""; const rel = dest.startsWith(home) ? "~" + dest.slice(home.length) : dest;
        if (err) showStatus("  Error: " + err, true); else showStatus(`  Moved: ${e.name}  →  ${rel}`);
        allEntries = loadDirs(cwd); entries = visibleEntries(); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); adjustScroll(); fullRedraw(); stdin.on("data", onKey);
      },
      () => { fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function onResize() { fullRedraw(); }

  function reloadEntries(newCwd: string, restoreName?: string) {
    cwd = newCwd; allEntries = loadDirs(cwd); entries = visibleEntries();
    if (!entries.length && allEntries.length) { showHidden = true; entries = visibleEntries(); }
    selIdx = 0; scrollTop = 0;
    if (restoreName) { const idx = entries.findIndex((e) => e.name === restoreName); if (idx >= 0) selIdx = idx; }
    adjustScroll();
  }

  function goUp() { const parent = path.dirname(cwd); if (parent === cwd) return; const prev = path.basename(cwd); reloadEntries(parent, prev); if (!entries.length) { process.chdir(cwd); return exit(); } render(); }

  function goInto(name: string) { const target = path.join(cwd, name); reloadEntries(target); if (!entries.length) { process.chdir(target); return exit(); } render(); }

  function toggleHidden() { const prev = entries[selIdx]?.name; showHidden = !showHidden; entries = visibleEntries(); selIdx = 0; scrollTop = 0; if (prev) { const idx = entries.findIndex((e) => e.name === prev); if (idx >= 0) selIdx = idx; } adjustScroll(); render(); }

  function showDeleteConfirm(entryName: string) {
    const full = path.join(cwd, entryName);
    function drawConfirm() {
      const cols = C(); const avail = R() - getNR();
      drawNavbar([kb("y") + chalk.gray(" confirm  ") + kb("n") + chalk.gray(" / ") + kb("esc") + chalk.gray(" cancel"), kb("y") + chalk.gray(" yes  ") + kb("esc") + chalk.gray(" no")], navRight());
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
      line(chalk.bold("  dir  " + entryName)); line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));
      try { const ch = fs.readdirSync(full, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, avail - 6)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > avail - 6) line(chalk.gray(`  ... and ${ch.length - (avail - 6)} more`)); } }
      catch { line(chalk.red("  cannot read directory")); }
      for (let i = ln; i < avail - 2; i++) { out += at(getNR() + 1 + i, 1) + clr(); ln++; }
      out += at(R() - 1, 1) + clr() + chalk.dim("─".repeat(Math.min(cols - 2, 60)));
      out += at(R(), 1) + clr() + "  " + chalk.yellow.bold("Move to Trash") + ": " + chalk.white(entryName) + chalk.gray(" and all its contents") + "?";
      w(out);
    }

    function onConfirmResize() { w("\x1b[2J"); drawConfirm(); }
    process.stdout.removeListener("resize", onResize); process.stdout.on("resize", onConfirmResize);
    stdin.removeListener("data", onKey);

    function onConfirm(k: string) {
      if (k === "y" || k === "Y") {
        stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onConfirmResize); process.stdout.on("resize", onResize);
        try { moveToTrash(full); allEntries = allEntries.filter((e) => e.name !== entryName); entries = visibleEntries(); }
        catch (err: any) { w(at(R(), 1) + clr() + chalk.red("  Error: " + err.message)); setTimeout(() => { process.stdout.removeListener("resize", onConfirmResize); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }, 1500); return; }
        if (!entries.length && !allEntries.length) { process.chdir(cwd); return exit(); }
        selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); stdin.on("data", onKey); fullRedraw(); return;
      }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onConfirmResize); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }
    }

    stdin.on("data", onConfirm); w("\x1b[2J"); drawConfirm();
  }

  function openLog() {
    process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey);
    showFileOpsLog(() => { process.stdout.on("resize", onResize); w("\x1b[2J"); fullRedraw(); stdin.on("data", onKey); });
  }

  function onKey(k: string) {
    if (k === "\u0003") { process.chdir(cwd); return exit(); }
    if (k === "\u001b") { if (getClipboard()) { clearClipboard(); render(); } else { process.chdir(cwd); exit(); } return; }
    if (k === "\u0008") { openLog(); return; }
    if (k === "\r")    { if (entries.length) goInto(entries[selIdx].name); return; }
    if (k === "\t")    { goUp(); return; }
    if (k === ".")     { toggleHidden(); return; }
    if (k === "c")     { doCopy();   return; }
    if (k === "x")     { doCut();    return; }
    if (k === "v")     { doPaste();  return; }
    if (k === "r")     { doRename(); return; }
    if (k === "m")     { doMoveTo(); return; }
    if (k === "d" || k === "D") { if (entries.length) showDeleteConfirm(entries[selIdx].name); return; }
    if (navigate(k)) render();
  }

  process.stdout.on("resize", onResize);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  stdin.on("data", onKey);
  enterAlt(); fullRedraw();
}