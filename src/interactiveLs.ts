import fs from "fs";
import path from "path";
import chalk from "chalk";

export function interactiveLs(onExit: () => void) {
  const cwd = process.cwd();

  const entries = fs.readdirSync(cwd).map((name) => {
    const full = path.join(cwd, name);
    let isDir = false;

    try {
      isDir = fs.statSync(full).isDirectory();
    } catch {}

    return { name, isDir };
  });

  entries.sort(
    (a, b) =>
      Number(b.isDir) - Number(a.isDir) ||
      a.name.localeCompare(b.name)
  );

  let selectedIndex = 0;
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    console.log(entries.map((e) => e.name).join("  "));
    return onExit();
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  process.stdout.write("\x1b[s");
  process.stdout.write("\x1b[?25l");

  function clearRender() {
    process.stdout.write("\x1b[u");
    process.stdout.write("\x1b[J");
  }

  function render() {
    clearRender();

    const cols = process.stdout.columns || 80;
    const gap = 2;

    const maxLen =
      Math.max(...entries.map((e) => e.name.length)) + gap;

    const perRow = Math.max(1, Math.floor(cols / maxLen));

    let row = "";
    let count = 0;

    for (let i = 0; i < entries.length; i++) {
      const { name, isDir } = entries[i];

      let padded = name.padEnd(maxLen, " ");
      let display = isDir ? chalk.blue(padded) : padded;

      if (i === selectedIndex) {
        const clean = name.padEnd(maxLen - 2, " ");
        display = chalk.bgWhite.black(` ${clean} `);
      }

      row += display;
      count++;

      if (count === perRow) {
        process.stdout.write(row + "\n");
        row = "";
        count = 0;
      }
    }

    if (row) {
      process.stdout.write(row + "\n");
    }
  }

  function cleanup() {
    stdin.removeListener("data", onKey);
    stdin.setRawMode(false);
    stdin.pause();

    process.stdout.write("\x1b[?25h");
  }

  function exit() {
    cleanup();
    clearRender();
    setTimeout(onExit, 10);
  }

  function onKey(key: string) {
    if (key === "\u0003") return exit();
    if (key === "q") return exit();

    if (key === "\r") {
      const selected = entries[selectedIndex];
      const full = path.join(cwd, selected.name);

      try {
        if (selected.isDir) {
          process.chdir(full);
        }
      } catch {}

      return exit();
    }

    const cols = process.stdout.columns || 80;
    const maxLen =
      Math.max(...entries.map((e) => e.name.length)) + 2;
    const perRow = Math.max(1, Math.floor(cols / maxLen));

    if (key === "\u001b[A") selectedIndex -= perRow;
    if (key === "\u001b[B") selectedIndex += perRow;
    if (key === "\u001b[C") selectedIndex += 1;
    if (key === "\u001b[D") selectedIndex -= 1;

    selectedIndex = Math.max(
      0,
      Math.min(entries.length - 1, selectedIndex)
    );

    render();
  }

  stdin.on("data", onKey);

  render();
}