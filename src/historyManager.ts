import fs from "fs";
import path from "path";
import chalk from "chalk";
import { w, at, clr, C, R, FOOTER_ROWS, getNR, drawNavbar, drawFooter, kb, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";
import { deleteCommandEvents, deleteAllCommandEvents } from "./generalHistory";

export const HISTORY_FILE = path.join(process.env.HOME ?? "~", ".fsh_history");
export const HISTORY_SIZE = 500;
export type HistoryEntry = { cmd: string; ts: number };

export type HistoryResult =
  | { kind: "selected"; cmd: string; entries: HistoryEntry[] }
  | { kind: "closed";   entries: HistoryEntry[] };

export function loadHistoryEntries(): HistoryEntry[] {
  try {
    const lines = fs.readFileSync(HISTORY_FILE, "utf8").split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const sep = line.indexOf("|");
      let cmd: string, ts: number;
      if (sep === -1) { cmd = line; ts = 0; }
      else { ts = parseInt(line.slice(0, sep)); cmd = line.slice(sep + 1); }
      if (cmd && !seen.has(cmd)) { entries.push({ cmd, ts }); seen.add(cmd); }
    }
    return entries.reverse().slice(0, HISTORY_SIZE);
  } catch { return []; }
}

export function saveHistoryEntries(entries: HistoryEntry[]) {
  try {
    const seen = new Set<string>();
    const clean = entries.filter((e) => {
      if (!e.cmd || seen.has(e.cmd)) return false;
      seen.add(e.cmd); return true;
    });
    fs.writeFileSync(HISTORY_FILE, [...clean].reverse().map((e) => `${e.ts}|${e.cmd}`).join("\n") + "\n", "utf8");
  } catch {}
}

export function entriesToStrings(entries: HistoryEntry[]): string[] { return entries.map((e) => e.cmd); }

export function pushEntry(entries: HistoryEntry[], cmd: string): HistoryEntry[] {
  return [{ cmd, ts: Date.now() }, ...entries.filter((e) => e.cmd !== cmd)].slice(0, HISTORY_SIZE);
}

type Bucket = { label: string; entries: HistoryEntry[] };

function groupByTime(entries: HistoryEntry[]): Bucket[] {
  const now = Date.now();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const today     = d.getTime();
  const yesterday = today - 86_400_000;
  const week      = today - 7 * 86_400_000;
  const buckets: Bucket[] = [
    { label: "Last hour", entries: [] },
    { label: "Today",     entries: [] },
    { label: "Yesterday", entries: [] },
    { label: "This week", entries: [] },
    { label: "Older",     entries: [] },
  ];
  for (const e of entries) {
    const age = now - e.ts;
    if      (e.ts === 0 || e.ts < week) buckets[4].entries.push(e);
    else if (e.ts < yesterday)          buckets[3].entries.push(e);
    else if (e.ts < today)              buckets[2].entries.push(e);
    else if (age < 3_600_000)           buckets[0].entries.push(e);
    else                                buckets[1].entries.push(e);
  }
  return buckets.filter((x) => x.entries.length > 0);
}

type Row =
  | { kind: "header"; bucketIdx: number }
  | { kind: "entry";  entry: HistoryEntry; bucketIdx: number };

export function showHistoryManager(
  entries: HistoryEntry[],
  onDone: (result: HistoryResult) => void
) {
  const stdin = process.stdin;
  if (entries.length === 0) {
    console.log(chalk.gray("  (no command history)"));
    return onDone({ kind: "closed", entries });
  }

  const buckets  = groupByTime(entries);
  let selected   = new Set<string>();

  function buildRows(): Row[] {
    const r: Row[] = [];
    buckets.forEach((b, bi) => {
      if (!b.entries.length) return;
      r.push({ kind: "header", bucketIdx: bi });
      b.entries.forEach((e) => r.push({ kind: "entry", entry: e, bucketIdx: bi }));
    });
    return r;
  }

  let allRows   = buildRows();
  let cursor    = 0;
  let scrollTop = 0;

  function vis(): number { return Math.max(1, R() - getNR() - FOOTER_ROWS); }

  function adjustScroll() {
    const v = vis();
    if (cursor < scrollTop) scrollTop = cursor;
    if (cursor >= scrollTop + v) scrollTop = cursor - v + 1;
  }

  function totalCmds(): number { return buckets.reduce((s, b) => s + b.entries.length, 0); }

  function toggleSelect() {
    const row = allRows[cursor];
    if (!row) return;
    if (row.kind === "header") {
      const b = buckets[row.bucketIdx];
      const allSel = b.entries.every(e => selected.has(e.cmd));
      if (allSel) b.entries.forEach(e => selected.delete(e.cmd));
      else b.entries.forEach(e => selected.add(e.cmd));
    } else {
      const cmd = row.entry.cmd;
      if (selected.has(cmd)) selected.delete(cmd); else selected.add(cmd);
    }
    render();
  }

  function selectAll() {
    const all = buckets.flatMap(b => b.entries).map(e => e.cmd);
    if (selected.size === all.length) selected.clear();
    else selected = new Set(all);
    render();
  }

  function selBadge(): string {
    if (selected.size === 0) return "";
    return "  " + chalk.magenta.bold(`${selected.size} selected`) + chalk.dim("  a deselect all");
  }

  function buildNavHints(): string[] {
    const isOnHeader = allRows[cursor]?.kind === "header";
    const del        = isOnHeader ? " delete group  " : " delete entry  ";
    const sb         = selBadge();
    return [
      kb("↑↓") + chalk.gray(" navigate  ") + kb("spc") + chalk.gray(" select  ") + kb("a") + chalk.gray(" all  ") + kb("enter") + chalk.gray(" use  ") + kb("d") + chalk.gray(del) + kb("D") + chalk.gray(" delete all  ") + kb("esc") + chalk.gray(" back") + sb,
      kb("↑↓") + chalk.gray(" navigate  ") + kb("spc") + chalk.gray(" sel  ") + kb("a") + chalk.gray(" all  ") + kb("enter") + chalk.gray(" use  ") + kb("d") + chalk.gray(" delete  ") + kb("D") + chalk.gray(" all  ") + kb("esc") + chalk.gray(" back") + sb,
      kb("↑↓") + chalk.gray(" nav  ") + kb("spc") + chalk.gray(" sel  ") + kb("enter") + chalk.gray(" use  ") + kb("d") + chalk.gray(" del  ") + kb("D") + chalk.gray(" all  ") + kb("esc") + chalk.gray(" back") + sb,
      kb("↑↓") + chalk.gray(" nav  ") + kb("d") + chalk.gray(" del  ") + kb("esc") + chalk.gray(" back"),
      kb("↑↓") + chalk.gray(" nav  ") + kb("esc") + chalk.gray(" back"),
    ];
  }

  function drawContent() {
    const cols    = C();
    const v       = vis();
    const visible = allRows.slice(scrollTop, scrollTop + v);
    let out = "";

    for (let i = 0; i < v; i++) {
      out += at(getNR() + 1 + i, 1) + clr();
      const row    = visible[i];
      if (!row) continue;
      const active = (scrollTop + i) === cursor;

      if (row.kind === "header") {
        const b     = buckets[row.bucketIdx];
        const allSel = b.entries.length > 0 && b.entries.every(e => selected.has(e.cmd));
        const prefix = allSel ? chalk.magenta("✓ ") : "  ";
        const label  = prefix + b.label + "  (" + b.entries.length + " commands)";
        out += active
          ? (allSel ? chalk.bgMagenta.white.bold(label.slice(0, cols).padEnd(cols)) : chalk.bgYellow.black.bold(label.slice(0, cols).padEnd(cols)))
          : (allSel ? chalk.magenta(label.slice(0, cols)) : chalk.yellow.bold(label.slice(0, cols)));
      } else {
        const { cmd, ts } = row.entry;
        const isSel   = selected.has(cmd);
        const timeStr = ts ? chalk.gray(new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : "     ";
        const maxCmd  = cols - 12;
        const display = cmd.length > maxCmd ? cmd.slice(0, maxCmd - 1) + "…" : cmd;
        const prefix  = isSel ? "✓   " : "    ";
        const padded  = (prefix + display).padEnd(cols - 7);
        if (active && isSel) out += chalk.bgMagenta.white.bold(padded) + "  " + timeStr;
        else if (active)     out += chalk.bgWhite.black.bold(padded) + "  " + timeStr;
        else if (isSel)      out += chalk.magenta(padded) + "  " + timeStr;
        else                 out += chalk.white(padded) + "  " + timeStr;
      }
    }

    w(out);
    const n = totalCmds();
    drawFooter(getNR() + 1 + v, allRows.length, scrollTop, v, `${n} command${n === 1 ? "" : "s"}`);
  }

  function render() { drawNavbar(buildNavHints(), `${allRows.length}R × 1C`); drawContent(); }
  function fullRedraw() { clearScreen(); adjustScroll(); render(); }

  function cleanup() { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); exitAlt(); }

  function exitClosed() {
    cleanup();
    const remaining = buckets.flatMap((b) => b.entries);
    setTimeout(() => onDone({ kind: "closed", entries: remaining }), 20);
  }

  function exitSelected(cmd: string) {
    cleanup();
    const remaining = buckets.flatMap((b) => b.entries);
    setTimeout(() => onDone({ kind: "selected", cmd, entries: remaining }), 20);
  }

  function deleteAtCursor() {
    if (!allRows.length) return;
    const row = allRows[cursor];
    let toDelete: string[] = [];
    if (selected.size > 0) {
      toDelete = Array.from(selected);
      buckets.forEach(b => { b.entries = b.entries.filter(e => !selected.has(e.cmd)); });
      selected.clear();
    } else if (row.kind === "header") {
      toDelete = buckets[row.bucketIdx].entries.map(e => e.cmd);
      buckets[row.bucketIdx].entries = [];
    } else {
      toDelete = [row.entry.cmd];
      buckets[row.bucketIdx].entries = buckets[row.bucketIdx].entries.filter(e => e.cmd !== row.entry.cmd);
    }
    for (const cmd of toDelete) deleteCommandEvents(cmd);
    allRows = buildRows();
    if (!allRows.length) return exitClosed();
    cursor = Math.min(cursor, allRows.length - 1);
    adjustScroll(); render();
  }

  function showConfirmDeleteAll() {
    const total = totalCmds();

    function drawConfirm() {
      const avail = R() - getNR();
      drawNavbar([
        kb("y") + chalk.gray(" confirm  ") + kb("n") + chalk.gray(" / ") + kb("esc") + chalk.gray(" cancel"),
        kb("y") + chalk.gray(" yes  ") + kb("esc") + chalk.gray(" no"),
      ], `${allRows.length}R × 1C`);
      let out = ""; let ln = 0;
      function line(s: string) { if (ln >= avail) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
      line(chalk.bold("  Delete all command history"));
      line(chalk.dim("─".repeat(Math.min(C() - 2, 60))));
      const shown = buckets.flatMap((b) => b.entries).slice(0, avail - 6);
      for (const e of shown) line(chalk.white("    " + (e.cmd.length > C() - 6 ? e.cmd.slice(0, C() - 7) + "…" : e.cmd)));
      if (total > avail - 6) line(chalk.gray(`    ... and ${total - (avail - 6)} more`));
      for (let i = ln; i < avail - 2; i++) { out += at(getNR() + 1 + i, 1) + clr(); ln++; }
      out += at(R() - 1, 1) + clr() + chalk.dim("─".repeat(Math.min(C() - 2, 60)));
      out += at(R(), 1) + clr() + "  " + chalk.red.bold("Delete all") + chalk.gray(` — permanently deletes all ${total} command${total === 1 ? "" : "s"}. Cannot be undone`) + "?";
      w(out);
    }

    function onConfirmResize() { w("\x1b[2J"); drawConfirm(); }
    process.stdout.removeListener("resize", onResize);
    process.stdout.on("resize", onConfirmResize);
    stdin.removeListener("data", onKey);
    w("\x1b[2J"); drawConfirm();

    stdin.on("data", function onConfirm(k: string) {
      if (k === "y" || k === "Y") {
        stdin.removeListener("data", onConfirm);
        process.stdout.removeListener("resize", onConfirmResize);
        buckets.forEach((b) => { b.entries = []; });
        deleteAllCommandEvents();
        return exitClosed();
      }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") {
        stdin.removeListener("data", onConfirm);
        process.stdout.removeListener("resize", onConfirmResize);
        process.stdout.on("resize", onResize);
        fullRedraw(); stdin.on("data", onKey);
      }
    });
  }

  function onResize() { fullRedraw(); }

  function onKey(raw: string) {
    if (raw === "\u001b[A") { if (cursor > 0) { cursor--; adjustScroll(); render(); } return; }
    if (raw === "\u001b[B") { if (cursor < allRows.length - 1) { cursor++; adjustScroll(); render(); } return; }
    if (raw === "\u001b" || raw === "\u0003" || raw === "q") {
      if (selected.size > 0) { selected.clear(); render(); } else exitClosed();
      return;
    }
    if (raw.startsWith("\u001b")) return;
    if (raw === " ") { toggleSelect(); return; }
    if (raw === "a") { selectAll(); return; }
    if (raw === "D") return showConfirmDeleteAll();
    if (raw === "d" || raw === "\x7f") return deleteAtCursor();
    if (raw === "\r") {
      const row = allRows[cursor];
      if (row?.kind === "entry") exitSelected(row.entry.cmd);
    }
  }

  process.stdout.on("resize", onResize);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  stdin.on("data", onKey);
  enterAlt(); fullRedraw();
}