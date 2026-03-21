import chalk from "chalk";
import path from "path";
import { getLog, loadLog, FileOp, OpKind } from "./fileOps";
import { w, at, clr, C, R, drawNavbar, NavItem, drawBottomBar, enterAlt, exitAlt, clearScreen, visibleLen, padOrTrim } from "./tui";

function kindLabel(kind: OpKind): string {
  switch (kind) { case "copy": return chalk.cyan.bold("copy  "); case "cut": return chalk.yellow.bold("cut   "); case "move": return chalk.magenta.bold("move  "); case "rename": return chalk.blue.bold("rename"); }
}
function statusBadge(op: FileOp): string { if (op.status === "done") return chalk.green("✓"); if (op.status === "error") return chalk.red("✗"); return chalk.yellow("…"); }
function fmtTime(ts: number): string { return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function homify(p: string): string { const home = process.env.HOME ?? ""; return home && p.startsWith(home) ? "~" + p.slice(home.length) : p; }

function runLogPanel(stdin: NodeJS.ReadStream, onBack: () => void, ownsAltScreen: boolean): void {
  loadLog(); let ops = getLog(); let sel = 0; let scrollTop = 0;
  const NAV: NavItem[] = [{ key: "↑↓", label: "Navigate" }, { key: "Ent", label: "Detail" }, { key: "Esc", label: "Back" }];
  const NR = 2;
  function vis(): number { return Math.max(1, R() - NR - 2); }
  function adjustScroll(): void { const v = vis(); if (sel < scrollTop) scrollTop = sel; if (sel >= scrollTop + v) scrollTop = sel - v + 1; }
  function buildLeft(): string { return `File History  ${ops.length} op${ops.length === 1 ? "" : "s"}`; }
  function buildRight(): string { if (ops.length <= vis()) return ""; const more = ops.length - (scrollTop + vis()); return more > 0 ? `↓ ${more} more` : "end"; }

  function drawLogContent(): void {
    const start = NR + 2; const cols = C(); const v = vis(); let out = "";
    for (let i = 0; i < v; i++) {
      out += at(start + i, 1) + clr(); const op = ops[scrollTop + i]; if (!op) continue;
      const active = (scrollTop + i) === sel; const badge = statusBadge(op); const kLabel = kindLabel(op.kind);
      const srcShort = path.basename(op.srcPath); const timeStr = chalk.dim(fmtTime(op.timestamp));
      const nameStr = srcShort.length > 28 ? srcShort.slice(0, 27) + "…" : srcShort.padEnd(28);
      const left = ` ${badge} ${kLabel}  ${nameStr}`; const pad = Math.max(1, cols - visibleLen(left) - visibleLen(timeStr) - 2);
      if (active) out += chalk.bgWhite.black.bold(padOrTrim(left + " ".repeat(pad) + timeStr, cols)); else out += left + " ".repeat(pad) + timeStr;
    }
    w(out);
  }

  function drawDetailContent(op: FileOp): void {
    const start = NR + 2; const v = R() - NR - 2;
    const kindColor = op.kind === "copy" ? chalk.cyan : op.kind === "move" ? chalk.magenta : op.kind === "rename" ? chalk.blue : chalk.yellow;
    let out = ""; let ln = 0;
    function line(content: string) { if (ln >= v) return; out += at(start + ln, 1) + clr() + content; ln++; }
    line(""); line("  " + kindColor.bold(op.kind.toUpperCase()) + "  " + statusBadge(op) + "  " + chalk.dim(fmtTime(op.timestamp)));
    line("  " + chalk.dim("id: " + op.id)); line(""); line("  " + chalk.dim("from")); line("  " + chalk.white(homify(op.srcPath))); line("");
    if (op.kind === "rename") { line("  " + chalk.dim("renamed to")); line("  " + chalk.white(op.destName)); } else { line("  " + chalk.dim("to")); line("  " + chalk.white(homify(op.destPath))); }
    line(""); line("  " + chalk.dim("type:  ") + chalk.white(op.isDir ? "directory" : "file"));
    if (op.status === "error" && op.error) { line(""); line("  " + chalk.red("error: " + op.error)); }
    for (let i = ln; i < v; i++) out += at(start + i, 1) + clr(); w(out);
  }

  function fullDraw(): void { drawNavbar(NAV, NAV.length); drawLogContent(); drawBottomBar(buildLeft(), buildRight()); }
  function onResize(): void { clearScreen(); adjustScroll(); fullDraw(); }
  function cleanup(): void { process.stdout.removeListener("resize", onResize); stdin.removeAllListeners("data"); if (ownsAltScreen) { clearScreen(); exitAlt(); } else { w("\x1b[0m"); } }
  function exit(): void { cleanup(); setTimeout(onBack, 20); }

  function showDetail(op: FileOp): void {
    const detailNav: NavItem[] = [{ key: "Esc", label: "Back" }];
    process.stdout.removeListener("resize", onResize);
    const onDR = () => { clearScreen(); drawNavbar(detailNav, detailNav.length); drawDetailContent(op); drawBottomBar(op.kind.toUpperCase(), ""); };
    process.stdout.on("resize", onDR);
    function onDetailKey(k: string): void {
      if (k === "\u0003") { stdin.removeListener("data", onDetailKey); process.stdout.removeListener("resize", onDR); cleanup(); setTimeout(onBack, 20); return; }
      if (k === "\u001b" || k === "q") { stdin.removeListener("data", onDetailKey); process.stdout.removeListener("resize", onDR); process.stdout.on("resize", onResize); clearScreen(); fullDraw(); stdin.on("data", onKey); }
    }
    stdin.removeListener("data", onKey); stdin.on("data", onDetailKey);
    clearScreen(); drawNavbar(detailNav, detailNav.length); drawDetailContent(op); drawBottomBar(op.kind.toUpperCase(), "");
  }

  function onKey(raw: string): void {
    if (raw === "\u001b[A") { if (sel > 0) { sel--; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u001b[B") { if (sel < ops.length - 1) { sel++; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u0003" || raw === "\u001b" || raw === "q") { exit(); return; }
    if (raw.startsWith("\u001b")) return;
    if (raw === "\r" && ops.length > 0) showDetail(ops[sel]);
  }
  process.stdout.on("resize", onResize); if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume(); stdin.setEncoding("utf8"); stdin.on("data", onKey);
  if (ownsAltScreen) enterAlt(); clearScreen(); fullDraw();
}

export function showFileOpsLog(onBack: () => void): void { runLogPanel(process.stdin, onBack, true); }
export function openFileOpsLogFromMain(onBack: () => void): void { runLogPanel(process.stdin, onBack, true); }