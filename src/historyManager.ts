import fs from "fs";
import path from "path";
import chalk from "chalk";

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
    fs.writeFileSync(
      HISTORY_FILE,
      [...clean].reverse().map((e) => `${e.ts}|${e.cmd}`).join("\n") + "\n",
      "utf8"
    );
  } catch {}
}

export function entriesToStrings(entries: HistoryEntry[]): string[] {
  return entries.map((e) => e.cmd);
}

export function pushEntry(entries: HistoryEntry[], cmd: string): HistoryEntry[] {
  return [{ cmd, ts: Date.now() }, ...entries.filter((e) => e.cmd !== cmd)].slice(0, HISTORY_SIZE);
}

type Bucket = { label: string; entries: HistoryEntry[] };

function groupByTime(entries: HistoryEntry[]): Bucket[] {
  const now = Date.now();
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const today = d.getTime();
  const yesterday = today - 86400000;
  const week = today - 7 * 86400000;
  const b: Bucket[] = [
    { label: "Last hour", entries: [] },
    { label: "Today",     entries: [] },
    { label: "Yesterday", entries: [] },
    { label: "This week", entries: [] },
    { label: "Older",     entries: [] },
  ];
  for (const e of entries) {
    const age = now - e.ts;
    if      (e.ts === 0 || e.ts < week) b[4].entries.push(e);
    else if (e.ts < yesterday)          b[3].entries.push(e);
    else if (e.ts < today)              b[2].entries.push(e);
    else if (age < 3_600_000)           b[0].entries.push(e);
    else                                b[1].entries.push(e);
  }
  return b.filter((x) => x.entries.length > 0);
}

type Row =
  | { kind: "header"; bucketIdx: number }
  | { kind: "entry";  entry: HistoryEntry; bucketIdx: number };

export function showHistoryManager(entries: HistoryEntry[], onDone: (u: HistoryEntry[]) => void) {
  const stdin = process.stdin;

  if (entries.length === 0) {
    console.log(chalk.gray("  (no command history)"));
    return onDone(entries);
  }

  const buckets = groupByTime(entries);
  const COLS = process.stdout.columns || 80;
  const TERM_ROWS = (process.stdout.rows || 24) - 4;
  const VISIBLE = Math.min(TERM_ROWS, 20);

  function buildRows(): Row[] {
    const r: Row[] = [];
    buckets.forEach((b, bi) => {
      if (b.entries.length === 0) return;
      r.push({ kind: "header", bucketIdx: bi });
      b.entries.forEach((e) => r.push({ kind: "entry", entry: e, bucketIdx: bi }));
    });
    return r;
  }

  let rows = buildRows();
  let cursor = 0;
  let scrollTop = 0;
  let lastRenderedLines = 0;

  function adjustScroll() {
    if (cursor < scrollTop) scrollTop = cursor;
    if (cursor >= scrollTop + VISIBLE) scrollTop = cursor - VISIBLE + 1;
  }

  function renderHint(): string {
    const k = (s: string) => chalk.bgGray.white.bold(` ${s} `);
    const isOnHeader = rows[cursor]?.kind === "header";
    const scrollInfo = rows.length > VISIBLE
      ? chalk.dim(` [${cursor + 1}/${rows.length}]`)
      : "";
    return " " + k("↑↓") + chalk.gray(" navigate  ") +
      k("d") + chalk.gray(isOnHeader ? " delete group  " : " delete entry  ") +
      k("D") + chalk.gray(" delete all  ") +
      k("esc") + chalk.gray(" quit") +
      scrollInfo + "\x1b[K";
  }

  function render() {
    let frame = "";

    if (lastRenderedLines > 0) {
      frame += `\x1b[${lastRenderedLines}A\r\x1b[J`;
    }

    frame += renderHint() + "\n\x1b[K\n";

    const visible = rows.slice(scrollTop, scrollTop + VISIBLE);

    for (const row of visible) {
      const i = rows.indexOf(row);
      const active = i === cursor;

      if (row.kind === "header") {
        const b = buckets[row.bucketIdx];
        const label = `  ${b.label}  (${b.entries.length} commands)`;
        frame += active
          ? chalk.bgYellow.black.bold(label.padEnd(COLS - 1)) + "\x1b[K\n"
          : chalk.yellow.bold(label) + "\x1b[K\n";
      } else {
        const { cmd, ts } = row.entry;
        const time = ts
          ? chalk.gray(new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
          : "";
        const maxCmd = COLS - 12;
        const display = cmd.length > maxCmd ? cmd.slice(0, maxCmd - 1) + "…" : cmd;
        const padded = ("    " + display).padEnd(COLS - 10);
        frame += active
          ? chalk.bgWhite.black.bold(padded) + "  " + time + "\x1b[K\n"
          : chalk.white(padded) + "  " + time + "\x1b[K\n";
      }
    }

    if (rows.length > VISIBLE) {
      const pct = Math.round(((scrollTop + VISIBLE) / rows.length) * 100);
      const more = rows.length - (scrollTop + VISIBLE);
      const indicator = more > 0
        ? chalk.dim(`  ↓ ${more} more`)
        : chalk.dim("  (end)");
      frame += indicator + "\x1b[K\n";
      lastRenderedLines = 2 + visible.length + 1;
    } else {
      lastRenderedLines = 2 + visible.length;
    }

    process.stdout.write(frame);
  }

  function clearUI() {
    if (lastRenderedLines > 0) {
      process.stdout.write(`\x1b[${lastRenderedLines}A\r\x1b[J`);
      lastRenderedLines = 0;
    }
  }

  function cleanup() {
    stdin.removeAllListeners("data");
    if (stdin.isTTY) stdin.setRawMode(false);
    process.stdout.write("\x1b[?25h");
  }

  function exit() {
    clearUI();
    cleanup();
    const remaining = buckets.flatMap((b) => b.entries);
    setTimeout(() => onDone(remaining), 20);
  }

  function deleteAtCursor() {
    if (rows.length === 0) return;
    const row = rows[cursor];
    if (row.kind === "header") {
      buckets[row.bucketIdx].entries = [];
    } else {
      buckets[row.bucketIdx].entries = buckets[row.bucketIdx].entries.filter(
        (e) => e.cmd !== row.entry.cmd
      );
    }
    rows = buildRows();
    if (rows.length === 0) return exit();
    cursor = Math.min(cursor, rows.length - 1);
    adjustScroll();
    render();
  }

  function onKey(raw: string) {
    if (raw === "\u001b[A") {
      if (cursor > 0) { cursor--; adjustScroll(); render(); }
      return;
    }
    if (raw === "\u001b[B") {
      if (cursor < rows.length - 1) { cursor++; adjustScroll(); render(); }
      return;
    }
    if (raw === "\u001b") return exit();
    if (raw.startsWith("\u001b")) return;
    if (raw === "\u0003") return exit();
    if (raw === "D") {
      const msg = `\n  ${chalk.red.bold("Delete all history?")} ${chalk.gray("This cannot be undone.")}\n` +
                  `  ${chalk.bgRed.white.bold(" y ")} ${chalk.gray("yes    ")}${chalk.bgGray.white.bold(" n ")} ${chalk.gray("no / esc")}\n`;
      process.stdout.write(msg);
      stdin.removeListener("data", onKey);
      stdin.on("data", function onConfirm(k: string) {
        process.stdout.write(`\x1b[3A\r\x1b[J`);
        if (k === "y" || k === "Y") {
          stdin.removeListener("data", onConfirm);
          buckets.forEach((b) => { b.entries = []; });
          return exit();
        }
        if (k === "n" || k === "N" || k === "\u001b" || k === "\u0003") {
          stdin.removeListener("data", onConfirm);
          stdin.on("data", onKey);
        }
      });
      return;
    }
    if (raw === "d" || raw === "\x7f") return deleteAtCursor();
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write("\x1b[?25l");
  stdin.on("data", onKey);

  lastRenderedLines = 0;
  render();
}