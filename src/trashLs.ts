import fs from "fs";
import path from "path";
import chalk from "chalk";
import { loadMeta, TrashEntry, restoreFromTrash, deleteFromTrash, deleteAllFromTrash, TRASH_DIR } from "./trash";
import { w, at, clr, C, R, FOOTER_ROWS, getNR, drawNavbar, drawFooter, kb, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

export function interactiveTrash(onExit: () => void) {
  const stdin = process.stdin;
  let entries  = loadMeta();

  if (!entries.length) { console.log(chalk.gray("  (trash is empty)")); return onExit(); }

  let sel       = 0;
  let scrollTop = 0;
  let selected  = new Set<string>();

  function vis(): number { return Math.max(1, R() - getNR() - FOOTER_ROWS); }
  function adjustScroll() { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }

  function cleanup() { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); exitAlt(); }
  function exit() { cleanup(); setTimeout(onExit, 30); }

  function toggleSelect() {
    if (!entries.length) return;
    const id = entries[sel].id;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    render();
  }

  function selectAll() {
    if (selected.size === entries.length) selected.clear();
    else selected = new Set(entries.map(e => e.id));
    render();
  }

  function getTargets(): TrashEntry[] {
    if (selected.size > 0) return entries.filter(e => selected.has(e.id));
    return entries.length ? [entries[sel]] : [];
  }

  function selBadge(): string {
    if (selected.size === 0) return "";
    return "  " + chalk.magenta.bold(`${selected.size} selected`) + chalk.dim("  a deselect all");
  }

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
    const sb = selBadge();
    return [
      kb("↑↓") + chalk.gray(" move  ") + kb("spc") + chalk.gray(" select  ") + kb("a") + chalk.gray(" all  ") + kb("enter") + chalk.gray(" preview  ") + kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete forever  ") + kb("D") + chalk.gray(" empty trash  ") + kb("esc") + chalk.gray(" quit") + sb,
      kb("↑↓") + chalk.gray(" move  ") + kb("spc") + chalk.gray(" sel  ") + kb("a") + chalk.gray(" all  ") + kb("enter") + chalk.gray(" preview  ") + kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete  ") + kb("D") + chalk.gray(" empty  ") + kb("esc") + chalk.gray(" quit") + sb,
      kb("↑↓") + chalk.gray(" move  ") + kb("spc") + chalk.gray(" sel  ") + kb("r") + chalk.gray(" restore  ") + kb("x") + chalk.gray(" delete  ") + kb("esc") + chalk.gray(" quit") + sb,
      kb("↑↓") + chalk.gray(" move  ") + kb("esc") + chalk.gray(" quit"),
    ];
  }

  function drawTrashContent() {
    const cols = C(); const v = vis(); let out = "";
    for (let i = 0; i < v; i++) {
      out += at(getNR() + 1 + i, 1) + clr();
      const e = entries[scrollTop + i]; if (!e) continue;
      const isCursor = (scrollTop + i) === sel;
      const isSel    = selected.has(e.id);
      const icon     = e.isDir ? chalk.blue("▸") : chalk.gray("·");
      const date     = new Date(e.trashedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const dateStr  = chalk.dim(date);
      const prefix   = isSel ? chalk.magenta("✓ ") : "  ";

      if (isCursor && isSel) {
        const label = ` ${prefix}${icon} ${e.name}`;
        out += chalk.bgMagenta.white.bold(padOrTrim(label, cols));
      } else if (isCursor) {
        const from    = e.originalPath.replace(process.env.HOME ?? "", "~");
        const nameMax = cols - date.length - 4 - Math.min(from.length + 12, Math.floor(cols * 0.35));
        const name    = e.name.length > Math.max(nameMax, 8) ? e.name.slice(0, Math.max(nameMax, 8) - 1) + "…" : e.name;
        const fromTr  = from.length > Math.floor(cols * 0.35) - 12 ? from.slice(0, Math.floor(cols * 0.35) - 13) + "…" : from;
        const left    = ` ${prefix}${icon} ${name}`;
        const pad     = Math.max(0, cols - visibleLen(left) - date.length - visibleLen("  from: " + fromTr) - 2);
        out += chalk.bgWhite.black.bold(left) + " ".repeat(pad) + chalk.bgWhite.black(date) + chalk.bgWhite.dim("  from: " + fromTr);
      } else if (isSel) {
        const maxName = cols - date.length - 5;
        const name    = e.name.length > maxName ? e.name.slice(0, maxName - 1) + "…" : e.name;
        out += chalk.magenta(` ${prefix}${icon} ${name}`.padEnd(cols - date.length - 2)) + "  " + dateStr;
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

  function afterAction() {
    entries = loadMeta(); selected.clear();
    if (!entries.length) return exit();
    sel = Math.min(sel, entries.length - 1);
    fullRedraw();
  }

  function showConfirmDelete(targets: TrashEntry[], onBack: () => void) {
    const multi = targets.length > 1;

    function drawConfirm() {
      const avail = R() - getNR();
      drawNavbar([
        kb("y") + chalk.gray(" confirm  ") + kb("n") + chalk.gray(" / ") + kb("esc") + chalk.gray(" cancel"),
        kb("y") + chalk.gray(" yes  ") + kb("esc") + chalk.gray(" no"),
      ], `${entries.length}R × 1C`);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
      if (multi) {
        line(chalk.bold(`  ${targets.length} items selected`));
        line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
        for (const t of targets.slice(0, avail - 6)) line((t.isDir ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(t.name));
        if (targets.length > avail - 6) line(chalk.gray(`  ... and ${targets.length - (avail - 6)} more`));
      } else {
        const src = path.join(TRASH_DIR, targets[0].id);
        line(chalk.bold((targets[0].isDir ? "  dir" : " file") + "  " + targets[0].name));
        line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
        if (targets[0].isDir) {
          try { const ch = fs.readdirSync(src, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, avail - 6)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > avail - 6) line(chalk.gray(`  ... and ${ch.length - (avail - 6)} more`)); } } catch { line(chalk.red("  cannot read directory")); }
        } else {
          try { const fl = fs.readFileSync(src, "utf8").split("\n"); for (const f of fl.slice(0, avail - 6)) { const d = f.length > C() - 4 ? f.slice(0, C() - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > avail - 6) line(chalk.gray(`  ... ${fl.length - (avail - 6)} more lines`)); } catch { line(chalk.gray("  (binary file)")); }
        }
      }
      for (let i = ln; i < avail - 2; i++) { out += at(getNR() + 1 + i, 1) + clr(); ln++; }
      out += at(R() - 1, 1) + clr() + chalk.dim("─".repeat(Math.min(C() - 2, 60)));
      out += at(R(), 1) + clr() + "  " + chalk.red.bold("Delete forever") + ": " + (multi ? chalk.white(`${targets.length} items`) : chalk.white(targets[0].name)) + chalk.gray(" — this cannot be undone") + "?";
      w(out);
    }

    function onConfirmResize() { w("\x1b[2J"); drawConfirm(); }
    process.stdout.on("resize", onConfirmResize);
    stdin.removeListener("data", onKey);

    function onConfirm(k: string) {
      if (k === "y" || k === "Y") {
        stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onConfirmResize);
        for (const t of targets) deleteFromTrash(t);
        afterAction(); return;
      }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") {
        stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onConfirmResize);
        onBack();
      }
    }
    stdin.on("data", onConfirm); w("\x1b[2J"); drawConfirm();
  }

  function showConfirmEmpty() {
    const total = entries.length;

    function drawConfirm() {
      const avail = R() - getNR();
      drawNavbar([kb("y") + chalk.gray(" confirm  ") + kb("n") + chalk.gray(" / ") + kb("esc") + chalk.gray(" cancel"), kb("y") + chalk.gray(" yes  ") + kb("esc") + chalk.gray(" no")], `${total}R × 1C`);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
      line(chalk.bold("  Empty trash  ") + chalk.dim(`(${total} item${total === 1 ? "" : "s"})`));
      line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
      for (const e of entries.slice(0, avail - 6)) line((e.isDir ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(e.name));
      if (entries.length > avail - 6) line(chalk.gray(`  ... and ${entries.length - (avail - 6)} more`));
      for (let i = ln; i < avail - 2; i++) { out += at(getNR() + 1 + i, 1) + clr(); ln++; }
      out += at(R() - 1, 1) + clr() + chalk.dim("─".repeat(Math.min(C() - 2, 60)));
      out += at(R(), 1) + clr() + "  " + chalk.red.bold("Empty trash") + chalk.gray(" — permanently deletes all " + total + " item" + (total === 1 ? "" : "s") + ". Cannot be undone") + "?";
      w(out);
    }

    function onConfirmResize() { w("\x1b[2J"); drawConfirm(); }
    process.stdout.removeListener("resize", onResize); process.stdout.on("resize", onConfirmResize);
    stdin.removeListener("data", onKey);

    function onConfirm(k: string) {
      if (k === "y" || k === "Y") { stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onConfirmResize); deleteAllFromTrash(); return exit(); }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onConfirm); process.stdout.removeListener("resize", onConfirmResize); process.stdout.on("resize", onResize); stdin.on("data", onKey); fullRedraw(); }
    }
    stdin.on("data", onConfirm); w("\x1b[2J"); drawConfirm();
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
      const v = Math.max(1, R() - getNR()); let out = ""; let ln = 0;
      function line(s: string) { if (ln >= v) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
      line(chalk.bold((entry.isDir ? "  dir" : " file") + "  " + entry.name));
      line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
      if (entry.isDir) {
        try { const ch = fs.readdirSync(src, { withFileTypes: true }); if (!ch.length) { line(chalk.gray("  (empty directory)")); } else { for (const c of ch.slice(0, v - 4)) line((c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) + chalk.white(c.name)); if (ch.length > v - 4) line(chalk.gray(`  ... and ${ch.length - (v - 4)} more`)); } } catch { line(chalk.red("  cannot read directory")); }
      } else {
        try { const fl = fs.readFileSync(src, "utf8").split("\n"); for (const f of fl.slice(0, v - 4)) { const d = f.length > C() - 4 ? f.slice(0, C() - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > v - 4) line(chalk.gray(`  ... ${fl.length - (v - 4)} more lines`)); } catch { line(chalk.gray("  (binary file)")); }
      }
      for (let i = ln; i < v; i++) out += at(getNR() + 1 + i, 1) + clr();
      w(out);
    }

    function renderPreview() { drawNavbar(buildPreviewHints(), `${entries.length}R × 1C`); drawPreview(); }
    function onPreviewResize() { clearScreen(); renderPreview(); }
    process.stdout.removeListener("resize", onResize); process.stdout.on("resize", onPreviewResize);
    stdin.removeListener("data", onKey);

    function back() { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }

    function onPreviewKey(k: string) {
      if (k === "\u001b" || k === "\u0003") { back(); return; }
      if (k === "r") { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); process.stdout.on("resize", onResize); restoreFromTrash(entry); afterAction(); return; }
      if (k === "x") { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); showConfirmDelete([entry], () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }); return; }
      if (k === "o" && entry.isDir) { stdin.removeListener("data", onPreviewKey); process.stdout.removeListener("resize", onPreviewResize); browseDir(src, entry.name, stdin, () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); }); return; }
    }
    stdin.on("data", onPreviewKey); clearScreen(); renderPreview();
  }

  function onResize() { fullRedraw(); }

  function onKey(k: string) {
    if (k === "\u001b") { if (selected.size > 0) { selected.clear(); render(); } else exit(); return; }
    if (k === "\u0003") return exit();
    if (k === "\u001b[A") { if (sel > 0) { sel--; adjustScroll(); render(); } return; }
    if (k === "\u001b[B") { if (sel < entries.length - 1) { sel++; adjustScroll(); render(); } return; }
    if (k.startsWith("\u001b")) return;
    if (k === " ") { toggleSelect(); return; }
    if (k === "a") { selectAll(); return; }
    if (k === "\r") { if (selected.size === 0) showPreview(entries[sel]); return; }
    if (k === "r") {
      const targets = getTargets();
      for (const t of targets) restoreFromTrash(t);
      afterAction(); return;
    }
    if (k === "x") {
      const targets = getTargets();
      process.stdout.removeListener("resize", onResize);
      showConfirmDelete(targets, () => { process.stdout.on("resize", onResize); fullRedraw(); stdin.on("data", onKey); });
      return;
    }
    if (k === "D") return showConfirmEmpty();
  }

  process.stdout.on("resize", onResize);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  stdin.on("data", onKey);
  enterAlt(); fullRedraw();
}

function browseDir(dirPath: string, label: string, stdin: NodeJS.ReadStream, onBack: () => void) {
  let entries: { name: string; isDir: boolean }[] = [];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() })).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)); } catch { onBack(); return; }

  let sel = 0; let scrollTop = 0;
  function vis() { return Math.max(1, R() - getNR() - FOOTER_ROWS); }
  function adjustScroll() { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }
  function statLeft(): string { const dirs = entries.filter((e) => e.isDir).length; const files = entries.length - dirs; const parts: string[] = []; if (dirs > 0) parts.push(`${dirs} ${dirs === 1 ? "dir" : "dirs"}`); if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`); return parts.join("  "); }
  function buildHints(): string[] { return [kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" open  ") + kb("esc") + chalk.gray(" back") + "  " + chalk.dim(label), kb("↑↓") + chalk.gray(" move  ") + kb("enter") + chalk.gray(" open  ") + kb("esc") + chalk.gray(" back"), kb("↑↓") + chalk.gray(" move  ") + kb("esc") + chalk.gray(" back"), kb("esc") + chalk.gray(" back")]; }
  function drawContent() {
    const cols = C(); const v = vis(); let out = "";
    for (let i = 0; i < v; i++) { out += at(getNR() + 1 + i, 1) + clr(); const e = entries[scrollTop + i]; if (!e) continue; const active = (scrollTop + i) === sel; const icon = e.isDir ? chalk.blue("▸ ") : chalk.gray("  "); const padded = (icon + e.name).padEnd(cols - 2); out += active ? " " + chalk.bgWhite.black.bold(padded) : " " + (e.isDir ? chalk.blue(padded) : chalk.white(padded)); }
    if (!entries.length) out += at(getNR() + 1, 1) + chalk.gray("  (empty)");
    w(out); drawFooter(getNR() + 1 + v, entries.length, scrollTop, v, statLeft());
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
    const v = Math.max(1, R() - getNR()); let out = ""; let ln = 0;
    function line(s: string) { if (ln >= v) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
    try { const fl = fs.readFileSync(filePath, "utf8").split("\n"); for (const f of fl.slice(0, v)) { const d = f.length > C() - 4 ? f.slice(0, C() - 5) + "…" : f; line(chalk.white("  " + d)); } if (fl.length > v) line(chalk.gray(`  ... ${fl.length - v} more lines`)); } catch { line(chalk.gray("  (binary file)")); }
    for (let i = ln; i < v; i++) out += at(getNR() + 1 + i, 1) + clr(); w(out);
  }
  function render() { drawNavbar(buildHints()); drawContent(); }
  function onFileResize() { clearScreen(); render(); }
  process.stdout.on("resize", onFileResize);
  function onKey(k: string) { if (k === "\u001b" || k === "\u0003" || k === "q") { stdin.removeListener("data", onKey); process.stdout.removeListener("resize", onFileResize); onBack(); } }
  stdin.on("data", onKey); clearScreen(); render();
}