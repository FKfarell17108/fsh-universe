import fs from "fs";
import path from "path";
import chalk from "chalk";
import { w, at, clr, C, R, NAVBAR_ROWS, FOOTER_ROWS, getNR, drawNavbar, drawFooter, kb, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

export const HISTORY_FILE = path.join(process.env.HOME ?? "~", ".fsh_history");
export const HISTORY_SIZE = 500;
export type HistoryEntry = { cmd: string; ts: number };

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

export function showHistoryManager(entries: HistoryEntry[], onDone: (u: HistoryEntry[]) => void) {
  const stdin = process.stdin;
  if (entries.length === 0) { console.log(chalk.gray("  (no command history)")); return onDone(entries); }

  const buckets = groupByTime(entries);

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

  function buildNavHints(): string[] {
    const isOnHeader = allRows[cursor]?.kind === "header";
    const v          = vis();
    const si         = allRows.length > v ? chalk.dim(` [${cursor + 1}/${allRows.length}]`) : "";
    const del        = isOnHeader ? " delete group  " : " delete entry  ";
    const n          = totalCmds();
    return [
      kb("↑↓") + chalk.gray(" navigate  ") + kb("d") + chalk.gray(del) + kb("D") + chalk.gray(" delete all  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" navigate  ") + kb("d") + chalk.gray(" delete  ") + kb("D") + chalk.gray(" all  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" nav  ") + kb("d") + chalk.gray(" del  ") + kb("D") + chalk.gray(" all  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" nav  ") + kb("d") + chalk.gray(" del  ") + kb("esc") + chalk.gray(" quit") + si,
      kb("↑↓") + chalk.gray(" nav  ") + kb("esc") + chalk.gray(" quit"),
    ];
  }

  function drawContent() {
    const cols    = C();
    const v       = vis();
    const visible = allRows.slice(scrollTop, scrollTop + v);
    let out = "";

    for (let i = 0; i < v; i++) {
      out += at(getNR() + 1 + i, 1) + clr();
      const row = visible[i];
      if (!row) continue;
      const active = (scrollTop + i) === cursor;

      if (row.kind === "header") {
        const b     = buckets[row.bucketIdx];
        const label = `  ${b.label}  (${b.entries.length} commands)`;
        out += active ? chalk.bgYellow.black.bold(label.slice(0, cols).padEnd(cols)) : chalk.yellow.bold(label.slice(0, cols));
      } else {
        const { cmd, ts } = row.entry;
        const timeStr = ts ? chalk.gray(new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : "     ";
        const maxCmd  = cols - 10;
        const display = cmd.length > maxCmd ? cmd.slice(0, maxCmd - 1) + "…" : cmd;
        const padded  = ("    " + display).padEnd(cols - 7);
        out += active ? chalk.bgWhite.black.bold(padded) + "  " + timeStr : chalk.white(padded) + "  " + timeStr;
      }
    }

    w(out);
    const n = totalCmds();
    drawFooter(getNR() + 1 + v, allRows.length, scrollTop, v, `${n} command${n === 1 ? "" : "s"}`);
  }

  function render() {
    drawNavbar(buildNavHints(), `${allRows.length}R × 1C`);
    drawContent();
  }

  function fullRedraw() { clearScreen(); adjustScroll(); render(); }

  function cleanup() {
    process.stdout.removeListener("resize", onResize);
    stdin.removeAllListeners("data");
    exitAlt();
  }

  function exit() {
    cleanup();
    const remaining = buckets.flatMap((b) => b.entries);
    setTimeout(() => onDone(remaining), 20);
  }

  function deleteAtCursor() {
    if (!allRows.length) return;
    const row = allRows[cursor];
    if (row.kind === "header") {
      buckets[row.bucketIdx].entries = [];
    } else {
      buckets[row.bucketIdx].entries = buckets[row.bucketIdx].entries.filter((e) => e.cmd !== row.entry.cmd);
    }
    allRows = buildRows();
    if (!allRows.length) return exit();
    cursor = Math.min(cursor, allRows.length - 1);
    adjustScroll(); render();
  }

  function showConfirmDeleteAll() {
    const mid   = Math.floor(R() / 2);
    const line1 = chalk.red.bold("  Delete all history?") + " " + chalk.gray("This cannot be undone.");
    const line2 = "  " + chalk.bgRed.white.bold(" y ") + chalk.gray("  yes      ") + chalk.bgGray.white.bold(" n ") + chalk.gray("  no / esc");
    w(at(mid - 1, 1) + clr() + line1 + at(mid, 1) + clr() + line2 + at(mid + 1, 1) + clr());
    stdin.removeListener("data", onKey);
    stdin.on("data", function onConfirm(k: string) {
      if (k === "y" || k === "Y") { stdin.removeListener("data", onConfirm); buckets.forEach((b) => { b.entries = []; }); return exit(); }
      if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") { stdin.removeListener("data", onConfirm); fullRedraw(); stdin.on("data", onKey); }
    });
  }

  function onResize() { fullRedraw(); }

  function onKey(raw: string) {
    if (raw === "\u001b[A") { if (cursor > 0) { cursor--; adjustScroll(); render(); } return; }
    if (raw === "\u001b[B") { if (cursor < allRows.length - 1) { cursor++; adjustScroll(); render(); } return; }
    if (raw === "\u001b" || raw === "\u0003" || raw === "q") return exit();
    if (raw.startsWith("\u001b")) return;
    if (raw === "D") return showConfirmDeleteAll();
    if (raw === "d" || raw === "\x7f") return deleteAtCursor();
  }

  process.stdout.on("resize", onResize);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  stdin.on("data", onKey);
  enterAlt(); fullRedraw();
}