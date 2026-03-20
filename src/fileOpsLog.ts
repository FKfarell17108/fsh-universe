import chalk from "chalk";
import path from "path";
import { getLog, loadLog, FileOp, OpKind } from "./fileOps";
import { w, at, clr, C, R, NAVBAR_ROWS, FOOTER_ROWS, getNR, drawNavbar, visibleLen, padOrTrim, kb, enterAlt, exitAlt } from "./tui";

function kindLabel(kind: OpKind): string {
  switch (kind) {
    case "copy":   return chalk.cyan.bold("copy  ");
    case "cut":    return chalk.yellow.bold("cut   ");
    case "move":   return chalk.magenta.bold("move  ");
    case "rename": return chalk.blue.bold("rename");
  }
}

function statusBadge(op: FileOp): string {
  if (op.status === "done")  return chalk.green("✓");
  if (op.status === "error") return chalk.red("✗");
  return chalk.yellow("…");
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function homify(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function buildLogHints(sel: number, total: number, vis: number): string[] {
  const scrollInfo = total > vis ? chalk.dim(` [${sel + 1}/${total}]`) : "";
  return [
    kb("↑↓") + chalk.gray(" navigate  ") + kb("enter") + chalk.gray(" detail  ") + kb("esc") + chalk.gray(" back") + scrollInfo,
    kb("↑↓") + chalk.gray(" nav  ")      + kb("enter") + chalk.gray(" detail  ") + kb("esc") + chalk.gray(" back") + scrollInfo,
    kb("↑↓") + chalk.gray(" nav  ")      +                                         kb("esc") + chalk.gray(" back") + scrollInfo,
    kb("esc") + chalk.gray(" back"),
  ];
}

function drawLogContent(ops: FileOp[], sel: number, scrollTop: number, vis: number): string {
  const cols = C();
  let out    = "";

  for (let i = 0; i < vis; i++) {
    out += at(getNR() + 1 + i, 1) + clr();
    const op = ops[scrollTop + i];
    if (!op) continue;

    const active   = (scrollTop + i) === sel;
    const badge    = statusBadge(op);
    const kLabel   = kindLabel(op.kind);
    const srcShort = path.basename(op.srcPath);
    const timeStr  = chalk.dim(fmtTime(op.timestamp));
    const nameStr  = srcShort.length > 28 ? srcShort.slice(0, 27) + "…" : srcShort.padEnd(28);
    const left     = ` ${badge} ${kLabel}  ${nameStr}`;
    const pad      = Math.max(1, cols - visibleLen(left) - visibleLen(timeStr) - 2);

    if (active) {
      out += chalk.bgWhite.black.bold(padOrTrim(left + " ".repeat(pad) + timeStr, cols));
    } else {
      out += left + " ".repeat(pad) + timeStr;
    }
  }

  const more     = ops.length - (scrollTop + vis);
  const leftStr  = ops.length === 0 ? "  (no operations yet)" : `  ${ops.length} operation${ops.length === 1 ? "" : "s"}`;
  const rightStr = ops.length > vis ? (more > 0 ? `  ↓ ${more} more  ` : "  (end)  ") : "";
  const gap      = Math.max(0, C() - visibleLen(leftStr) - visibleLen(rightStr));
  out += at(getNR() + 1 + vis, 1) + clr() + chalk.dim(leftStr) + " ".repeat(gap) + chalk.dim(rightStr);

  return out;
}

function drawDetailScreen(op: FileOp): string {
  const cols  = C();
  const avail = R() - getNR();
  const kindColor = op.kind === "copy" ? chalk.cyan : op.kind === "move" ? chalk.magenta : op.kind === "rename" ? chalk.blue : chalk.yellow;

  let out     = "";
  let lineNum = 0;
  function line(content: string) {
    if (lineNum >= avail) return;
    out += at(getNR() + 1 + lineNum, 1) + clr() + content;
    lineNum++;
  }

  line("");
  line("  " + kindColor.bold(op.kind.toUpperCase()) + "  " + statusBadge(op) + "  " + chalk.dim(fmtTime(op.timestamp)));
  line("  " + chalk.dim("id: " + op.id));
  line("");
  line("  " + chalk.dim("from"));
  line("  " + chalk.white(homify(op.srcPath)));
  line("");

  if (op.kind === "rename") {
    line("  " + chalk.dim("renamed to"));
    line("  " + chalk.white(op.destName));
  } else {
    line("  " + chalk.dim("to"));
    line("  " + chalk.white(homify(op.destPath)));
  }

  line("");
  line("  " + chalk.dim("type:  ") + chalk.white(op.isDir ? "directory" : "file"));

  if (op.status === "error" && op.error) {
    line("");
    line("  " + chalk.red("error: " + op.error));
  }

  for (let i = lineNum; i < avail; i++) out += at(getNR() + 1 + i, 1) + clr();
  return out;
}

function runLogPanel(stdin: NodeJS.ReadStream, onBack: () => void, ownsAltScreen: boolean) {
  loadLog();
  let ops       = getLog();
  let sel       = 0;
  let scrollTop = 0;

  function vis(): number { return Math.max(1, R() - getNR() - FOOTER_ROWS - 1); }

  function adjustScroll() {
    const v = vis();
    if (sel < scrollTop) scrollTop = sel;
    if (sel >= scrollTop + v) scrollTop = sel - v + 1;
  }

  function fullDraw() {
    drawNavbar(buildLogHints(sel, ops.length, vis()), `${ops.length}R × 1C`);
    const v = vis();
    w(drawLogContent(ops, sel, scrollTop, v));
  }

  function onResize() { w("\x1b[2J"); adjustScroll(); fullDraw(); }

  function cleanup() {
    process.stdout.removeListener("resize", onResize);
    stdin.removeAllListeners("data");
    if (ownsAltScreen) {
      w("\x1b[2J\x1b[H");
      exitAlt();
    } else {
      w("\x1b[0m");
    }
  }

  function exit() {
    cleanup();
    setTimeout(onBack, 20);
  }

  function showDetail(op: FileOp) {
    process.stdout.removeListener("resize", onResize);

    function onDetailResize() {
      w("\x1b[2J");
      drawNavbar([kb("esc") + chalk.gray(" back  ") + kb("^C") + chalk.gray(" quit")]);
      w(drawDetailScreen(op));
    }

    process.stdout.on("resize", onDetailResize);

    function onDetailKey(k: string) {
      if (k === "\u0003") {
        stdin.removeListener("data", onDetailKey);
        process.stdout.removeListener("resize", onDetailResize);
        cleanup();
        setTimeout(onBack, 20);
        return;
      }
      if (k === "\u001b" || k === "q") {
        stdin.removeListener("data", onDetailKey);
        process.stdout.removeListener("resize", onDetailResize);
        process.stdout.on("resize", onResize);
        w("\x1b[2J");
        fullDraw();
        stdin.on("data", onKey);
      }
    }

    stdin.removeListener("data", onKey);
    stdin.on("data", onDetailKey);
    w("\x1b[2J");
    drawNavbar([kb("esc") + chalk.gray(" back  ") + kb("^C") + chalk.gray(" quit")]);
    w(drawDetailScreen(op));
  }

  function onKey(raw: string) {
    if (raw === "\u001b[A") { if (sel > 0) { sel--; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u001b[B") { if (sel < ops.length - 1) { sel++; adjustScroll(); fullDraw(); } return; }
    if (raw === "\u0003" || raw === "\u001b" || raw === "q") return exit();
    if (raw.startsWith("\u001b")) return;
    if (raw === "\r" && ops.length > 0) showDetail(ops[sel]);
  }

  process.stdout.on("resize", onResize);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", onKey);

  if (ownsAltScreen) {
    enterAlt();
  }
  w("\x1b[2J");
  fullDraw();
}

export function showFileOpsLog(onBack: () => void) {
  runLogPanel(process.stdin, onBack, true);
}

export function openFileOpsLogFromMain(onBack: () => void) {
  runLogPanel(process.stdin, onBack, true);
}