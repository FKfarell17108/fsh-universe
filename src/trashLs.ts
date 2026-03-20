import fs from "fs";
import path from "path";
import chalk from "chalk";
import { loadMeta, TrashEntry, restoreFromTrash, deleteFromTrash, deleteAllFromTrash, TRASH_DIR } from "./trash";
import { w, at, clr, C, R, NAVBAR_ROWS, FOOTER_ROWS, getNR, drawNavbar, drawFooter, kb, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

export function interactiveTrash(onExit: () => void) {
  const stdin = process.stdin;
  let entries = loadMeta();

  if (!entries.length) { console.log(chalk.gray("  (trash is empty)")); return onExit(); }

  let sel = 0; let scrollTop = 0;

  function vis(): number { return Math.max(1, R() - getNR() - FOOTER_ROWS); }
  function adjustScroll() { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }

  function cleanup() { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); exitAlt(); }
  function exit() { cleanup(); setTimeout(onExit, 30); }

  function statLeft(): string {
    const dirs  = entries.filter((e) => e.isDir).length;
    const files = entries.length - dirs;
    const parts: string[] = [];
    if (dirs  > 0) parts.push(`${dirs} ${dirs  === 1 ? "dir"  : "dirs"}`);
    if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
    return parts.join("  ");
  }

  function buildNavHints(): string[] {
    const v  = vis();
    const si = entries.length > v ? chalk.dim(` [${sel + 1}/${entries.length}]`) : "";
    return [
      kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" preview  ") + kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete forever  ") + kb("D") + chalk.gray(" empty trash  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" preview  ") + kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete  ") + kb("D") + chalk.gray(" empty  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete  ") + kb("D") + chalk.gray(" empty  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("r") + chalk.gray(" restore  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("esc") + chalk.gray(" quit"),
    ];
  }

  function drawTrashContent() {
    const cols = C(); const v = vis(); let out = "";
    for (let i = 0; i < v; i++) {
      out += at(getNR() + 1 + i, 1) + clr();
      const e = entries[scrollTop + i]; if (!e) continue;
      const active  = (scrollTop + i) === sel;
      const icon    = e.isDir ? chalk.blue("▸") : chalk.gray("·");
      const date    = new Date(e.trashedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const dateStr = chalk.gray(date);
      if (active) {
        const from     = e.originalPath.replace(process.env.HOME ?? "", "~");
        const nameMax  = cols - date.length - 4 - Math.min(from.length + 12, Math.floor(cols * 0.35));
        const name     = e.name.length > Math.max(nameMax, 8) ? e.name.slice(0, Math.max(nameMax, 8) - 1) + "…" : e.name;
        const fromTr   = from.length > Math.floor(cols * 0.35) - 12 ? from.slice(0, Math.floor(cols * 0.35) - 13) + "…" : from;
        const left     = ` ${icon} ${name}`;
        const pad      = Math.max(0, cols - visibleLen(left) - date.length - visibleLen("  from: " + fromTr) - 2);
        out += chalk.bgWhite.black.bold(left) + " ".repeat(pad) + chalk.bgWhite.black(date) + chalk.bgWhite.dim("  from: " + fromTr);
      } else {
        const maxName = cols - date.length - 4;
        const name    = e.name.length > maxName ? e.name.slice(0, maxName - 1) + "…" : e.name;
        out += (` ${icon} ${name}`).padEnd(cols - date.length - 2) + "  " + dateStr;
      }
    }
    w(out);
    drawFooter(getNR() + 1 + v, entries.length, scrollTop, v, statLeft());
  }

  function render() { drawNavbar(buildNavHints(), `${entries.length}R × 1C`); drawTrashContent(); }
  function fullRedraw() { clearScreen(); adjustScroll(); render(); }

  function afterAction() { entries = loadMeta(); if (!entries.length) return exit(); sel = Math.min(sel, entries.length - 1); fullRedraw(); }

  function showConfirmEmpty() {
    const mid = Math.floor(R() / 2);
    w(at(mid - 1, 1) + clr() + chalk.red.bold("  Empty trash?") + " " + chalk.gray("Permanently deletes all items.") +
      at(mid, 1)     + clr() + "  " + chalk.bgRed.white.bold(" y ") + chalk.gray("  yes      ") + chalk.bgGray.white.bold(" n ") + chalk.gray("  no / esc") +
      at(mid + 1, 1) + clr());
    stdin.removeListener("data", onKey);
    stdin.on("data", function onConfirm(k: string) {
      if (k === "y" || k === "Y") { stdin.removeListener("data", onConfirm); deleteAllFromTrash(); return exit(); }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onConfirm); fullRedraw(); stdin.on("data", onKey); }
    });
  }

  function showPreview(entry: TrashEntry) {
    const src = path.join(TRASH_DIR, entry.id);

    function buildPreviewHints(): string[] {
      const bh = entry.isDir ? kb("o") + chalk.gray(" browse  ") : "";
      return [
        kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete forever  ") + bh + kb("esc") + chalk.gray(" back"),
        kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete  ") + bh + kb("esc") + chalk.gray(" back"),
        kb("r") + chalk.gray(" restore  ") + kb("esc") + chalk.gray(" back"),
        kb("esc") + chalk.gray(" back"),
      ];
    }

    function drawPreview() {
      const cols = C(); const v = Math.max(1, R() - getNR()); let out = ""; let ln = 0;
      function line(s: string) { if (ln >= v) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
      line(chalk.bold((entry.isDir ? "  dir" : " file") + "  " + entry.name));
      line(chalk.dim("─".repeat(Math.min(cols - 2, 60))));
      if (entry.isDir) {
        try {
          const ch = fs.readdirSync(src, { withFileTypes: true });
          if (!ch.length) { line(chalk.gray("  (empty directory)")); }
          else { for (const c of ch.slice(0, v - 4)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > v - 4) line(chalk.gray(`  ... and ${ch.length - (v - 4)} more`)); }
        } catch { line(chalk.red("  cannot read directory")); }
      } else {
        try {
          const fl = fs.readFileSync(src, "utf8").split("\n");
          for (const f of fl.slice(0, v - 4)) { const d = f.length > cols - 4 ? f.slice(0, cols - 5) + "…" : f; line(chalk.white("  " + d)); }
          if (fl.length > v - 4) line(chalk.gray(`  ... ${fl.length - (v - 4)} more lines`));
        } catch { line(chalk.gray("  (binary file)")); }
      }
      for (let i = ln; i < v; i++) out += at(getNR() + 1 + i, 1) + clr();
      w(out);
    }

    function renderPreview() { drawNavbar(buildPreviewHints(), `${entries.length}R × 1C`); drawPreview(); }
    function onPreviewResize() { clearScreen(); renderPreview(); }

    process.stdout.removeListener("resize", onResize);
    process.stdout.on("resize", onPreviewResize);

    function onPreviewKey(k: string) {
      function back() { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }
      if (k === "\u001b" || k === "\u0003") { back(); return; }
      if (k === "r") { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); process.stdout.on("resize", onResize); restoreFromTrash(entry); afterAction(); return; }
      if (k === "x") { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); process.stdout.on("resize", onResize); deleteFromTrash(entry); afterAction(); return; }
      if (k === "o" && entry.isDir) { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); browseDir(src, entry.name, stdin, () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }); return; }
    }

    stdin.removeListener("data", onKey);
    stdin.on("data", onPreviewKey);
    clearScreen(); renderPreview();
  }

  function onResize() { fullRedraw(); }

  function onKey(k: string) {
    if (k === "\u001b" || k === "\u0003") return exit();
    if (k === "\u001b[A") { if (sel > 0) { sel--; adjustScroll(); render(); } return; }
    if (k === "\u001b[B") { if (sel < entries.length - 1) { sel++; adjustScroll(); render(); } return; }
    if (k.startsWith("\u001b")) return;
    if (k === "\r") return showPreview(entries[sel]);
    if (k === "r") { restoreFromTrash(entries[sel]); afterAction(); return; }
    if (k === "x") { deleteFromTrash(entries[sel]); afterAction(); return; }
    if (k === "D") return showConfirmEmpty();
  }

  process.stdout.on("resize", onResize);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  stdin.on("data", onKey);
  enterAlt(); fullRedraw();
}

function browseDir(dirPath: string, label: string, stdin: NodeJS.ReadStream, onBack: () => void) {
  let entries: { name: string; isDir: boolean }[] = [];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() })).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)); }
  catch { onBack(); return; }

  let sel = 0; let scrollTop = 0;
  function vis() { return Math.max(1, R() - getNR() - FOOTER_ROWS); }
  function adjustScroll() { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }

  function statLeft(): string {
    const dirs = entries.filter((e) => e.isDir).length; const files = entries.length - dirs;
    const parts: string[] = [];
    if (dirs  > 0) parts.push(`${dirs} ${dirs  === 1 ? "dir"  : "dirs"}`);
    if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
    return parts.join("  ");
  }

  function buildHints(): string[] {
    const v = vis(); const si = entries.length > v ? chalk.dim(` [${sel + 1}/${entries.length}]`) : "";
    return [
      kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" open  ") + kb("esc") + chalk.gray(" back") + "  " + chalk.dim(label) + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" open  ") + kb("esc") + chalk.gray(" back") + si,
      kb("↑↓") + chalk.gray(" move  ") + kb("esc") + chalk.gray(" back") + si,
      kb("esc") + chalk.gray(" back"),
    ];
  }

  function drawContent() {
    const cols = C(); const v = vis(); let out = "";
    for (let i = 0; i < v; i++) {
      out += at(getNR() + 1 + i, 1) + clr();
      const e = entries[scrollTop + i]; if (!e) continue;
      const active = (scrollTop + i) === sel;
      const icon   = e.isDir ? chalk.blue("▸ ") : chalk.gray("  ");
      const padded = (icon + e.name).padEnd(cols - 2);
      out += active ? " " + chalk.bgWhite.black.bold(padded) : " " + (e.isDir ? chalk.blue(padded) : chalk.white(padded));
    }
    if (!entries.length) out += at(getNR() + 1, 1) + chalk.gray("  (empty)");
    w(out);
    drawFooter(getNR() + 1 + v, entries.length, scrollTop, v, statLeft());
  }

  function render() { drawNavbar(buildHints(), `${entries.length}R × 1C`); drawContent(); }
  function onBrowseResize() { clearScreen(); render(); }

  process.stdout.on("resize", onBrowseResize);

  function onKey(k: string) {
    if (k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onBrowseResize); onBack(); return; }
    if (k === "\u001b[A" && sel > 0) { sel--; adjustScroll(); render(); return; }
    if (k === "\u001b[B" && sel < entries.length - 1) { sel++; adjustScroll(); render(); return; }
    if (k.startsWith("\u001b")) return;
    if (k === "\r" && entries.length > 0) {
      const e = entries[sel]; const fp = path.join(dirPath, e.name);
      if (e.isDir) { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onBrowseResize); browseDir(fp, label + "/" + e.name, stdin, () => { process.stdout.on("resize", onBrowseResize); clearScreen(); render(); stdin.on("data", onKey); }); }
      else { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onBrowseResize); browseFile(fp, e.name, stdin, () => { process.stdout.on("resize", onBrowseResize); clearScreen(); render(); stdin.on("data", onKey); }); }
    }
  }

  stdin.on("data", onKey); clearScreen(); render();
}

function browseFile(filePath: string, name: string, stdin: NodeJS.ReadStream, onBack: () => void) {
  function buildHints(): string[] { return [kb("esc") + chalk.gray(" back") + "  " + chalk.dim(name), kb("esc") + chalk.gray(" back")]; }

  function drawContent() {
    const cols = C(); const v = Math.max(1, R() - getNR()); let out = ""; let ln = 0;
    function line(s: string) { if (ln >= v) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
    try {
      const fl = fs.readFileSync(filePath, "utf8").split("\n");
      for (const f of fl.slice(0, v)) { const d = f.length > cols - 4 ? f.slice(0, cols - 5) + "…" : f; line(chalk.white("  " + d)); }
      if (fl.length > v) line(chalk.gray(`  ... ${fl.length - v} more lines`));
    } catch { line(chalk.gray("  (binary file)")); }
    for (let i = ln; i < v; i++) out += at(getNR() + 1 + i, 1) + clr();
    w(out);
  }

  function render() { drawNavbar(buildHints()); drawContent(); }
  function onFileResize() { clearScreen(); render(); }

  process.stdout.on("resize", onFileResize);
  function onKey(k: string) {
    if (k === "\u001b" || k === "\u0003" || k === "q") { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onFileResize); onBack(); }
  }
  stdin.on("data", onKey); clearScreen(); render();
}