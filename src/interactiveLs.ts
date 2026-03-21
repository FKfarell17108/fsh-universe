import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execFileSync } from "child_process";
import { moveToTrash } from "./trash";
import { getClipboard, setClipboard, clearClipboard, execCopy, execMove, execRename, uniqueDest, loadLog } from "./fileOps";
import { showFileOpsLog } from "./fileOpsLog";
import { w, at, clr, C, R, drawNavbar, NavItem, NavRows, nrFromRows, drawBottomBar, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

const EDITOR_CANDIDATES = ["nvim", "vim", "vi", "nano", "emacs", "micro", "hx", "helix", "code", "gedit"];

function getInstalledEditors(): string[] {
  return EDITOR_CANDIDATES.filter(e => { try { execFileSync("which", [e], { stdio: "ignore" }); return true; } catch { return false; } });
}

export type LsResult = { kind: "quit" } | { kind: "open"; editor: string; file: string };

export function showInlineInput(stdin: NodeJS.ReadStream, label: string, defVal: string, onSubmit: (v: string) => void, onCancel: () => void): void {
  let value = defVal; let cursor = value.length;
  function draw() {
    const cols = C(); const inputRow = R();
    const prompt = ` ${label} `; const cursorCol = prompt.length + cursor + 1;
    w(at(inputRow, 1) + clr() + chalk.bgBlack.white(padOrTrim(prompt + value, cols)));
    w(`\x1b[${inputRow};${cursorCol}H\x1b[?25h`);
  }
  function onResize() { draw(); }
  process.stdout.on("resize", onResize); draw();
  function cleanup() { process.stdout.removeListener("resize", onResize); w("\x1b[?25l" + at(R(), 1) + clr()); stdin.removeListener("data", onData); }
  function onData(raw: string) {
    if (raw === "\r" || raw === "\n") { cleanup(); onSubmit(value.trim()); return; }
    if (raw === "\u0003" || raw === "\u001b") { cleanup(); onCancel(); return; }
    if (raw === "\u001b[C") { if (cursor < value.length) { cursor++; draw(); } return; }
    if (raw === "\u001b[D") { if (cursor > 0) { cursor--; draw(); } return; }
    if (raw === "\u001b[H" || raw === "\u0001") { cursor = 0; draw(); return; }
    if (raw === "\u001b[F" || raw === "\u0005") { cursor = value.length; draw(); return; }
    if (raw === "\u001b[3~") { if (cursor < value.length) { value = value.slice(0, cursor) + value.slice(cursor + 1); draw(); } return; }
    if (raw === "\x7f" || raw === "\u0008") { if (cursor > 0) { value = value.slice(0, cursor - 1) + value.slice(cursor); cursor--; draw(); } return; }
    if (raw.length === 1 && raw.charCodeAt(0) >= 32) { value = value.slice(0, cursor) + raw + value.slice(cursor); cursor++; draw(); }
  }
  stdin.on("data", onData);
}

export function interactiveLs(onExit: (result: LsResult) => void): void {
  if (!process.stdin.isTTY) {
    try { console.log(fs.readdirSync(process.cwd()).join("  ")); } catch {}
    return onExit({ kind: "quit" });
  }
  loadLog();
  const stdin = process.stdin;
  function finish(result: LsResult) {
    stdin.removeAllListeners("data");
    try { if (stdin.isTTY) stdin.setRawMode(false); } catch {}
    exitAlt(); setTimeout(() => onExit(result), 50);
  }
  enterAlt(); runBrowser(process.cwd(), stdin, () => finish({ kind: "quit" }), (editor, file) => finish({ kind: "open", editor, file }));
}

type MultiClip = { kind: "copy" | "cut"; srcName: string; srcPath: string; isDir: boolean; items: { srcPath: string; srcName: string; isDir: boolean }[]; };

function runBrowser(startDir: string, stdin: NodeJS.ReadStream, onQuit: () => void, onOpenFile: (editor: string, file: string) => void): void {
  let currentDir = startDir;
  let showHidden = false;
  let selIdx = 0; let scrollTop = 0;
  let selected = new Set<string>();
  let statusMsg = ""; let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let allEntries: { name: string; isDir: boolean }[] = [];
  let entries:    { name: string; isDir: boolean }[] = [];

  function loadAll(): void {
    try {
      allEntries = fs.readdirSync(currentDir).map(name => {
        const full = path.join(currentDir, name); let isDir = false;
        try { isDir = fs.statSync(full).isDirectory(); } catch {}
        return { name, isDir };
      }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    } catch { allEntries = []; }
  }
  function visible() { return showHidden ? allEntries : allEntries.filter(e => !e.name.startsWith(".")); }
  function reload(keepName?: string): void {
    loadAll(); entries = visible();
    if (!entries.length && allEntries.length) { showHidden = true; entries = visible(); }
    selected = new Set(Array.from(selected).filter(n => entries.some(e => e.name === n)));
    selIdx = 0; scrollTop = 0;
    if (keepName) { const idx = entries.findIndex(e => e.name === keepName); if (idx >= 0) selIdx = idx; }
    adjustScroll();
  }

  function NAV(): NavRows {
    const cb = getClipboard() as any;
    return [
      [
        { key: "↑↓←→", label: "Navigate"   },
        { key: "Spc",   label: "Select"     },
        { key: "A",     label: "Select All" },
        { key: "Ent",   label: "Open/Enter" },
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

  function adjustScroll(): void {
    const row = Math.floor(selIdx / pr()); const v = vis();
    if (row < scrollTop)      scrollTop = row;
    if (row >= scrollTop + v) scrollTop = row - v + 1;
  }

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

  function toggleSelect(): void { if (!entries.length) return; const n = entries[selIdx].name; if (selected.has(n)) selected.delete(n); else selected.add(n); }
  function selectAll(): void { if (selected.size === entries.length) selected.clear(); else selected = new Set(entries.map(e => e.name)); }
  function getTargets() { if (selected.size > 0) return entries.filter(e => selected.has(e.name)); return entries.length ? [entries[selIdx]] : []; }
  function goParent(): void {
    const parent = path.dirname(currentDir); if (parent === currentDir) return;
    const prev = path.basename(currentDir); currentDir = parent; process.chdir(currentDir);
    selected.clear(); reload(prev); fullRedraw();
  }

  function buildLeft(): string {
    const home = process.env.HOME ?? ""; const rel = currentDir.startsWith(home) ? "~" + currentDir.slice(home.length) : currentDir;
    const dirs = entries.filter(e => e.isDir).length; const files = entries.length - dirs;
    const hidC = allEntries.filter(e => e.name.startsWith(".")).length;
    const cb   = getClipboard() as any;
    let s = rel;
    if (dirs)  s += `  ${dirs}d`;
    if (files) s += `  ${files}f`;
    if (!showHidden && hidC) s += chalk.dim(`  ${hidC} hidden`);
    if (selected.size)       s += chalk.magenta(`  ${selected.size} sel`);
    if (cb) s += (cb.kind === "copy" ? chalk.cyan("  ⎘ ") : chalk.yellow("  ✂ ")) + chalk.dim(cb.srcName.slice(0, 20));
    return s;
  }
  function buildRight(): string {
    if (tr() <= vis()) return "";
    const more = tr() - (scrollTop + vis());
    return more > 0 ? `↓ ${more} more` : "end";
  }
  function drawBottom(): void {
    if (statusMsg) { w(at(R(), 1) + clr() + statusMsg); return; }
    drawBottomBar(buildLeft(), buildRight());
  }
  function showStatus(msg: string, isErr = false): void {
    if (statusTimer) clearTimeout(statusTimer);
    statusMsg = isErr ? chalk.red(msg) : chalk.green(msg);
    drawBottom();
    statusTimer = setTimeout(() => { statusMsg = ""; drawBottom(); statusTimer = null; }, 2000);
  }

  function drawContent(): void {
    const start = NR + 2; const p = pr(); const cWidth = cw(); const v = vis();
    let out = "";
    for (let row = 0; row < v; row++) {
      out += at(start + row, 1) + clr();
      const fr = scrollTop + row; let line = " ";
      for (let col = 0; col < p; col++) {
        const i = fr * p + col; if (i >= entries.length) break;
        const { name, isDir } = entries[i];
        const isCursor = i === selIdx; const isSel = selected.has(name);
        const hidden = name.startsWith("."); const cb = getClipboard() as any;
        const clipped = cb && !cb.items && cb.srcPath === path.join(currentDir, name);
        const prefix = isSel ? "✓ " : "  "; const padded = (prefix + name).padEnd(cWidth, " ");
        if      (isCursor && isSel) line += chalk.bgMagenta.white.bold(padded);
        else if (isCursor)          line += chalk.bgWhite.black.bold(padded);
        else if (isSel)             line += chalk.magenta(padded);
        else if (clipped)           line += cb.kind === "copy" ? chalk.cyan.underline(padded) : chalk.yellow.underline(padded);
        else if (isDir)             line += hidden ? chalk.cyan(padded) : chalk.blue.bold(padded);
        else                        line += hidden ? chalk.gray(padded) : chalk.white(padded);
      }
      out += line;
    }
    w(out);
  }

  function render(): void { drawNavbar(NAV()); drawContent(); drawBottom(); }
  function fullRedraw(): void { clearScreen(); adjustScroll(); render(); }

  function buildMultiClip(kind: "copy" | "cut"): MultiClip {
    const targets = getTargets();
    const items = targets.map(t => ({ srcPath: path.join(currentDir, t.name), srcName: t.name, isDir: t.isDir }));
    return { kind, srcPath: items[0].srcPath, srcName: items.length === 1 ? items[0].srcName : `${items.length} items`, isDir: items[0].isDir, items };
  }

  function doCopy(): void { const t = getTargets(); if (!t.length) return; setClipboard(buildMultiClip("copy") as any); render(); }
  function doCut():  void { const t = getTargets(); if (!t.length) return; setClipboard(buildMultiClip("cut")  as any); render(); }

  function doPaste(): void {
    const cb = getClipboard() as any; if (!cb) { showStatus("  nothing in clipboard", true); return; }
    const items: { srcPath: string; srcName: string; isDir: boolean }[] = cb.items ?? [{ srcPath: cb.srcPath, srcName: cb.srcName, isDir: cb.isDir }];
    let errors = 0;
    for (const item of items) { const err = cb.kind === "copy" ? execCopy(item.srcPath, uniqueDest(currentDir, item.srcName)) : execMove(item.srcPath, uniqueDest(currentDir, item.srcName)); if (err) errors++; }
    if (cb.kind === "cut") clearClipboard(); selected.clear();
    if (errors > 0) showStatus(`  ${errors} error(s) during paste`, true);
    else showStatus(`  ${cb.kind === "copy" ? "Copied" : "Moved"}: ${items.length} item${items.length > 1 ? "s" : ""}`);
    reload(); render();
  }

  function doRename(): void {
    if (!entries.length) return;
    if (selected.size > 1) { showStatus("  rename: select one item at a time", true); return; }
    const e = entries[selIdx]; const full = path.join(currentDir, e.name);
    process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey);
    showInlineInput(stdin, "Rename:", e.name,
      (newName) => {
        process.stdout.on("resize", onResize);
        if (!newName || newName === e.name) { fullRedraw(); stdin.on("data", onKey); return; }
        if (fs.existsSync(path.join(currentDir, newName))) { showStatus(`  '${newName}' already exists`, true); fullRedraw(); stdin.on("data", onKey); return; }
        const err = execRename(full, newName);
        if (err) showStatus("  Error: " + err, true); else showStatus(`  Renamed: ${e.name}  →  ${newName}`);
        selected.clear(); reload(newName); fullRedraw(); stdin.on("data", onKey);
      },
      () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function doMoveTo(): void {
    const targets = getTargets(); if (!targets.length) return;
    process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey);
    showInlineInput(stdin, "Move to:", currentDir + "/",
      (destDir) => {
        process.stdout.on("resize", onResize);
        const expanded = destDir.replace(/^~/, process.env.HOME ?? "~").replace(/\/$/, "");
        if (!fs.existsSync(expanded)) { try { fs.mkdirSync(expanded, { recursive: true }); } catch (ex: any) { showStatus("  Error: " + ex.message, true); fullRedraw(); stdin.on("data", onKey); return; } }
        let errors = 0;
        for (const t of targets) { const err = execMove(path.join(currentDir, t.name), uniqueDest(expanded, t.name)); if (err) errors++; }
        selected.clear();
        if (errors > 0) { showStatus(`  ${errors} error(s)`, true); }
        else { const home = process.env.HOME ?? ""; const rel = expanded.startsWith(home) ? "~" + expanded.slice(home.length) : expanded; showStatus(`  Moved ${targets.length} item${targets.length > 1 ? "s" : ""}  →  ${rel}`); }
        reload(); fullRedraw(); stdin.on("data", onKey);
      },
      () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }
    );
  }

  function toggleHidden(): void {
    const prev = entries[selIdx]?.name; showHidden = !showHidden; entries = visible();
    selIdx = 0; scrollTop = 0;
    if (prev) { const idx = entries.findIndex(e => e.name === prev); if (idx >= 0) selIdx = idx; }
    adjustScroll(); render();
  }

  function showDeleteConfirm(): void {
    const targets = getTargets(); if (!targets.length) return; const multi = targets.length > 1;
    const confirmNav: NavItem[] = [{ key: "Y", label: "Move to Trash" }, { key: "N/Esc", label: "Cancel" }];
    function drawConfirm(): void {
      const start = 3; const avail = R() - 3; const cols = C();
      drawNavbar(confirmNav, confirmNav.length);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(start + ln, 1) + clr() + s; ln++; }
      if (multi) {
        line(chalk.bold(`  Move ${targets.length} items to trash`)); line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));
        for (const t of targets.slice(0, avail - 3)) line((t.isDir ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(t.name));
        if (targets.length > avail - 3) line(chalk.gray(`  ... and ${targets.length - (avail - 3)} more`));
      } else {
        const t = targets[0]; const full = path.join(currentDir, t.name);
        line(chalk.bold((t.isDir ? "  dir  " : "  file ") + t.name)); line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));
        if (t.isDir) {
          try { const ch = fs.readdirSync(full, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, avail - 3)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > avail - 3) line(chalk.gray(`  ... and ${ch.length - (avail - 3)} more`)); } } catch { line(chalk.red("  cannot read directory")); }
        } else {
          try { const fl = fs.readFileSync(full, "utf8").split("\n"); for (const f of fl.slice(0, avail - 3)) { const d = f.length > cols - 4 ? f.slice(0, cols - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > avail - 3) line(chalk.gray(`  ... ${fl.length - (avail - 3)} more lines`)); } catch { line(chalk.gray("  (binary file)")); }
        }
      }
      for (let i = ln; i < avail; i++) out += at(start + i, 1) + clr();
      w(out); drawBottomBar("Move to Trash?", "");
    }
    process.stdout.removeListener("resize", onResize);
    const onCR = () => { clearScreen(); drawConfirm(); }; process.stdout.on("resize", onCR); stdin.removeListener("data", onKey);
    function onConfirm(k: string): void {
      if (k === "y" || k === "Y") {
        stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onCR); process.stdout.on("resize", onResize);
        let errors = 0; for (const t of targets) { try { moveToTrash(path.join(currentDir, t.name)); } catch { errors++; } }
        selected.clear(); if (errors) showStatus(`  ${errors} error(s)`, true);
        reload(); selIdx = Math.min(selIdx, Math.max(0, entries.length - 1)); adjustScroll(); stdin.on("data", onKey); fullRedraw(); return;
      }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onCR); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }
    }
    stdin.on("data", onConfirm); clearScreen(); drawConfirm();
  }

  function showEditorPicker(filePath: string): void {
    const editors = getInstalledEditors(); if (!editors.length) { showStatus("  no editors found", true); return; }
    if (editors.length === 1) { onOpenFile(editors[0], filePath); return; }
    const EW = Math.max(...editors.map(e => e.length)) + 2; let eSel = 0;
    const editorNav: NavItem[] = [{ key: "↑↓←→", label: "Move" }, { key: "Ent", label: "Open" }, { key: "Esc", label: "Back" }];
    function drawEditor(): void {
      drawNavbar(editorNav, editorNav.length);
      let out = at(3, 1) + clr() + " " + chalk.dim("choose editor:");
      let line = " "; for (let i = 0; i < editors.length; i++) { const name = editors[i].padEnd(EW, " "); line += i === eSel ? chalk.bgWhite.black.bold(name) : chalk.cyan(name); }
      out += at(4, 1) + clr() + line; w(out);
      drawBottomBar(path.basename(filePath), "");
    }
    const onER = () => { clearScreen(); drawEditor(); };
    process.stdout.removeListener("resize", onResize); process.stdout.on("resize", onER); stdin.removeListener("data", onKey);
    function onEditorKey(k: string): void {
      if (k === "\u0003") { stdin.removeListener("data", onEditorKey); process.stdout.removeListener("resize", onER); onQuit(); return; }
      if (k === "\u001b") { stdin.removeListener("data", onEditorKey); process.stdout.removeListener("resize", onER); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); return; }
      if (k === "\r") { const chosen = editors[eSel]; stdin.removeListener("data", onEditorKey); process.stdout.removeListener("resize", onER); onOpenFile(chosen, filePath); return; }
      const p = Math.max(1, Math.floor(C() / EW)); let i = eSel;
      if (k === "\u001b[C") i = Math.min(editors.length - 1, i + 1); else if (k === "\u001b[D") i = Math.max(0, i - 1);
      else if (k === "\u001b[A") i = Math.max(0, i - p); else if (k === "\u001b[B") i = Math.min(editors.length - 1, i + p);
      if (i !== eSel) { eSel = i; drawEditor(); }
    }
    stdin.on("data", onEditorKey); clearScreen(); drawEditor();
  }

  function openLog(): void {
    process.stdout.removeListener("resize", onResize); stdin.removeListener("data", onKey);
    showFileOpsLog(() => { enterAlt(); process.stdout.on("resize", onResize); clearScreen(); fullRedraw(); stdin.on("data", onKey); });
  }

  function onResize(): void { fullRedraw(); }

  function onKey(k: string): void {
    if (k === "\u0003") { onQuit(); return; }
    if (k === "h") { openLog(); return; }
    if (k === "\u001b") {
      if (getClipboard()) { clearClipboard(); render(); } else if (selected.size > 0) { selected.clear(); render(); } else onQuit(); return;
    }
    if (k === "\t")  { goParent(); return; }
    if (k === " ")   { toggleSelect(); render(); return; }
    if (k === "a")   { selectAll(); render(); return; }
    if (k === "c")   { doCopy(); return; } if (k === "x") { doCut(); return; } if (k === "v") { doPaste(); return; }
    if (k === "r")   { doRename(); return; } if (k === "m") { doMoveTo(); return; }
    if (k === ".")   { toggleHidden(); return; }
    if (k === "d" || k === "D") { if (entries.length) showDeleteConfirm(); return; }
    if (k === "\r") {
      if (!entries.length) return; const sel = entries[selIdx];
      if (sel.isDir) { try { fs.readdirSync(path.join(currentDir, sel.name)); currentDir = path.join(currentDir, sel.name); process.chdir(currentDir); selected.clear(); reload(); fullRedraw(); } catch { showStatus("  cannot open directory", true); } return; }
      showEditorPicker(path.join(currentDir, sel.name)); return;
    }
    if (navigate(k)) render();
  }

  process.stdout.on("resize", onResize);
  if (stdin.isTTY) stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8"); stdin.on("data", onKey);
  reload(); clearScreen(); render();
}