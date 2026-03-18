import fs from "fs";
import path from "path";
import chalk from "chalk";
import {
  loadMeta, TrashEntry, restoreFromTrash,
  deleteFromTrash, deleteAllFromTrash, TRASH_DIR,
} from "./trash";

const COLS = () => process.stdout.columns || 80;

function countLines(frame: string): number {
  let n = 0;
  for (const c of frame) if (c === "\n") n++;
  return n;
}

function browseDir(
  dirPath: string,
  label: string,
  stdin: NodeJS.ReadStream,
  onBack: () => void
) {
  let entries: { name: string; isDir: boolean }[] = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  } catch {
    onBack();
    return;
  }

  let sel = 0;
  let lastLines = 0;

  function render() {
    const C = COLS();
    let frame = "";
    if (lastLines > 0) frame += `\x1b[${lastLines}A\r\x1b[J`;

    const k = (s: string) => chalk.bgGray.white.bold(` ${s} `);
    frame += "\n";
    frame += " " + k("↑↓") + chalk.gray(" move  ") +
             k("enter") + chalk.gray(" open  ") +
             k("esc") + chalk.gray(" back") + "\x1b[K\n";
    frame += " " + chalk.dim(label) + "\x1b[K\n\x1b[K\n";

    for (let i = 0; i < entries.length; i++) {
      const { name, isDir } = entries[i];
      const active = i === sel;
      const icon = isDir ? chalk.blue("▸ ") : chalk.gray("  ");
      const padded = (icon + name).padEnd(C - 2);
      frame += active
        ? " " + chalk.bgWhite.black.bold(padded) + "\x1b[K\n"
        : " " + (isDir ? chalk.blue(padded) : chalk.white(padded)) + "\x1b[K\n";
    }

    if (entries.length === 0) frame += `  ${chalk.gray("(empty)")}\x1b[K\n`;

    lastLines = countLines(frame);
    process.stdout.write(frame);
  }

  function cleanup() {
    if (lastLines > 0) {
      process.stdout.write(`\x1b[${lastLines}A\r\x1b[J`);
      lastLines = 0;
    }
  }

  function onKey(key: string) {
    if (key === "\u001b" || key === "\u0003") {
      stdin.removeListener("data", onKey);
      cleanup();
      onBack();
      return;
    }
    if (key.startsWith("\u001b[")) {
      if (key === "\u001b[A" && sel > 0) { sel--; render(); }
      if (key === "\u001b[B" && sel < entries.length - 1) { sel++; render(); }
      return;
    }
    if (key === "\r" && entries.length > 0) {
      const entry = entries[sel];
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDir) {
        stdin.removeListener("data", onKey);
        cleanup();
        browseDir(fullPath, label + "/" + entry.name, stdin, () => {
          lastLines = 0;
          stdin.on("data", onKey);
          render();
        });
      } else {
        stdin.removeListener("data", onKey);
        cleanup();
        browseFile(fullPath, entry.name, stdin, () => {
          lastLines = 0;
          stdin.on("data", onKey);
          render();
        });
      }
    }
  }

  stdin.on("data", onKey);
  render();
}

function browseFile(
  filePath: string,
  name: string,
  stdin: NodeJS.ReadStream,
  onBack: () => void
) {
  const C = COLS();
  let lastLines = 0;

  let frame = "\n";
  frame += ` ${chalk.bold("📄 " + name)}\x1b[K\n`;
  frame += ` ${chalk.gray("─".repeat(Math.min(C - 2, 60)))}\x1b[K\n`;

  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n").slice(0, 15);
    for (const line of lines) {
      const d = line.length > C - 4 ? line.slice(0, C - 5) + "…" : line;
      frame += `  ${chalk.white(d)}\x1b[K\n`;
    }
  } catch {
    frame += `  ${chalk.gray("(binary file)")}\x1b[K\n`;
  }

  frame += ` ${chalk.gray("─".repeat(Math.min(C - 2, 60)))}\x1b[K\n`;
  frame += `  ${chalk.bgGray.white.bold(" esc ")} ${chalk.gray("back")}\x1b[K\n`;

  lastLines = countLines(frame);
  process.stdout.write(frame);

  function onKey(key: string) {
    if (key === "\u001b" || key === "\u0003" || key === "q") {
      stdin.removeListener("data", onKey);
      process.stdout.write(`\x1b[${lastLines}A\r\x1b[J`);
      onBack();
    }
  }

  stdin.on("data", onKey);
}

export function interactiveTrash(onExit: () => void) {
  const stdin = process.stdin;
  let entries = loadMeta();

  if (entries.length === 0) {
    console.log(chalk.gray("  (trash is empty)"));
    return onExit();
  }

  let sel = 0;
  let lastLines = 0;

  const HINT_LINES = 2;

  function renderHint() {
    const k = (s: string) => chalk.bgGray.white.bold(` ${s} `);
    const g = chalk.gray;
    return " " + k("↑↓") + g(" move  ") +
           k("enter") + g(" preview  ") +
           k("r") + g(" restore  ") +
           k("x") + g(" delete forever  ") +
           k("D") + g(" empty trash  ") +
           k("esc") + g(" quit") + "\x1b[K";
  }

  function render() {
    const C = COLS();
    let frame = "";

    if (lastLines > 0) frame += `\x1b[${lastLines}A\r\x1b[J`;

    frame += "\n" + renderHint() + "\n\x1b[K\n";

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const active = i === sel;
      const icon = e.isDir ? chalk.blue("▸") : chalk.gray("·");
      const date = chalk.gray(new Date(e.trashedAt).toLocaleString([], {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      }));
      const maxName = C - 22;
      const name = e.name.length > maxName ? e.name.slice(0, maxName - 1) + "…" : e.name;
      const from = e.originalPath.replace(process.env.HOME ?? "", "~");
      const namePadded = (` ${icon} ${name}`).padEnd(C - 20);

      if (active) {
        frame += chalk.bgWhite.black.bold(namePadded) + "  " + date + "\x1b[K\n";
        frame += chalk.gray(`    from: ${from}`) + "\x1b[K\n";
      } else {
        frame += namePadded + "  " + date + "\x1b[K\n";
      }
    }

    lastLines = countLines(frame);
    process.stdout.write(frame);
  }

  function clearUI() {
    if (lastLines > 0) {
      process.stdout.write(`\x1b[${lastLines}A\r\x1b[J`);
      lastLines = 0;
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
    setTimeout(onExit, 30);
  }

  function afterAction() {
    entries = loadMeta();
    if (entries.length === 0) return exit();
    sel = Math.min(sel, entries.length - 1);
    lastLines = 0;
    stdin.on("data", onKey);
    render();
  }

  function showPreview(entry: TrashEntry) {
    const src = path.join(TRASH_DIR, entry.id);
    const C = COLS();
    const SEP = chalk.gray("─".repeat(Math.min(C - 2, 60)));
    let overlayLines = 0;

    function renderPreview(browseMode = false) {
      let frame = "\n";
      const icon = entry.isDir ? "📁" : "📄";
      frame += ` ${chalk.bold(icon + " " + entry.name)}\x1b[K\n`;
      frame += ` ${SEP}\x1b[K\n`;

      if (entry.isDir) {
        try {
          const children = fs.readdirSync(src, { withFileTypes: true }).slice(0, 10);
          if (children.length === 0) {
            frame += `  ${chalk.gray("(empty directory)")}\x1b[K\n`;
          } else {
            for (const c of children) {
              frame += (c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ")) +
                       chalk.white(c.name) + "\x1b[K\n";
            }
            const total = fs.readdirSync(src).length;
            if (total > 10) frame += `  ${chalk.gray(`... and ${total - 10} more`)}\x1b[K\n`;
          }
        } catch {
          frame += `  ${chalk.red("cannot read")}\x1b[K\n`;
        }
      } else {
        try {
          const lines = fs.readFileSync(src, "utf8").split("\n").slice(0, 8);
          for (const line of lines) {
            const d = line.length > C - 4 ? line.slice(0, C - 5) + "…" : line;
            frame += `  ${chalk.white(d)}\x1b[K\n`;
          }
          const total = fs.readFileSync(src, "utf8").split("\n").length;
          if (total > 8) frame += `  ${chalk.gray(`... ${total - 8} more lines`)}\x1b[K\n`;
        } catch {
          frame += `  ${chalk.gray("(binary file)")}\x1b[K\n`;
        }
      }

      frame += ` ${SEP}\x1b[K\n`;
      const actions = `  ${chalk.bgGreen.black.bold(" r ")} ${chalk.gray("restore    ")}` +
                      `${chalk.bgRed.white.bold(" x ")} ${chalk.gray("delete forever    ")}` +
                      (entry.isDir ? `${chalk.bgGray.white.bold(" o ")} ${chalk.gray("browse    ")}` : "") +
                      `${chalk.bgGray.white.bold(" esc ")} ${chalk.gray("back")}`;
      frame += actions + "\x1b[K\n";

      overlayLines = countLines(frame);
      process.stdout.write(frame);
    }

    function clearPreview() {
      const total = lastLines + overlayLines;
      process.stdout.write(`\x1b[${total}A\r\x1b[J`);
      lastLines = 0;
      overlayLines = 0;
    }

    function onPreviewKey(key: string) {
      if (key === "\u001b" || key === "\u0003") {
        stdin.removeListener("data", onPreviewKey);
        clearPreview();
        stdin.on("data", onKey);
        render();
        return;
      }
      if (key === "r") {
        stdin.removeListener("data", onPreviewKey);
        restoreFromTrash(entry);
        clearPreview();
        afterAction();
        return;
      }
      if (key === "x") {
        stdin.removeListener("data", onPreviewKey);
        deleteFromTrash(entry);
        clearPreview();
        afterAction();
        return;
      }
      if (key === "o" && entry.isDir) {
        stdin.removeListener("data", onPreviewKey);
        clearPreview();
        browseDir(src, entry.name, stdin, () => {
          lastLines = 0;
          stdin.on("data", onKey);
          render();
        });
        return;
      }
    }

    stdin.removeListener("data", onKey);
    stdin.on("data", onPreviewKey);
    renderPreview();
  }

  function onKey(key: string) {
    if (key === "\u001b" || key === "\u0003") return exit();

    if (key === "\u001b[A") { if (sel > 0) { sel--; render(); } return; }
    if (key === "\u001b[B") { if (sel < entries.length - 1) { sel++; render(); } return; }
    if (key.startsWith("\u001b")) return;

    if (key === "\r") return showPreview(entries[sel]);

    if (key === "r") {
      restoreFromTrash(entries[sel]);
      afterAction();
      return;
    }

    if (key === "x") {
      deleteFromTrash(entries[sel]);
      afterAction();
      return;
    }

    if (key === "D") {
      const msg = `\n  ${chalk.red.bold("Empty trash?")} ${chalk.gray("This will permanently delete all items.")}\n` +
                  `  ${chalk.bgRed.white.bold(" y ")} ${chalk.gray("yes    ")}${chalk.bgGray.white.bold(" n ")} ${chalk.gray("no / esc")}\n`;
      const confirmLines = 3;
      process.stdout.write(msg);

      stdin.removeListener("data", onKey);
      stdin.on("data", function onConfirm(key: string) {
        process.stdout.write(`\x1b[${confirmLines}A\r\x1b[J`);

        if (key === "y" || key === "Y") {
          stdin.removeListener("data", onConfirm);
          deleteAllFromTrash();
          return exit();
        }
        if (key === "n" || key === "N" || key === "\u001b" || key === "\u0003") {
          stdin.removeListener("data", onConfirm);
          stdin.on("data", onKey);
        }
      });
      return;
    }
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write("\x1b[?25l");
  stdin.on("data", onKey);

  lastLines = 0;
  render();
}