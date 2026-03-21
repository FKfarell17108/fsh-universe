import fs from "fs";
import path from "path";
import chalk from "chalk";
import { loadMeta, TrashEntry, restoreFromTrash, deleteFromTrash, deleteAllFromTrash, TRASH_DIR } from "./trash";
import { w, at, clr, C, R, drawNavbar, NavItem, drawBottomBar, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

export function interactiveTrash(onExit: () => void): void {
  const stdin = process.stdin;
  let entries = loadMeta();
  if (!entries.length) { console.log(chalk.gray("  (trash is empty)")); return onExit(); }
  let sel = 0; let scrollTop = 0; let selected = new Set<string>();

  const ROW1: NavItem[] = [
    { key: "↑↓",  label: "Navigate"   },
    { key: "Spc", label: "Select"      },
    { key: "A",   label: "Select All"  },
    { key: "Ent", label: "Preview"     },
    { key: "Esc", label: "Deselect/Quit" },
  ];
  function ROW2(): NavItem[] {
    return [
      { key: "R", label: "Restore"        },
      { key: "X", label: "Delete Forever" },
      { key: "D", label: "Empty Trash"    },
    ];
  }
  function NAV() { return [ROW1, ROW2()]; }
  const NR = 3;

  function vis(): number { return Math.max(1, R() - NR - 2); }
  function adjustScroll(): void { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }
  function cleanup(): void { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); exitAlt(); }
  function exit(): void { cleanup(); setTimeout(onExit, 30); }
  function toggleSelect(): void { if (!entries.length) return; const id = entries[sel].id; if (selected.has(id)) selected.delete(id); else selected.add(id); }
  function selectAll(): void { if (selected.size === entries.length) selected.clear(); else selected = new Set(entries.map(e => e.id)); }
  function getTargets(): TrashEntry[] { if (selected.size > 0) return entries.filter(e => selected.has(e.id)); return entries.length ? [entries[sel]] : []; }

  function afterAction(): void {
    entries = loadMeta(); selected.clear();
    if (!entries.length) return exit();
    sel = Math.min(sel, entries.length - 1); adjustScroll();
    process.stdout.removeListener("resize", onResize);
    process.stdout.on("resize", onResize);
    stdin.removeAllListeners("data");
    stdin.on("data", onKey);
    fullRedraw();
  }

  function buildLeft(): string {
    const dirs = entries.filter(e => e.isDir).length; const files = entries.length - dirs;
    let s = "Trash"; if (dirs) s += `  ${dirs}d`; if (files) s += `  ${files}f`;
    if (selected.size) s += chalk.magenta(`  ${selected.size} sel`);
    return s;
  }
  function buildRight(): string { if (entries.length <= vis()) return ""; const more = entries.length - (scrollTop + vis()); return more > 0 ? `↓ ${more} more` : "end"; }
  function drawBottom(): void { drawBottomBar(buildLeft(), buildRight()); }

  function drawContent(): void {
    const start = NR + 2; const cols = C(); const v = vis(); let out = "";
    for (let i = 0; i < v; i++) {
      out += at(start + i, 1) + clr();
      const e = entries[scrollTop + i]; if (!e) continue;
      const isCursor = (scrollTop + i) === sel; const isSel = selected.has(e.id);
      const icon = e.isDir ? chalk.blue("▸") : chalk.gray("·");
      const date = new Date(e.trashedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const dateStr = chalk.dim(date); const prefix = isSel ? chalk.magenta("✓ ") : "  ";
      if (isCursor && isSel) {
        out += chalk.bgMagenta.white.bold(padOrTrim(` ${prefix}${icon} ${e.name}`, cols));
      } else if (isCursor) {
        const from = e.originalPath.replace(process.env.HOME ?? "", "~");
        const nameMax = Math.max(8, cols - date.length - 4 - Math.min(from.length + 12, Math.floor(cols * 0.35)));
        const name = e.name.length > nameMax ? e.name.slice(0, nameMax - 1) + "…" : e.name;
        const fromTr = from.length > Math.floor(cols * 0.35) - 12 ? from.slice(0, Math.floor(cols * 0.35) - 13) + "…" : from;
        const left = ` ${prefix}${icon} ${name}`;
        const pad = Math.max(0, cols - visibleLen(left) - date.length - visibleLen("  from: " + fromTr) - 2);
        out += chalk.bgWhite.black.bold(left) + " ".repeat(pad) + chalk.bgWhite.black(date) + chalk.bgWhite.dim("  from: " + fromTr);
      } else if (isSel) {
        const maxName = cols - date.length - 5; const name = e.name.length > maxName ? e.name.slice(0, maxName - 1) + "…" : e.name;
        out += chalk.magenta(` ${prefix}${icon} ${name}`.padEnd(cols - date.length - 2)) + "  " + dateStr;
      } else {
        const maxName = cols - date.length - 4; const name = e.name.length > maxName ? e.name.slice(0, maxName - 1) + "…" : e.name;
        out += (` ${icon} ${name}`).padEnd(cols - date.length - 2) + "  " + dateStr;
      }
    }
    w(out);
  }

  function render(): void { drawNavbar(NAV()); drawContent(); drawBottom(); }
  function fullRedraw(): void { clearScreen(); adjustScroll(); render(); }

  function showConfirmDelete(targets: TrashEntry[], onBack: () => void): void {
    const multi = targets.length > 1;
    const confirmNav: NavItem[] = [{ key: "Y", label: "Delete Forever (cannot undo)" }, { key: "N/Esc", label: "Cancel" }];
    function drawConfirm(): void {
      const start = 3; const avail = R() - 3;
      drawNavbar(confirmNav, confirmNav.length);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(start + ln, 1) + clr() + s; ln++; }
      if (multi) {
        line(chalk.bold(`  Delete ${targets.length} items forever`)); line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
        for (const t of targets.slice(0, avail - 3)) line((t.isDir ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(t.name));
        if (targets.length > avail - 3) line(chalk.gray(`  ... and ${targets.length - (avail - 3)} more`));
      } else {
        const src = path.join(TRASH_DIR, targets[0].id);
        line(chalk.bold((targets[0].isDir ? "  dir  " : "  file ") + targets[0].name)); line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
        if (targets[0].isDir) {
          try { const ch = fs.readdirSync(src, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, avail - 3)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > avail - 3) line(chalk.gray(`  ... and ${ch.length - (avail - 3)} more`)); } } catch { line(chalk.red("  cannot read directory")); }
        } else {
          try { const fl = fs.readFileSync(src, "utf8").split("\n"); for (const f of fl.slice(0, avail - 3)) { const d = f.length > C() - 4 ? f.slice(0, C() - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > avail - 3) line(chalk.gray(`  ... ${fl.length - (avail - 3)} more lines`)); } catch { line(chalk.gray("  (binary file)")); }
        }
      }
      for (let i = ln; i < avail; i++) out += at(start + i, 1) + clr();
      w(out); drawBottomBar("Delete forever — cannot undo", "");
    }
    const onCR = () => { clearScreen(); drawConfirm(); };
    process.stdout.removeListener("resize", onResize); process.stdout.on("resize", onCR); stdin.removeAllListeners("data");
    function onConfirm(k: string): void {
      if (k === "y" || k === "Y") { process.stdout.removeListener("resize", onCR); stdin.removeAllListeners("data"); for (const t of targets) deleteFromTrash(t); afterAction(); return; }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { process.stdout.removeListener("resize", onCR); stdin.removeAllListeners("data"); onBack(); }
    }
    stdin.on("data", onConfirm); clearScreen(); drawConfirm();
  }

  function showConfirmEmpty(): void {
    const total = entries.length;
    const confirmNav: NavItem[] = [{ key: "Y", label: `Empty Trash (${total} items)` }, { key: "N/Esc", label: "Cancel" }];
    function drawConfirm(): void {
      const start = 3; const avail = R() - 3;
      drawNavbar(confirmNav, confirmNav.length);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(start + ln, 1) + clr() + s; ln++; }
      line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
      for (const e of entries.slice(0, avail - 2)) line((e.isDir ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(e.name));
      if (entries.length > avail - 2) line(chalk.gray(`  ... and ${entries.length - (avail - 2)} more`));
      for (let i = ln; i < avail; i++) out += at(start + i, 1) + clr();
      w(out); drawBottomBar(`${total} items will be permanently deleted`, "");
    }
    process.stdout.removeListener("resize", onResize);
    const onCR = () => { clearScreen(); drawConfirm(); }; process.stdout.on("resize", onCR); stdin.removeAllListeners("data");
    function onConfirm(k: string): void {
      if (k === "y" || k === "Y") { process.stdout.removeListener("resize", onCR); stdin.removeAllListeners("data"); deleteAllFromTrash(); exit(); return; }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { process.stdout.removeListener("resize", onCR); stdin.removeAllListeners("data"); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }
    }
    stdin.on("data", onConfirm); clearScreen(); drawConfirm();
  }

  function showPreview(entry: TrashEntry): void {
    const src = path.join(TRASH_DIR, entry.id);
    const previewNav: NavItem[] = [
      { key: "Esc", label: "Back" }, { key: "R", label: "Restore" }, { key: "X", label: "Delete Forever" },
      ...(entry.isDir ? [{ key: "O", label: "Browse Dir" } as NavItem] : []),
    ];
    function drawPreview(): void {
      const start = 3; const v = R() - 3;
      drawNavbar(previewNav, previewNav.length);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= v) return; out += at(start + ln, 1) + clr() + s; ln++; }
      line(chalk.bold((entry.isDir ? "  dir  " : "  file ") + entry.name)); line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
      if (entry.isDir) {
        try { const ch = fs.readdirSync(src, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, v - 3)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > v - 3) line(chalk.gray(`  ... and ${ch.length - (v - 3)} more`)); } } catch { line(chalk.red("  cannot read directory")); }
      } else {
        try { const fl = fs.readFileSync(src, "utf8").split("\n"); for (const f of fl.slice(0, v - 2)) { const d = f.length > C() - 4 ? f.slice(0, C() - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > v - 2) line(chalk.gray(`  ... ${fl.length - (v - 2)} more lines`)); } catch { line(chalk.gray("  (binary file)")); }
      }
      for (let i = ln; i < v; i++) out += at(start + i, 1) + clr();
      w(out); drawBottomBar(entry.name, "");
    }
    process.stdout.removeListener("resize", onResize);
    const onPR = () => { clearScreen(); drawNavbar(previewNav, previewNav.length); drawPreview(); };
    process.stdout.on("resize", onPR); stdin.removeAllListeners("data");
    function back(): void { process.stdout.removeListener("resize", onPR); stdin.removeAllListeners("data"); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }
    function onPreviewKey(k: string): void {
      if (k === "\u001b" || k === "\u0003") { back(); return; }
      if (k === "r") { process.stdout.removeListener("resize", onPR); stdin.removeAllListeners("data"); restoreFromTrash(entry); afterAction(); return; }
      if (k === "x") { process.stdout.removeListener("resize", onPR); stdin.removeAllListeners("data"); showConfirmDelete([entry], () => { process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }); return; }
      if (k === "o" && entry.isDir) { process.stdout.removeListener("resize", onPR); stdin.removeAllListeners("data"); browseDir(src, entry.name, stdin, () => { process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }); return; }
    }
    stdin.on("data", onPreviewKey); clearScreen(); drawNavbar(previewNav, previewNav.length); drawPreview();
  }

  function onResize(): void { fullRedraw(); }
  function onKey(k: string): void {
    if (k === "\u001b") { if (selected.size > 0) { selected.clear(); render(); } else exit(); return; }
    if (k === "\u0003") { exit(); return; }
    if (k === "\u001b[A") { if (sel > 0) { sel--; adjustScroll(); render(); } return; }
    if (k === "\u001b[B") { if (sel < entries.length - 1) { sel++; adjustScroll(); render(); } return; }
    if (k.startsWith("\u001b")) return;
    if (k === " ") { toggleSelect(); render(); return; }
    if (k === "a") { selectAll(); render(); return; }
    if (k === "\r") { if (selected.size === 0) showPreview(entries[sel]); return; }
    if (k === "r") { const t = getTargets(); stdin.removeAllListeners("data"); process.stdout.removeListener("resize", onResize); for (const e of t) restoreFromTrash(e); afterAction(); return; }
    if (k === "x") { const targets = getTargets(); process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); showConfirmDelete(targets, () => { process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }); return; }
    if (k === "D") { showConfirmEmpty(); return; }
  }
  process.stdout.on("resize", onResize); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8"); stdin.on("data", onKey);
  enterAlt(); fullRedraw();
}

function browseDir(dirPath: string, label: string, stdin: NodeJS.ReadStream, onBack: () => void): void {
  let entries: { name: string; isDir: boolean }[] = [];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory() })).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)); } catch { onBack(); return; }
  let sel = 0; let scrollTop = 0;
  const nav: NavItem[] = [{ key: "↑↓", label: "Navigate" }, { key: "Ent", label: "Open" }, { key: "Esc", label: "Back" }];
  const NR = 2;
  function vis(): number { return Math.max(1, R() - NR - 2); }
  function adjustScroll(): void { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }
  function drawContent(): void {
    const start = NR + 2; const cols = C(); const v = vis(); let out = "";
    for (let i = 0; i < v; i++) {
      out += at(start + i, 1) + clr(); const e = entries[scrollTop + i]; if (!e) continue;
      const active = (scrollTop + i) === sel; const icon = e.isDir ? chalk.blue("▸ ") : chalk.gray("  ");
      const padded = (icon + e.name).padEnd(cols - 2);
      out += active ? " " + chalk.bgWhite.black.bold(padded) : " " + (e.isDir ? chalk.blue(padded) : chalk.white(padded));
    }
    if (!entries.length) out += at(NR + 2, 1) + clr() + chalk.gray("  (empty)");
    w(out);
  }
  function buildRight(): string { if (entries.length <= vis()) return ""; const more = entries.length - (scrollTop + vis()); return more > 0 ? `↓ ${more} more` : "end"; }
  function render(): void { drawNavbar(nav, nav.length); drawContent(); drawBottomBar(label, buildRight()); }
  const onBR = () => { clearScreen(); adjustScroll(); render(); }; process.stdout.on("resize", onBR);
  function onKey(k: string): void {
    if (k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onBR); onBack(); return; }
    if (k === "\u001b[A" && sel > 0) { sel--; adjustScroll(); render(); return; }
    if (k === "\u001b[B" && sel < entries.length - 1) { sel++; adjustScroll(); render(); return; }
    if (k.startsWith("\u001b")) return;
    if (k === "\r" && entries.length > 0) {
      const e = entries[sel]; const fp = path.join(dirPath, e.name);
      if (e.isDir) { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onBR); browseDir(fp, label + "/" + e.name, stdin, () => { process.stdout.on("resize", onBR); clearScreen(); adjustScroll(); render(); stdin.on("data", onKey); }); }
      else { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onBR); browseFile(fp, e.name, stdin, () => { process.stdout.on("resize", onBR); clearScreen(); render(); stdin.on("data", onKey); }); }
    }
  }
  stdin.on("data", onKey); clearScreen(); adjustScroll(); render();
}

function browseFile(filePath: string, name: string, stdin: NodeJS.ReadStream, onBack: () => void): void {
  const nav: NavItem[] = [{ key: "Esc", label: "Back" }];
  const NR = 2;
  function vis(): number { return Math.max(1, R() - NR - 2); }
  function drawContent(): void {
    const start = NR + 2; const v = vis(); let out = ""; let ln = 0;
    function line(s: string) { if (ln >= v) return; out += at(start + ln, 1) + clr() + s; ln++; }
    try { const fl = fs.readFileSync(filePath, "utf8").split("\n"); for (const f of fl.slice(0, v)) { const d = f.length > C() - 4 ? f.slice(0, C() - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > v) line(chalk.gray(`  ... ${fl.length - v} more lines`)); } catch { line(chalk.gray("  (binary file)")); }
    for (let i = ln; i < v; i++) out += at(start + i, 1) + clr(); w(out);
  }
  function render(): void { drawNavbar(nav, nav.length); drawContent(); drawBottomBar(name, ""); }
  const onFR = () => { clearScreen(); render(); }; process.stdout.on("resize", onFR);
  function onKey(k: string): void { if (k === "\u001b" || k === "\u0003" || k === "q") { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onFR); onBack(); } }
  stdin.on("data", onKey); clearScreen(); render();
}