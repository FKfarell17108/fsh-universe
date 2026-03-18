import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execFileSync } from "child_process";
import { moveToTrash } from "./trash";

const EDITOR_CANDIDATES = [
  "nvim", "vim", "vi", "nano", "emacs", "micro", "hx", "helix", "code", "gedit",
];

function getInstalledEditors(): string[] {
  const installed: string[] = [];
  for (const editor of EDITOR_CANDIDATES) {
    try {
      execFileSync("which", [editor], { stdio: "ignore" });
      installed.push(editor);
    } catch {}
  }
  return installed;
}

export let pendingOpen: { editor: string; file: string } | null = null;
export function clearPendingOpen() { pendingOpen = null; }

export function interactiveLs(onExit: () => void) {
  const cwd = process.cwd();
  let entries: { name: string; isDir: boolean }[] = [];

  try {
    entries = fs.readdirSync(cwd).map((name) => {
      const full = path.join(cwd, name);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch {}
      return { name, isDir };
    });
  } catch {
    console.log(`ls: cannot read directory`);
    return onExit();
  }

  entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));

  if (!process.stdin.isTTY) {
    console.log(entries.map((e) => e.name).join("  "));
    return onExit();
  }

  if (entries.length === 0) {
    console.log("(empty directory)");
    return onExit();
  }

  let selectedIndex = 0;
  const stdin = process.stdin;
  const maxNameLen = Math.max(...entries.map((e) => e.name.length));
  const COL_WIDTH = maxNameLen + 2;

  function getPerRow() {
    return Math.max(1, Math.floor((process.stdout.columns || 80) / COL_WIDTH));
  }

  let lastRenderedLines = 0;

  function render() {
    const perRow = getPerRow();
    const totalRows = Math.ceil(entries.length / perRow);
    let frame = "";

    if (lastRenderedLines > 0) frame += `\x1b[${lastRenderedLines}A\r`;

    const key = (k: string) => chalk.bgGray.white.bold(` ${k} `);
    const g = chalk.gray;
    frame += " " + key("↑↓←→") + g(" move  ") +
             key("enter") + g(" open  ") +
             key("d") + g(" delete  ") +
             key("esc") + g(" quit") +
             "\x1b[K\n\x1b[K\n";

    for (let row = 0; row < totalRows; row++) {
      let line = " ";
      for (let col = 0; col < perRow; col++) {
        const i = row * perRow + col;
        if (i >= entries.length) break;
        const { name, isDir } = entries[i];
        const isSelected = i === selectedIndex;
        const isHidden = name.startsWith(".");
        const padded = name.padEnd(COL_WIDTH, " ");

        let cell: string;
        if (isSelected) {
          cell = chalk.bgWhite.black.bold(padded);
        } else if (isDir) {
          cell = isHidden ? chalk.cyan(padded) : chalk.blue.bold(padded);
        } else {
          cell = isHidden ? chalk.gray(padded) : chalk.white(padded);
        }
        line += cell;
      }
      frame += line + "\x1b[K\n";
    }

    lastRenderedLines = 2 + totalRows;
    process.stdout.write(frame);
  }

  function cleanup() {
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.removeAllListeners("data");
    process.stdout.write("\x1b[?25h");
  }

  function exit() {
    if (lastRenderedLines > 0) {
      process.stdout.write(`\x1b[${lastRenderedLines}A\r\x1b[J`);
    }
    cleanup();
    setTimeout(onExit, 50);
  }

  function showDeleteConfirm(entryName: string, isDir: boolean) {
    const full = path.join(cwd, entryName);
    const COLS = process.stdout.columns || 80;
    let overlayLines = 0;

    function clearOverlay() {
      if (overlayLines > 0) {
        process.stdout.write(`\x1b[${overlayLines}A\r\x1b[J`);
        overlayLines = 0;
      }
    }

    function renderOverlay() {
      clearOverlay();
      let frame = "\n";

      const icon = isDir ? "📁" : "📄";
      frame += ` ${chalk.bold(icon + " " + entryName)}\x1b[K\n`;
      frame += ` ${chalk.gray("─".repeat(Math.min(COLS - 2, 60)))}\x1b[K\n`;

      if (isDir) {
        try {
          const children = fs.readdirSync(full, { withFileTypes: true }).slice(0, 10);
          if (children.length === 0) {
            frame += `  ${chalk.gray("(empty directory)")}\x1b[K\n`;
          } else {
            for (const c of children) {
              const prefix = c.isDirectory() ? chalk.blue("  ▸ ") : chalk.gray("    ");
              frame += prefix + chalk.white(c.name) + "\x1b[K\n";
            }
            const total = fs.readdirSync(full).length;
            if (total > 10) frame += `  ${chalk.gray(`... and ${total - 10} more`)}\x1b[K\n`;
          }
        } catch {
          frame += `  ${chalk.red("cannot read directory")}\x1b[K\n`;
        }
      } else {
        try {
          const content = fs.readFileSync(full, "utf8").split("\n").slice(0, 8);
          for (const line of content) {
            const display = line.length > COLS - 4 ? line.slice(0, COLS - 5) + "…" : line;
            frame += `  ${chalk.white(display)}\x1b[K\n`;
          }
          const total = fs.readFileSync(full, "utf8").split("\n").length;
          if (total > 8) frame += `  ${chalk.gray(`... ${total - 8} more lines`)}\x1b[K\n`;
        } catch {
          frame += `  ${chalk.gray("(binary file)")}\x1b[K\n`;
        }
      }

      frame += ` ${chalk.gray("─".repeat(Math.min(COLS - 2, 60)))}\x1b[K\n`;
      frame += `  ${chalk.yellow.bold("Move to Trash")} ${chalk.white(entryName)}${isDir ? chalk.gray(" and all its contents") : ""}?\x1b[K\n`;
      frame += `  ${chalk.bgYellow.black.bold(" y ")} ${chalk.gray("yes    ")}${chalk.bgGray.white.bold(" n ")} ${chalk.gray("no / esc")}\x1b[K\n`;

      let lineCount = 0;
      for (let i = 0; i < frame.length; i++) {
        if (frame[i] === "\n") lineCount++;
      }
      overlayLines = lineCount;
      process.stdout.write(frame);
    }

    function onConfirmKey(key: string) {
      if (key === "y" || key === "Y") {
        stdin.removeListener("data", onConfirmKey);

        try {
          moveToTrash(full);
          entries = entries.filter((e) => e.name !== entryName);
          if (entries.length === 0) return exit();
          selectedIndex = Math.min(selectedIndex, entries.length - 1);
        } catch (err: any) {
          process.stdout.write(`\n  ${chalk.red("Error: " + err.message)}\n`);
          setTimeout(() => { stdin.on("data", onKey); render(); }, 1500);
          return;
        }

        const totalLines = lastRenderedLines + overlayLines;
        process.stdout.write(`\x1b[${totalLines}A\r\x1b[J`);
        lastRenderedLines = 0;
        overlayLines = 0;
        stdin.on("data", onKey);
        render();
        return;
      }

      if (key === "n" || key === "N" || key === "\u001b" || key === "\u0003") {
        stdin.removeListener("data", onConfirmKey);

        const totalLines = lastRenderedLines + overlayLines;
        process.stdout.write(`\x1b[${totalLines}A\r\x1b[J`);
        lastRenderedLines = 0;
        overlayLines = 0;
        stdin.on("data", onKey);
        render();
      }
    }

    stdin.removeListener("data", onKey);
    stdin.on("data", onConfirmKey);
    renderOverlay();
  }

  function onKey(key: string) {
    const perRow = getPerRow();

    if (key === "\u0003" || key === "\u001b") return exit();

    if (key === "d" || key === "D") {
      const selected = entries[selectedIndex];
      return showDeleteConfirm(selected.name, selected.isDir);
    }

    if (key === "\r") {
      const selected = entries[selectedIndex];
      if (selected.isDir) {
        try { process.chdir(path.join(cwd, selected.name)); } catch {}
        return exit();
      } else {
        return showEditorPicker(path.join(cwd, selected.name));
      }
    }

    let idx = selectedIndex;
    if (key === "\u001b[A") idx -= perRow;
    if (key === "\u001b[B") idx += perRow;
    if (key === "\u001b[C") idx += 1;
    if (key === "\u001b[D") idx -= 1;
    if (key === "\u001b[H") idx = 0;
    if (key === "\u001b[F") idx = entries.length - 1;

    idx = Math.max(0, Math.min(entries.length - 1, idx));
    if (idx !== selectedIndex) { selectedIndex = idx; render(); }
  }

  function showEditorPicker(filePath: string) {
    const editors = getInstalledEditors();
    if (editors.length === 0) return exit();

    if (editors.length === 1) {
      if (lastRenderedLines > 0) process.stdout.write(`\x1b[${lastRenderedLines}A\r\x1b[J`);
      cleanup();
      setTimeout(() => { pendingOpen = { editor: editors[0], file: filePath }; onExit(); }, 20);
      return;
    }

    const EW = Math.max(...editors.map((e) => e.length)) + 2;
    function getPerRowE() { return Math.max(1, Math.floor((process.stdout.columns || 80) / EW)); }

    let selIdx = 0;
    let pickerLines = 0;

    function renderEditorPicker() {
      const perRow = getPerRowE();
      const totalRows = Math.ceil(editors.length / perRow);
      let frame = "";
      if (pickerLines > 0) frame += `\x1b[${pickerLines}A\r\x1b[J`;

      const fname = chalk.white(path.basename(filePath));
      const k = (s: string) => chalk.bgGray.white.bold(` ${s} `);
      frame += `\n ${chalk.gray("open")} ${fname} ${chalk.gray("with:")}\x1b[K\n\x1b[K\n`;

      for (let row = 0; row < totalRows; row++) {
        let line = " ";
        for (let col = 0; col < perRow; col++) {
          const i = row * perRow + col;
          if (i >= editors.length) break;
          const name = editors[i].padEnd(EW, " ");
          line += i === selIdx ? chalk.bgWhite.black.bold(name) : chalk.cyan(name);
        }
        frame += line + "\x1b[K\n";
      }

      pickerLines = 3 + totalRows;
      process.stdout.write(frame);
    }

    function onEditorKey(key: string) {
      const perRow = getPerRowE();
      if (key === "\u0003" || key === "\u001b") {
        stdin.removeListener("data", onEditorKey);
        if (pickerLines > 0) process.stdout.write(`\x1b[${pickerLines}A\r\x1b[J`);
        stdin.on("data", onKey);
        return;
      }
      if (key === "\r") {
        const chosen = editors[selIdx];
        stdin.removeListener("data", onEditorKey);
        if (pickerLines > 0) process.stdout.write(`\x1b[${pickerLines}A\r\x1b[J`);
        if (lastRenderedLines > 0) process.stdout.write(`\x1b[${lastRenderedLines}A\r\x1b[J`);
        cleanup();
        setTimeout(() => { pendingOpen = { editor: chosen, file: filePath }; onExit(); }, 20);
        return;
      }
      let i = selIdx;
      if (key === "\u001b[A") i -= perRow;
      if (key === "\u001b[B") i += perRow;
      if (key === "\u001b[C") i += 1;
      if (key === "\u001b[D") i -= 1;
      i = Math.max(0, Math.min(editors.length - 1, i));
      if (i !== selIdx) { selIdx = i; renderEditorPicker(); }
    }

    stdin.removeListener("data", onKey);
    stdin.on("data", onEditorKey);
    renderEditorPicker();
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  process.stdout.write("\x1b[?25l");
  stdin.on("data", onKey);
  lastRenderedLines = 0;
  render();
}