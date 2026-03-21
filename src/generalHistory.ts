import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { w, at, clr, C, R, drawNavbar, NavItem, drawBottomBar, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

export type GeneralEventKind = "command" | "copy" | "move" | "rename" | "trash" | "restore" | "delete" | "empty_trash";
export type GeneralEvent = { id: string; kind: GeneralEventKind; label: string; detail: string; ts: number; };
type Category = "commands" | "file_mutations" | "trash_ops";

const LOG_FILE = path.join(os.homedir(), ".fsh_general_history.json");
const MAX_EVENTS = 500; const PREVIEW_COUNT = 5;
let events: GeneralEvent[] = [];

function makeId(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function persist(): void { try { fs.writeFileSync(LOG_FILE, JSON.stringify(events, null, 2), "utf8"); } catch {} }

export function loadGeneralHistory(): void { try { events = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch { events = []; } }
export function logEvent(kind: GeneralEventKind, label: string, detail: string): void {
  if (kind === "command") events = events.filter(e => !(e.kind === "command" && e.label === label));
  events.unshift({ id: makeId(), kind, label, detail, ts: Date.now() });
  if (events.length > MAX_EVENTS) events = events.slice(0, MAX_EVENTS); persist();
}
export function deleteCommandEvents(cmd: string): void { events = events.filter(e => !(e.kind === "command" && e.label === cmd)); persist(); }
export function deleteAllCommandEvents(): void { events = events.filter(e => e.kind !== "command"); persist(); }
export function getGeneralEvents(): GeneralEvent[] { return events; }

function categoryOf(kind: GeneralEventKind): Category {
  if (kind === "command") return "commands";
  if (kind === "trash" || kind === "restore" || kind === "delete" || kind === "empty_trash") return "trash_ops";
  return "file_mutations";
}
const CATEGORY_LABEL: Record<Category, string> = { commands: "Commands", file_mutations: "File & Folder Mutations", trash_ops: "Trash Operations" };
const CATEGORY_COLOR: Record<Category, (s: string) => string> = { commands: chalk.green.bold, file_mutations: chalk.cyan.bold, trash_ops: chalk.yellow.bold };
const ENTRY_COLOR: Record<Category, (s: string) => string> = { commands: chalk.green, file_mutations: chalk.cyan, trash_ops: chalk.yellow };

function kindTag(kind: GeneralEventKind): string {
  switch (kind) {
    case "command": return ""; case "copy": return chalk.cyan("copy → "); case "move": return chalk.magenta("move → ");
    case "rename": return chalk.blue("rename → "); case "trash": return chalk.yellow("trash  ");
    case "restore": return chalk.green("restore  "); case "delete": return chalk.red("delete  ");
    case "empty_trash": return chalk.red("empty trash  ");
  }
}
function fmtTime(ts: number): string { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

type Row = { kind: "cat_header"; cat: Category; count: number; expanded: boolean } | { kind: "entry"; event: GeneralEvent; cat: Category } | { kind: "show_more"; cat: Category; remaining: number };

function buildRows(evts: GeneralEvent[], expanded: Record<Category, boolean>): Row[] {
  const cats: Category[] = ["commands", "file_mutations", "trash_ops"];
  const buckets: Record<Category, GeneralEvent[]> = { commands: [], file_mutations: [], trash_ops: [] };
  for (const e of evts) buckets[categoryOf(e.kind)].push(e);
  const rows: Row[] = [];
  for (const cat of cats) {
    const items = buckets[cat]; if (!items.length) continue;
    rows.push({ kind: "cat_header", cat, count: items.length, expanded: expanded[cat] });
    if (expanded[cat]) { for (const item of items) rows.push({ kind: "entry", event: item, cat }); }
    else { for (const item of items.slice(0, PREVIEW_COUNT)) rows.push({ kind: "entry", event: item, cat }); const rem = items.length - PREVIEW_COUNT; if (rem > 0) rows.push({ kind: "show_more", cat, remaining: rem }); }
  }
  return rows;
}

function drawContentRows(rows: Row[], sel: number, scrollTop: number, vis: number, start: number, selected?: Set<string>): void {
  const cols = C(); let out = "";
  for (let i = 0; i < vis; i++) {
    out += at(start + i, 1) + clr(); const row = rows[scrollTop + i]; if (!row) continue; const active = (scrollTop + i) === sel;
    if (row.kind === "cat_header") {
      const colorFn = CATEGORY_COLOR[row.cat]; const arrow = row.expanded ? "▾ " : "▸ "; const label = arrow + CATEGORY_LABEL[row.cat] + "  (" + row.count + ")";
      out += active ? chalk.bgWhite.black.bold(label.padEnd(cols)) : colorFn(label);
    } else if (row.kind === "show_more") {
      const colorFn = CATEGORY_COLOR[row.cat]; const label = `    ↓ ${row.remaining} more — press enter to show`;
      out += active ? chalk.bgWhite.black.bold(label.padEnd(cols)) : colorFn(label);
    } else {
      const e = row.event; const tag = kindTag(e.kind); const timeStr = fmtTime(e.ts); const timeLen = timeStr.length; const tagLen = visibleLen(tag);
      const isSel = selected?.has(e.id) ?? false; const maxLbl = Math.max(8, cols - 4 - tagLen - timeLen - 3 - (isSel ? 2 : 0));
      const lbl = e.label.length > maxLbl ? e.label.slice(0, maxLbl - 1) + "…" : e.label;
      const eColor = ENTRY_COLOR[row.cat]; const prefix = isSel ? "✓ " : "  ";
      const content = prefix + tag + eColor(lbl); const pad = Math.max(1, cols - 4 - visibleLen(content) - timeLen - 2);
      if (active && isSel) { const raw = "  " + prefix + tag + lbl + " ".repeat(Math.max(1, cols - 4 - (prefix + tag + lbl).length - timeLen - 2)) + "  " + timeStr; out += chalk.bgMagenta.white.bold(padOrTrim(raw, cols)); }
      else if (active) { const raw = "    " + tag + lbl + " ".repeat(Math.max(1, cols - 4 - (tag + lbl).length - timeLen - 2)) + "  " + timeStr; out += chalk.bgWhite.black.bold(padOrTrim(raw, cols)); }
      else if (isSel) { out += "  " + chalk.magenta(prefix + tag + lbl) + " ".repeat(pad) + "  " + chalk.dim(timeStr); }
      else { out += "    " + content + " ".repeat(pad) + "  " + chalk.dim(timeStr); }
    }
  }
  w(out);
}

function drawDetailContent(e: GeneralEvent, start: number, v: number): void {
  let out = ""; let ln = 0;
  function line(s: string) { if (ln >= v) return; out += at(start + ln, 1) + clr() + s; ln++; }
  const cat = categoryOf(e.kind); const catClr = CATEGORY_COLOR[cat];
  line(""); line("  " + catClr(CATEGORY_LABEL[cat]) + chalk.dim("  ·  ") + kindTag(e.kind).trimEnd() + "  " + chalk.dim(fmtTime(e.ts)));
  line("  " + chalk.dim("id: " + e.id)); line(""); line("  " + chalk.dim("what")); line("  " + chalk.white(e.label));
  if (e.detail) { line(""); line("  " + chalk.dim("detail")); for (const dl of e.detail.split("\n")) line("  " + chalk.white(dl)); }
  for (let i = ln; i < v; i++) out += at(start + i, 1) + clr(); w(out);
}

export function showGeneralHistory(onBack: () => void): void {
  loadGeneralHistory();
  const { loadHistoryEntries } = require("./historyManager");
  const liveEntries: { cmd: string }[] = loadHistoryEntries();
  const liveCmds = new Set(liveEntries.map((e: { cmd: string }) => e.cmd));
  events = events.filter(e => e.kind !== "command" || liveCmds.has(e.label)); persist();

  const stdin = process.stdin;
  const expanded: Record<Category, boolean> = { commands: false, file_mutations: false, trash_ops: false };
  let rows = buildRows(events, expanded); let sel = 0; let scrollTop = 0;

  const NAV: NavItem[] = [
    { key: "↑↓", label: "Navigate"      },
    { key: "Ent", label: "Expand/Detail" },
    { key: "Esc", label: "Back"          },
  ];

  function NR(): number { return 2; }
  function vis(): number { return Math.max(1, R() - NR() - 2); }
  function start(): number { return NR() + 2; }
  function adjustScroll(): void { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }
  function rebuild(): void { rows = buildRows(events, expanded); sel = Math.min(sel, Math.max(0, rows.length - 1)); adjustScroll(); }
  function buildLeft(): string { return `Activity  ${events.length} event${events.length === 1 ? "" : "s"}`; }
  function buildRight(): string { if (rows.length <= vis()) return ""; const more = rows.length - (scrollTop + vis()); return more > 0 ? `↓ ${more} more` : "end"; }
  function fullDraw(): void {
    drawNavbar(NAV, NAV.length);
    drawContentRows(rows, sel, scrollTop, vis(), start());
    drawBottomBar(buildLeft(), buildRight());
  }
  function onResize(): void { clearScreen(); adjustScroll(); fullDraw(); }
  function cleanup(): void { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); clearScreen(); exitAlt(); }
  function exit(): void { cleanup(); setTimeout(onBack, 20); }

  function openCommandEdit(): void {
    const cmdEvents = events.filter(e => e.kind === "command"); if (!cmdEvents.length) return;
    let cmdSel = 0; let cmdScroll = 0; let cmdSelected = new Set<string>();

    function CMD_NAV_ROW1(): NavItem[] {
      return [
        { key: "↑↓",  label: "Navigate"   },
        { key: "Spc", label: "Select"      },
        { key: "A",   label: "Select All"  },
        { key: "Esc", label: cmdSelected.size > 0 ? "Deselect" : "Back" },
      ];
    }
    function CMD_NAV_ROW2(): NavItem[] {
      return [
        { key: "D",  label: "Delete"     },
        { key: "^D", label: "Delete All" },
      ];
    }

    function cmdNR(): number { return 2; }
    function cmdVis(): number { return Math.max(1, R() - cmdNR() - 2); }
    function cmdStart(): number { return cmdNR() + 2; }
    function cmdAdjust(): void { const v = cmdVis(); if (cmdSel < cmdScroll) cmdScroll = cmdSel; if (cmdSel >= cmdScroll + v) cmdScroll = cmdSel - v + 1; }
    function cmdBuildLeft(): string { let s = `Commands  ${cmdEvents.length}`; if (cmdSelected.size) s += chalk.magenta(`  ${cmdSelected.size} sel`); return s; }

    function drawCmd(): void {
      const v = cmdVis(); const s = cmdStart(); const cols = C();
      drawNavbar([...CMD_NAV_ROW1(), ...CMD_NAV_ROW2()], CMD_NAV_ROW1().length);
      let out = "";
      for (let i = 0; i < v; i++) {
        out += at(s + i, 1) + clr(); const e = cmdEvents[cmdScroll + i]; if (!e) continue;
        const active = (cmdScroll + i) === cmdSel; const isSel = cmdSelected.has(e.id); const ts = fmtTime(e.ts);
        const prefix = isSel ? "✓   " : "    "; const maxLbl = cols - 10; const lbl = e.label.length > maxLbl ? e.label.slice(0, maxLbl - 1) + "…" : e.label;
        const padded = (prefix + lbl).padEnd(cols - 7);
        if      (active && isSel) out += chalk.bgMagenta.white.bold(padded) + "  " + chalk.gray(ts);
        else if (active)          out += chalk.bgWhite.black.bold(padded)   + "  " + chalk.gray(ts);
        else if (isSel)           out += chalk.magenta(padded)              + "  " + chalk.dim(ts);
        else                      out += chalk.green(padded)                + "  " + chalk.dim(ts);
      }
      w(out); drawBottomBar(cmdBuildLeft(), "");
    }

    function toggleCmdSel(): void { const id = cmdEvents[cmdSel]?.id; if (!id) return; if (cmdSelected.has(id)) cmdSelected.delete(id); else cmdSelected.add(id); drawCmd(); }
    function selectAllCmd(): void { if (cmdSelected.size === cmdEvents.length) cmdSelected.clear(); else cmdSelected = new Set(cmdEvents.map(e => e.id)); drawCmd(); }
    function deleteSelected(): void {
      const toDelete = cmdSelected.size > 0 ? Array.from(cmdSelected) : (cmdEvents[cmdSel] ? [cmdEvents[cmdSel].id] : []);
      if (!toDelete.length) return; events = events.filter(e => !toDelete.includes(e.id)); persist(); cmdSelected.clear();
      const newCmds = events.filter(e => e.kind === "command"); if (!newCmds.length) { backFromCmd(); return; }
      cmdEvents.splice(0, cmdEvents.length, ...newCmds); cmdSel = Math.min(cmdSel, cmdEvents.length - 1); cmdAdjust(); drawCmd();
    }
    function deleteAllCmd(): void { events = events.filter(e => e.kind !== "command"); persist(); backFromCmd(); }
    function backFromCmd(): void { process.stdout.removeListener("resize", onCmdResize); stdin.removeListener("data", onCmdKey); process.stdout.on("resize", onResize); rebuild(); clearScreen(); fullDraw(); stdin.on("data", onKey); }
    const onCmdResize = () => { clearScreen(); drawCmd(); };
    process.stdout.removeListener("resize", onResize); process.stdout.on("resize", onCmdResize); stdin.removeListener("data", onKey);
    function onCmdKey(raw: string): void {
      if (raw === "\u001b[A") { if (cmdSel > 0) { cmdSel--; cmdAdjust(); drawCmd(); } return; }
      if (raw === "\u001b[B") { if (cmdSel < cmdEvents.length - 1) { cmdSel++; cmdAdjust(); drawCmd(); } return; }
      if (raw === "\u001b" || raw === "\u0003") { if (cmdSelected.size > 0) { cmdSelected.clear(); drawCmd(); } else backFromCmd(); return; }
      if (raw.startsWith("\u001b")) return;
      if (raw === " ") { toggleCmdSel(); return; } if (raw === "a") { selectAllCmd(); return; }
      if (raw === "d" || raw === "\x7f") { deleteSelected(); return; } if (raw === "\x04" || raw === "D") { deleteAllCmd(); return; }
    }
    stdin.on("data", onCmdKey); clearScreen(); drawCmd();
  }

  function handleEnter(): void {
    if (!rows.length) return; const row = rows[sel];
    if (row.kind === "cat_header") { if (row.cat === "commands") { openCommandEdit(); return; } expanded[row.cat] = !expanded[row.cat]; rebuild(); fullDraw(); return; }
    if (row.kind === "show_more") { expanded[row.cat] = true; rebuild(); fullDraw(); return; }
    if (row.kind === "entry") showDetail(row.event);
  }

  function showDetail(e: GeneralEvent): void {
    const detailNAV: NavItem[] = [{ key: "Esc", label: "Back" }];
    const dNR = 3; const dStart = dNR + 2; const dVis = () => R() - dNR - 2;
    process.stdout.removeListener("resize", onResize);
    const onDR = () => { clearScreen(); drawNavbar(detailNAV, detailNAV.length); drawDetailContent(e, dStart, dVis()); drawBottomBar(e.label.slice(0, 40), ""); };
    process.stdout.on("resize", onDR);
    function onDetailKey(k: string): void {
      if (k === "\u0003") { stdin.removeListener("data", onDetailKey); process.stdout.removeListener("resize", onDR); cleanup(); setTimeout(onBack, 20); return; }
      if (k === "\u001b" || k === "q") { stdin.removeListener("data", onDetailKey); process.stdout.removeListener("resize", onDR); process.stdout.on("resize", onResize); clearScreen(); fullDraw(); stdin.on("data", onKey); }
    }
    stdin.removeListener("data", onKey); stdin.on("data", onDetailKey);
    clearScreen(); drawNavbar(detailNAV, detailNAV.length); drawDetailContent(e, dStart, dVis()); drawBottomBar(e.label.slice(0, 40), "");
  }

  function onKey(raw: string): void {
    if (raw === "\u001b[A") { if (sel > 0) { sel--; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u001b[B") { if (sel < rows.length - 1) { sel++; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u0003" || raw === "\u001b" || raw === "q") { exit(); return; }
    if (raw.startsWith("\u001b")) return; if (raw === "\r") { handleEnter(); return; }
  }
  process.stdout.on("resize", onResize); if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume(); stdin.setEncoding("utf8"); stdin.on("data", onKey);
  enterAlt(); clearScreen(); fullDraw();
}