import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { w, at, clr, C, R, FOOTER_ROWS, getNR, drawNavbar, drawFooter, kb, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

export type GeneralEventKind =
  | "command"
  | "copy"
  | "move"
  | "rename"
  | "trash"
  | "restore"
  | "delete"
  | "empty_trash";

export type GeneralEvent = {
  id:     string;
  kind:   GeneralEventKind;
  label:  string;
  detail: string;
  ts:     number;
};

type Category = "commands" | "file_mutations" | "trash_ops";

const LOG_FILE      = path.join(os.homedir(), ".fsh_general_history.json");
const MAX_EVENTS    = 500;
const PREVIEW_COUNT = 5;

let events: GeneralEvent[] = [];

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function loadGeneralHistory(): void {
  try { events = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); }
  catch { events = []; }
}

function saveGeneralHistory(): void {
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(events, null, 2), "utf8"); }
  catch {}
}

export function logEvent(kind: GeneralEventKind, label: string, detail: string): void {
  if (kind === "command") {
    events = events.filter((e) => !(e.kind === "command" && e.label === label));
  }
  const e: GeneralEvent = { id: makeId(), kind, label, detail, ts: Date.now() };
  events.unshift(e);
  if (events.length > MAX_EVENTS) events = events.slice(0, MAX_EVENTS);
  saveGeneralHistory();
}

export function deleteCommandEvents(cmd: string): void {
  events = events.filter((e) => !(e.kind === "command" && e.label === cmd));
  saveGeneralHistory();
}

export function deleteAllCommandEvents(): void {
  events = events.filter((e) => e.kind !== "command");
  saveGeneralHistory();
}

export function getGeneralEvents(): GeneralEvent[] { return events; }

function categoryOf(kind: GeneralEventKind): Category {
  if (kind === "command") return "commands";
  if (kind === "trash" || kind === "restore" || kind === "delete" || kind === "empty_trash") return "trash_ops";
  return "file_mutations";
}

const CATEGORY_LABEL: Record<Category, string> = {
  commands:       "Commands",
  file_mutations: "File & Folder Mutations",
  trash_ops:      "Trash Operations",
};

const CATEGORY_COLOR: Record<Category, (s: string) => string> = {
  commands:       chalk.green.bold,
  file_mutations: chalk.cyan.bold,
  trash_ops:      chalk.yellow.bold,
};

const ENTRY_COLOR: Record<Category, (s: string) => string> = {
  commands:       chalk.green,
  file_mutations: chalk.cyan,
  trash_ops:      chalk.yellow,
};

function kindTag(kind: GeneralEventKind): string {
  switch (kind) {
    case "command":     return "";
    case "copy":        return chalk.cyan("copy → ");
    case "move":        return chalk.magenta("move → ");
    case "rename":      return chalk.blue("rename → ");
    case "trash":       return chalk.yellow("trash  ");
    case "restore":     return chalk.green("restore  ");
    case "delete":      return chalk.red("delete  ");
    case "empty_trash": return chalk.red("empty trash  ");
  }
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type Row =
  | { kind: "cat_header"; cat: Category; count: number; expanded: boolean }
  | { kind: "entry";      event: GeneralEvent; cat: Category }
  | { kind: "show_more";  cat: Category; remaining: number };

function buildRows(evts: GeneralEvent[], expanded: Record<Category, boolean>): Row[] {
  const cats: Category[] = ["commands", "file_mutations", "trash_ops"];
  const buckets: Record<Category, GeneralEvent[]> = { commands: [], file_mutations: [], trash_ops: [] };
  for (const e of evts) buckets[categoryOf(e.kind)].push(e);

  const rows: Row[] = [];
  for (const cat of cats) {
    const items = buckets[cat];
    if (!items.length) continue;
    rows.push({ kind: "cat_header", cat, count: items.length, expanded: expanded[cat] });
    if (expanded[cat]) {
      for (const item of items) rows.push({ kind: "entry", event: item, cat });
    } else {
      const preview = items.slice(0, PREVIEW_COUNT);
      for (const item of preview) rows.push({ kind: "entry", event: item, cat });
      const remaining = items.length - PREVIEW_COUNT;
      if (remaining > 0) rows.push({ kind: "show_more", cat, remaining });
    }
  }
  return rows;
}

function buildNavHints(): string[] {
  return [
    kb("↑↓") + chalk.gray(" navigate  ") + kb("enter") + chalk.gray(" expand / detail  ") + kb("esc") + chalk.gray(" back"),
    kb("↑↓") + chalk.gray(" nav  ") + kb("enter") + chalk.gray(" expand / detail  ") + kb("esc") + chalk.gray(" back"),
    kb("↑↓") + chalk.gray(" nav  ") + kb("enter") + chalk.gray(" expand  ") + kb("esc") + chalk.gray(" back"),
    kb("↑↓") + chalk.gray(" nav  ") + kb("esc") + chalk.gray(" back"),
  ];
}

function buildCmdEditHints(selCount: number): string[] {
  const sb = selCount > 0 ? "  " + chalk.magenta.bold(`${selCount} selected`) + chalk.dim("  a deselect all") : "";
  return [
    kb("↑↓") + chalk.gray(" nav  ") + kb("spc") + chalk.gray(" select  ") + kb("a") + chalk.gray(" all  ") + kb("d") + chalk.gray(" delete selected  ") + kb("D") + chalk.gray(" delete all  ") + kb("esc") + chalk.gray(" back") + sb,
    kb("↑↓") + chalk.gray(" nav  ") + kb("spc") + chalk.gray(" sel  ") + kb("a") + chalk.gray(" all  ") + kb("d") + chalk.gray(" delete  ") + kb("D") + chalk.gray(" all  ") + kb("esc") + chalk.gray(" back") + sb,
    kb("↑↓") + chalk.gray(" nav  ") + kb("spc") + chalk.gray(" sel  ") + kb("d") + chalk.gray(" del  ") + kb("esc") + chalk.gray(" back") + sb,
    kb("esc") + chalk.gray(" back"),
  ];
}

function drawContent(rows: Row[], sel: number, scrollTop: number, vis: number, selected?: Set<string>): void {
  const cols = C();
  let out = "";

  for (let i = 0; i < vis; i++) {
    out += at(getNR() + 1 + i, 1) + clr();
    const row = rows[scrollTop + i];
    if (!row) continue;
    const active = (scrollTop + i) === sel;

    if (row.kind === "cat_header") {
      const colorFn = CATEGORY_COLOR[row.cat];
      const arrow   = row.expanded ? "▾ " : "▸ ";
      const label   = arrow + CATEGORY_LABEL[row.cat] + "  (" + row.count + ")";
      out += active ? chalk.bgWhite.black.bold(label.padEnd(cols)) : colorFn(label);
    } else if (row.kind === "show_more") {
      const colorFn = CATEGORY_COLOR[row.cat];
      const label   = `    ↓ ${row.remaining} more — press enter to show`;
      out += active ? chalk.bgWhite.black.bold(label.padEnd(cols)) : colorFn(label);
    } else {
      const e       = row.event;
      const tag     = kindTag(e.kind);
      const timeStr = fmtTime(e.ts);
      const timeLen = timeStr.length;
      const tagLen  = visibleLen(tag);
      const isSel   = selected?.has(e.id) ?? false;
      const maxLbl  = Math.max(8, cols - 4 - tagLen - timeLen - 3 - (isSel ? 2 : 0));
      const lbl     = e.label.length > maxLbl ? e.label.slice(0, maxLbl - 1) + "…" : e.label;
      const entryColor = ENTRY_COLOR[row.cat];
      const prefix  = isSel ? "✓ " : "  ";
      const content = prefix + tag + entryColor(lbl);
      const pad     = Math.max(1, cols - 4 - visibleLen(content) - timeLen - 2);

      if (active && isSel) {
        const rawFull = "  " + prefix + tag + lbl + " ".repeat(Math.max(1, cols - 4 - (prefix + tag + lbl).length - timeLen - 2)) + "  " + timeStr;
        out += chalk.bgMagenta.white.bold(padOrTrim(rawFull, cols));
      } else if (active) {
        const rawFull = "    " + tag + lbl + " ".repeat(Math.max(1, cols - 4 - (tag + lbl).length - timeLen - 2)) + "  " + timeStr;
        out += chalk.bgWhite.black.bold(padOrTrim(rawFull, cols));
      } else if (isSel) {
        out += "  " + chalk.magenta(prefix + tag + lbl) + " ".repeat(pad) + "  " + chalk.dim(timeStr);
      } else {
        out += "    " + content + " ".repeat(pad) + "  " + chalk.dim(timeStr);
      }
    }
  }

  const more    = rows.length - (scrollTop + vis);
  const total   = events.length;
  const leftStr = total === 0 ? "  (no history yet)" : `  ${total} event${total === 1 ? "" : "s"} total`;
  const rightStr = rows.length > vis ? (more > 0 ? `  ↓ ${more} more  ` : "  (end)  ") : "";
  const gap = Math.max(0, cols - visibleLen(leftStr) - visibleLen(rightStr));
  out += at(getNR() + 1 + vis, 1) + clr() + chalk.dim(leftStr) + " ".repeat(gap) + chalk.dim(rightStr);
  w(out);
}

function drawDetail(e: GeneralEvent): void {
  const avail = R() - getNR(); let out = ""; let ln = 0;
  function line(s: string) { if (ln >= avail) return; out += at(getNR() + 1 + ln, 1) + clr() + s; ln++; }
  const cat    = categoryOf(e.kind);
  const catClr = CATEGORY_COLOR[cat];
  line(""); line("  " + catClr(CATEGORY_LABEL[cat]) + chalk.dim("  ·  ") + kindTag(e.kind).trimEnd() + "  " + chalk.dim(fmtTime(e.ts)));
  line("  " + chalk.dim("id: " + e.id)); line(""); line("  " + chalk.dim("what")); line("  " + chalk.white(e.label));
  if (e.detail) { line(""); line("  " + chalk.dim("detail")); for (const dl of e.detail.split("\n")) line("  " + chalk.white(dl)); }
  for (let i = ln; i < avail; i++) out += at(getNR() + 1 + i, 1) + clr();
  w(out);
}

export function showGeneralHistory(onBack: () => void) {
  loadGeneralHistory();

  const { loadHistoryEntries } = require("./historyManager");
  const liveEntries: { cmd: string }[] = loadHistoryEntries();
  const liveCmds = new Set(liveEntries.map((e: { cmd: string }) => e.cmd));
  events = events.filter((e) => e.kind !== "command" || liveCmds.has(e.label));
  saveGeneralHistory();

  const stdin = process.stdin;

  const expanded: Record<Category, boolean> = { commands: false, file_mutations: false, trash_ops: false };

  let rows      = buildRows(events, expanded);
  let sel       = 0;
  let scrollTop = 0;

  function vis() { return Math.max(1, R() - getNR() - FOOTER_ROWS - 1); }

  function adjustScroll() {
    const v = vis();
    if (sel < scrollTop) scrollTop = sel;
    if (sel >= scrollTop + v) scrollTop = sel - v + 1;
  }

  function rebuild() {
    rows = buildRows(events, expanded);
    sel  = Math.min(sel, Math.max(0, rows.length - 1));
    adjustScroll();
  }

  function fullDraw() {
    drawNavbar(buildNavHints(), `${rows.length}R × 1C`);
    drawContent(rows, sel, scrollTop, vis());
  }

  function onResize() { w("\x1b[2J"); adjustScroll(); fullDraw(); }

  function cleanup() {
    process.stdout.removeListener("resize", onResize);
    stdin.removeAllListeners("data");
    w("\x1b[2J\x1b[H"); exitAlt();
  }

  function exit() { cleanup(); setTimeout(onBack, 20); }

  function openCommandEdit() {
    const cmdEvents = events.filter(e => e.kind === "command");
    if (!cmdEvents.length) return;

    let cmdSel     = 0;
    let cmdScroll  = 0;
    let cmdSelected = new Set<string>();

    function cmdVis() { return Math.max(1, R() - getNR() - FOOTER_ROWS - 1); }

    function cmdAdjust() {
      const v = cmdVis();
      if (cmdSel < cmdScroll) cmdScroll = cmdSel;
      if (cmdSel >= cmdScroll + v) cmdScroll = cmdSel - v + 1;
    }

    function toggleCmdSel() {
      const id = cmdEvents[cmdSel]?.id; if (!id) return;
      if (cmdSelected.has(id)) cmdSelected.delete(id); else cmdSelected.add(id);
      drawCmd();
    }

    function selectAllCmd() {
      if (cmdSelected.size === cmdEvents.length) cmdSelected.clear();
      else cmdSelected = new Set(cmdEvents.map(e => e.id));
      drawCmd();
    }

    function drawCmd() {
      const v    = cmdVis();
      const cols = C();
      drawNavbar(buildCmdEditHints(cmdSelected.size), `${cmdEvents.length}R × 1C`);
      let out = "";
      for (let i = 0; i < v; i++) {
        out += at(getNR() + 1 + i, 1) + clr();
        const e = cmdEvents[cmdScroll + i]; if (!e) continue;
        const active = (cmdScroll + i) === cmdSel;
        const isSel  = cmdSelected.has(e.id);
        const ts     = fmtTime(e.ts);
        const prefix = isSel ? "✓   " : "    ";
        const maxLbl = cols - 10;
        const lbl    = e.label.length > maxLbl ? e.label.slice(0, maxLbl - 1) + "…" : e.label;
        const padded = (prefix + lbl).padEnd(cols - 7);
        if (active && isSel)   out += chalk.bgMagenta.white.bold(padded) + "  " + chalk.gray(ts);
        else if (active)       out += chalk.bgWhite.black.bold(padded) + "  " + chalk.gray(ts);
        else if (isSel)        out += chalk.magenta(padded) + "  " + chalk.dim(ts);
        else                   out += chalk.green(padded) + "  " + chalk.dim(ts);
      }
      const more    = cmdEvents.length - (cmdScroll + v);
      const leftStr = `  ${cmdEvents.length} command${cmdEvents.length === 1 ? "" : "s"}`;
      const rightStr = cmdEvents.length > v ? (more > 0 ? `  ↓ ${more} more  ` : "  (end)  ") : "";
      const gap = Math.max(0, cols - visibleLen(leftStr) - visibleLen(rightStr));
      out += at(getNR() + 1 + v, 1) + clr() + chalk.dim(leftStr) + " ".repeat(gap) + chalk.dim(rightStr);
      w(out);
    }

    function deleteSelected() {
      const toDelete = cmdSelected.size > 0 ? Array.from(cmdSelected) : (cmdEvents[cmdSel] ? [cmdEvents[cmdSel].id] : []);
      if (!toDelete.length) return;
      const labels   = cmdEvents.filter(e => toDelete.includes(e.id)).map(e => e.label);
      events         = events.filter(e => !toDelete.includes(e.id));
      for (const lbl of labels) { const { deleteCommandEvents: dc } = require("./historyManager"); }
      saveGeneralHistory();
      cmdSelected.clear();
      const newCmdEvents = events.filter(e => e.kind === "command");
      if (!newCmdEvents.length) { backFromCmd(); return; }
      cmdEvents.splice(0, cmdEvents.length, ...newCmdEvents);
      cmdSel = Math.min(cmdSel, cmdEvents.length - 1);
      cmdAdjust(); drawCmd();
    }

    function deleteAllCmd() {
      const { deleteAllCommandEvents: dac } = require("./historyManager");
      events = events.filter(e => e.kind !== "command");
      saveGeneralHistory();
      backFromCmd();
    }

    function backFromCmd() {
      process.stdout.removeListener("resize", onCmdResize);
      stdin.removeListener("data", onCmdKey);
      process.stdout.on("resize", onResize);
      rebuild();
      w("\x1b[2J"); fullDraw();
      stdin.on("data", onKey);
    }

    function onCmdResize() { w("\x1b[2J"); drawCmd(); }
    process.stdout.removeListener("resize", onResize);
    process.stdout.on("resize", onCmdResize);
    stdin.removeListener("data", onKey);

    function onCmdKey(raw: string) {
      if (raw === "\u001b[A") { if (cmdSel > 0) { cmdSel--; cmdAdjust(); drawCmd(); } return; }
      if (raw === "\u001b[B") { if (cmdSel < cmdEvents.length - 1) { cmdSel++; cmdAdjust(); drawCmd(); } return; }
      if (raw === "\u001b" || raw === "\u0003") {
        if (cmdSelected.size > 0) { cmdSelected.clear(); drawCmd(); } else backFromCmd();
        return;
      }
      if (raw.startsWith("\u001b")) return;
      if (raw === " ")  { toggleCmdSel(); return; }
      if (raw === "a")  { selectAllCmd(); return; }
      if (raw === "d" || raw === "\x7f") { deleteSelected(); return; }
      if (raw === "D")  { deleteAllCmd(); return; }
    }

    stdin.on("data", onCmdKey);
    w("\x1b[2J"); drawCmd();
  }

  function handleEnter() {
    if (!rows.length) return;
    const row = rows[sel];
    if (row.kind === "cat_header") {
      if (row.cat === "commands") { openCommandEdit(); return; }
      expanded[row.cat] = !expanded[row.cat];
      rebuild(); fullDraw(); return;
    }
    if (row.kind === "show_more") { expanded[row.cat] = true; rebuild(); fullDraw(); return; }
    if (row.kind === "entry") showDetail(row.event);
  }

  function showDetail(e: GeneralEvent) {
    process.stdout.removeListener("resize", onResize);
    function onDetailResize() { w("\x1b[2J"); drawNavbar([kb("esc") + chalk.gray(" back")]); drawDetail(e); }
    process.stdout.on("resize", onDetailResize);
    function onDetailKey(k: string) {
      if (k === "\u0003") { stdin.removeListener("data", onDetailKey); process.stdout.removeListener("resize", onDetailResize); cleanup(); setTimeout(onBack, 20); return; }
      if (k === "\u001b" || k === "q") { stdin.removeListener("data", onDetailKey); process.stdout.removeListener("resize", onDetailResize); process.stdout.on("resize", onResize); w("\x1b[2J"); fullDraw(); stdin.on("data", onKey); }
    }
    stdin.removeListener("data", onKey); stdin.on("data", onDetailKey);
    w("\x1b[2J"); drawNavbar([kb("esc") + chalk.gray(" back")]); drawDetail(e);
  }

  function onKey(raw: string) {
    if (raw === "\u001b[A") { if (sel > 0) { sel--; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u001b[B") { if (sel < rows.length - 1) { sel++; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u0003" || raw === "\u001b" || raw === "q") { exit(); return; }
    if (raw.startsWith("\u001b")) return;
    if (raw === "\r") { handleEnter(); return; }
  }

  process.stdout.on("resize", onResize);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume(); stdin.setEncoding("utf8"); stdin.on("data", onKey);
  enterAlt(); w("\x1b[2J"); fullDraw();
}