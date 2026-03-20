import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execFileSync } from "child_process";
import { moveToTrash } from "./trash";
import { getClipboard, setClipboard, clearClipboard, execCopy, execMove, execRename, uniqueDest, loadLog } from "./fileOps";
import { showFileOpsLog } from "./fileOpsLog";
import { w, at, clr, C, R, NAVBAR_ROWS, FOOTER_ROWS, getNR, drawNavbar, drawFooter, kb, enterAlt, exitAlt, visibleLen, padOrTrim } from "./tui";

const EDITOR_CANDIDATES = ["nvim", "vim", "vi", "nano", "emacs", "micro", "hx", "helix", "code", "gedit"];
function getInstalledEditors(): string[] {
  return EDITOR_CANDIDATES.filter((e) => { try { execFileSync("which", [e], { stdio: "ignore" }); return true; } catch { return false; } });
}

export let pendingOpen: { editor: string; file: string } | null = null;
export function clearPendingOpen() { pendingOpen = null; }

export function interactiveLs(onExit: () => void) {
  if (!process.stdin.isTTY) { try { console.log(fs.readdirSync(process.cwd()).join("  ")); } catch {} return onExit(); }
  loadLog();
  const stdin = process.stdin;
  function doExit() { stdin.removeAllListeners("data"); exitAlt(); setTimeout(onExit, 50); }
  enterAlt();
  runBrowser(process.cwd(), stdin, doExit, (cb) => { stdin.removeAllListeners("data"); exitAlt(); setTimeout(cb, 50); });
}

function runBrowser(startDir: string, stdin: NodeJS.ReadStream, onQuit: () => void, onOpenFile: (resume: () => void) => void) {
  let currentDir = startDir;
  let showHidden = false;
  let selIdx = 0; let scrollTop = 0;
  let allEntries: { name: string; isDir: boolean }[] = [];
  let entries:    { name: string; isDir: boolean }[] = [];

  function loadAll() {
    try { allEntries = fs.readdirSync(currentDir).map((name) => { const full = path.join(currentDir, name); let isDir = false; try { isDir = fs.statSync(full).isDirectory(); } catch {} return { name, isDir }; }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)); }
    catch { allEntries = []; }
  }
  function visible() { return showHidden ? allEntries : allEntries.filter((e) => !e.name.startsWith(".")); }
  function reload(keepName?: string) {
    loadAll(); entries = visible();
    if (!entries.length && allEntries.length) { showHidden = true; entries = visible(); }
    selIdx = 0; scrollTop = 0;
    if (keepName) { const idx = entries.findIndex((e) => e.name === keepName); if (idx >= 0) selIdx = idx; }
    adjustScroll();
  }

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

  function goParent() {
    const parent = path.dirname(currentDir); if (parent === currentDir) return;
    const prev = path.basename(currentDir); currentDir = parent; process.chdir(currentDir); reload(prev); fullRedraw();
  }

  function clipBadge(): string {
    const cb = getClipboard(); if (!cb) return "";
    const icon = cb.kind === "copy" ? chalk.cyan("⎘") : chalk.yellow("✂");
    const short = cb.srcName.length > 16 ? cb.srcName.slice(0, 15) + "…" : cb.srcName;
    return "  " + icon + chalk.dim(" " + short + "  ") + chalk.dim.underline("esc") + chalk.dim(" cancel");
  }

  function navRight() { return `${tr()}R × ${pr()}C`; }

  function statLeft(): string {
    const dirs = entries.filter((e) => e.isDir).length; const files = entries.length - dirs;
    const hidC = allEntries.filter((e) => e.name.startsWith(".")).length;
    const home = process.env.HOME ?? "";
    const rel  = currentDir.startsWith(home) ? "~" + currentDir.slice(home.length) : currentDir;
    const parts = [chalk.dim(rel)];
    if (dirs  > 0) parts.push(`${dirs} ${dirs  === 1 ? "dir"  : "dirs"}`);
    if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
    if (!showHidden && hidC > 0) parts.push(chalk.dim(`${hidC} hidden`));
    return parts.join("  ");
  }

  function buildNavHints(): string[] {
    const r = tr(); const v = vis();
    const si  = r > v ? chalk.dim(` [row ${Math.floor(selIdx / pr()) + 1}/${r}]`) : "";
    const dot = showHidden ? " hide  " : " hidden  ";
    const cb  = clipBadge();
    const esc = getClipboard() ? " cancel clipboard" : " quit";
    return [
      kb("↑↓←→") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" open  ") + kb("tab") + chalk.gray(" parent  ") + kb("c") + chalk.gray(" copy  ") + kb("x") + chalk.gray(" cut  ") + kb("v") + chalk.gray(" paste  ") + kb("r") + chalk.gray(" rename  ") + kb("m") + chalk.gray(" move to  ") + kb("d") + chalk.gray(" delete  ") + kb("^H") + chalk.gray(" log  ") + kb(".") + chalk.gray(dot) + kb("q") + chalk.gray(" quit  ") + kb("esc") + chalk.gray(esc) + cb + si,
      kb("↑↓←→") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" open  ") + kb("tab") + chalk.gray(" parent  ") + kb("c") + chalk.gray(" copy  ") + kb("x") + chalk.gray(" cut  ") + kb("v") + chalk.gray(" paste  ") + kb("r") + chalk.gray(" rename  ") + kb("m") + chalk.gray(" move  ") + kb("d") + chalk.gray(" del  ") + kb("^H") + chalk.gray(" log  ") + kb("q") + chalk.gray(" quit  ") + kb("esc") + chalk.gray(esc) + cb + si,
      kb("↑↓←→") + chalk.gray(" move  ") + kb("tab") + chalk.gray(" parent  ") + kb("c") + chalk.gray(" copy  ") + kb("x") + chalk.gray(" cut  ") + kb("v") + chalk.gray(" paste  ") + kb("r") + chalk.gray(" rename  ") + kb("d") + chalk.gray(" del  ") + kb("^H") + chalk.gray(" log  ") + kb("q") + chalk.gray(" quit  ") + kb("esc") + chalk.gray(esc) + si,
      kb("↑↓←→") + chalk.gray(" move  ") + kb("tab") + chalk.gray(" parent  ") + kb("c") + chalk.gray(" copy  ") + kb("v") + chalk.gray(" paste  ") + kb("q") + chalk.gray(" quit  ") + kb("esc") + chalk.gray(esc) + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("tab") + chalk.gray(" parent  ") + kb("q") + chalk.gray(" quit  ") + kb("esc") + chalk.gray(esc),
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
        const { name, isDir } = entries[i];
        const sel     = i === selIdx; const hidden = name.startsWith(".");
        const padded  = name.padEnd(c, " ");
        const cb      = getClipboard();
        const clipped = cb && cb.srcPath === path.join(currentDir, name);
        if (sel)       line += chalk.bgWhite.black.bold(padded);
        else if (clipped) line += cb!.kind === "copy" ? chalk.cyan.underline(padded) : chalk.yellow.underline(padded);
        else if (isDir)   line += hidden ? chalk.cyan(padded) : chalk.blue.bold(padded);
        else              line += hidden ? chalk.gray(padded) : chalk.white(padded);
      }
      out += line;
    }
    out += buildFooterStr(tr(), scrollTop, v, statLeft());
    w(out);
  }

  function buildFooterStr(total: number, st: number, v: number, statL?: string): string {
    const cols = C(); const more = total - (st + v);
    const ls   = statL ? "  " + statL : "";
    const rs   = total > v ? (more > 0 ? `  ↓ ${more} more  ` : "  (end)  ") : "";
    const gap  = Math.max(0, cols - visibleLen(ls) - visibleLen(rs));
    return at(getNR() + 1 + v, 1) + clr() + chalk.dim(ls) + " ".repeat(gap) + chalk.dim(rs);
  }

  function fullRedraw() { w("\x1b[2J"); adjustScroll(); render(); }

  function showStatus(msg: string, isErr = false) {
    w(at(R(), 1) + clr() + (isErr ? chalk.red(msg) : chalk.green(msg)));
    setTimeout(() => w(at(R(), 1) + clr()), 2000);
  }

  function doCopy() { if (!entries.length) return; const e = entries[selIdx]; setClipboard({ kind: "copy", srcPath: path.join(currentDir, e.name), srcName: e.name, isDir: e.isDir }); render(); }
  function doCut()  { if (!entries.length) return; const e = entries[selIdx]; setClipboard({ kind: "cut",  srcPath: path.join(currentDir, e.name), srcName: e.name, isDir: e.isDir }); render(); }

  function doPaste() {
    const cb = getClipboard(); if (!cb) { showStatus("  nothing in clipboard", true); return; }
    const dest = uniqueDest(currentDir, cb.srcName);
    const err  = cb.kind === "copy" ? execCopy(cb.srcPath, dest) : execMove(cb.srcPath, dest);
    if (!err && cb.kind === "cut") clearClipboard();
    if (err) showStatus("  Error: " + err, true); else showStatus(`  ${cb.kind === "copy" ? "Copied" : "Moved"}: ${cb.srcName}  →  ${path.basename(dest)}`);
    reload(path.basename(dest)); render();
  }

  function showInlineInput(label: string, defVal: string, onSubmit: (v: string) => void, onCancel: () => void) {
    let value = defVal; let cursor = value.length;
    const rows = R(); const cols = C();
    function draw() {
      w(at(rows - 1, 1) + clr() + chalk.dim("─".repeat(cols)));
      w(at(rows, 1) + clr() + chalk.bgBlack.white(padOrTrim(" " + label + " " + value, cols)));
      w(`\x1b[${rows};${2 + label.length + 1 + cursor}H\x1b[?25h`);
    }
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
    const e = entries[selIdx]; const full = path.join(currentDir, e.name);
    showInlineInput("Rename:", e.name,
      (newName) => {
        if (!newName || newName === e.name) { fullRedraw(); stdin.on("data", onKey); return; }
        if (fs.existsSync(path.join(currentDir, newName))) { showStatus(`  '${newName}' already exists`, true); fullRedraw(); stdin.on("data", onKey); return; }
        const err = execRename(full, newName);
        if (err) showStatus("  Error: " + err, true); else showStatus(`  Renamed: ${e.name}  →  ${newName}`);
        reload(newName); fullRedraw(); stdin.on("data", onKey);
      },
      () => { fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function doMoveTo() {
    if (!entries.length) return;
    const e = entries[selIdx]; const full = path.join(currentDir, e.name);
    showInlineInput("Move to:", currentDir + "/",
      (destDir) => {
        const expanded = destDir.replace(/^~/, process.env.HOME ?? "~").replace(/\/$/, "");
        if (!fs.existsSync(expanded)) { try { fs.mkdirSync(expanded, { recursive: true }); } catch (ex: any) { showStatus("  Error: " + ex.message, true); fullRedraw(); stdin.on("data", onKey); return; } }
        const dest = uniqueDest(expanded, e.name); const err = execMove(full, dest);
        const home = process.env.HOME ?? ""; const rel = dest.startsWith(home) ? "~" + dest.slice(home.length) : dest;
        if (err) showStatus("  Error: " + err, true); else showStatus(`  Moved: ${e.name}  →  ${rel}`);
        reload(); fullRedraw(); stdin.on("data", onKey);
      },
      () => { fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function showDeleteConfirm(entryName: string, isDir: boolean) {
    const full = path.join(currentDir, entryName);
    function drawConfirm() {
      const cols = C(); const avail = R() - getNR();
      drawNavbar([kb("y") + chalk.gray(" confirm  ") + kb("n") + chalk.gray(" / ") + kb("esc") + chalk.gray(" cancel"), kb("y") + chalk.gray(" yes  ") + kb("esc") + chalk.gray(" no")], navRight());
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
      line(chalk.bold((isDir ? "  dir" : " file") + "  " + entryName));
      line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));
      if (isDir) {
        try { const ch = fs.readdirSync(full, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, avail - 6)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > avail - 6) line(chalk.gray(`  ... and ${ch.length - (avail - 6)} more`)); } }
        catch { line(chalk.red("  cannot read directory")); }
      } else {
        try { const fl = fs.readFileSync(full, "utf8").split("\n"); for (const f of fl.slice(0, avail - 6)) { const d = f.length > cols - 4 ? f.slice(0, cols - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > avail - 6) line(chalk.gray(`  ... ${fl.length - (avail - 6)} more lines`)); }
        catch { line(chalk.gray("  (binary file)")); }
      }
      for (let i = ln; i < avail - 2; i++) { out += at(getNR() + 1 + i, 1) + clr(); ln++; }
      out += at(R() - 1, 1) + clr() + chalk.dim("─".repeat(Math.min(cols - 2, 60)));
      out += at(R(), 1) + clr() + "  " + chalk.yellow.bold("Move to Trash") + ": " + chalk.white(entryName) + (isDir ? chalk.gray(" and all its contents") : "") + "?";
      w(out);
    }
    stdin.removeListener("data", onKey);
    function onConfirm(k: string) {
      if (k === "y" || k === "Y") {
        stdin.removeListener("data", onConfirm);
        try { moveToTrash(full); reload(); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); adjustScroll(); }
        catch (err: any) { w(at(R(), 1) + clr() + chalk.red("  Error: " + err.message)); setTimeout(() => { stdin.on("data", onKey); fullRedraw(); }, 1500); return; }
        stdin.on("data", onKey); fullRedraw(); return;
      }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onConfirm); stdin.on("data", onKey); fullRedraw(); }
    }
    stdin.on("data", onConfirm); w("\x1b[2J"); drawConfirm();
  }

  function openLog() {
    process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey);
    showFileOpsLog(() => { process.stdout.on("resize", onResize); w("\x1b[2J"); fullRedraw(); stdin.on("data", onKey); });
  }

  function onResize() { fullRedraw(); }

  function onKey(k: string) {
    if (k === "\u0003" || k === "q")  return onQuit();
    if (k === "\u0008")               { openLog(); return; }
    if (k === "\u001b") { if (getClipboard()) { clearClipboard(); render(); } else onQuit(); return; }
    if (k === "\t")   { goParent(); return; }
    if (k === "c")    { doCopy();   return; }
    if (k === "x")    { doCut();    return; }
    if (k === "v")    { doPaste();  return; }
    if (k === "r")    { doRename(); return; }
    if (k === "m")    { doMoveTo(); return; }
    if (k === ".")    { toggleHidden(); return; }
    if (k === "d" || k === "D") { if (entries.length) showDeleteConfirm(entries[selIdx].name, entries[selIdx].isDir); return; }
    if (k === "\r") {
      if (!entries.length) return;
      const sel = entries[selIdx];
      if (sel.isDir) { try { fs.readdirSync(path.join(currentDir, sel.name)); currentDir = path.join(currentDir, sel.name); process.chdir(currentDir); reload(); fullRedraw(); } catch { showStatus("  cannot open directory", true); } return; }
      showEditorPicker(path.join(currentDir, sel.name)); return;
    }
    if (navigate(k)) render();
  }

  function toggleHidden() {
    const prev = entries[selIdx]?.name; showHidden = !showHidden; entries = visible(); selIdx = 0; scrollTop = 0;
    if (prev) { const idx = entries.findIndex((e) => e.name === prev); if (idx >= 0) selIdx = idx; }
    adjustScroll(); render();
  }

  function showEditorPicker(filePath: string) {
    const editors = getInstalledEditors(); if (!editors.length) return onQuit();
    if (editors.length === 1) { pendingOpen = { editor: editors[0], file: filePath }; onOpenFile(() => { pendingOpen = null; }); return; }

    const EW = Math.max(...editors.map((e) => e.length)) + 2;
    let eSel = 0; let eScroll = 0;
    function ePr() { return Math.max(1, Math.floor(C() / EW)); }
    function eTr() { return Math.ceil(editors.length / ePr()); }
    function eVis() { return Math.max(1, R() - getNR() - 3 - FOOTER_ROWS); }
    function eAdj() { const pr = ePr(); const row = Math.floor(eSel / pr); const v = eVis(); if (row < eScroll) eScroll = row; if (row >= eScroll + v) eScroll = row - v + 1; }

    function drawEditor() {
      const p = ePr(); const v = eVis();
      drawNavbar([kb("↑↓←→") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" select  ") + kb("esc") + chalk.gray(" back"), kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" select  ") + kb("esc") + chalk.gray(" back"), kb("↑↓") + chalk.gray(" move  ") + kb("esc") + chalk.gray(" back")], `${eTr()}R × ${p}C`);
      let out = at(getNR() + 1, 1) + clr() + " " + chalk.gray("open") + " " + chalk.white(path.basename(filePath)) + " " + chalk.gray("with:") + at(getNR() + 2, 1) + clr() + at(getNR() + 3, 1) + clr();
      for (let row = 0; row < v; row++) {
        out += at(getNR() + 4 + row, 1) + clr();
        const fr = eScroll + row; let line = " ";
        for (let col = 0; col < p; col++) { const i = fr * p + col; if (i >= editors.length) break; const name = editors[i].padEnd(EW, " "); line += i === eSel ? chalk.bgWhite.black.bold(name) : chalk.cyan(name); }
        out += line;
      }
      const more = eTr() - (eScroll + v); const ls = `  ${editors.length} ${editors.length === 1 ? "editor" : "editors"}`; const rs = eTr() > v ? (more > 0 ? `  ↓ ${more} more  ` : "  (end)  ") : "";
      out += at(getNR() + 4 + v, 1) + clr() + chalk.dim(ls) + " ".repeat(Math.max(0, C() - visibleLen(ls) - visibleLen(rs))) + chalk.dim(rs);
      w(out);
    }

    function onEditorResize() { w("\x1b[2J"); drawEditor(); }

    function onEditorKey(k: string) {
      if (k === "\u0003" || k === "\u001b") { stdin.removeListener("data", onEditorKey); process.stdout.removeListener("resize", onEditorResize); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); return; }
      if (k === "\r") { const chosen = editors[eSel]; stdin.removeListener("data", onEditorKey); process.stdout.removeListener("resize", onEditorResize); pendingOpen = { editor: chosen, file: filePath }; onOpenFile(() => { pendingOpen = null; }); return; }
      const p = ePr(); let i = eSel;
      if (k === "\u001b[A") i -= p; else if (k === "\u001b[B") i += p; else if (k === "\u001b[C") i += 1; else if (k === "\u001b[D") i -= 1;
      i = Math.max(0, Math.min(editors.length - 1, i));
      if (i !== eSel) { eSel = i; eAdj(); drawEditor(); }
    }

    process.stdout.removeListener("resize", onResize); process.stdout.on("resize", onEditorResize);
    stdin.removeListener("data", onKey); stdin.on("data", onEditorKey);
    w("\x1b[2J"); drawEditor();
  }

  process.stdout.on("resize", onResize);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume(); stdin.setEncoding("utf8"); stdin.on("data", onKey);
  reload(); w("\x1b[2J"); render();
}