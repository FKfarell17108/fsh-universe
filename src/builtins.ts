import { printNeofetch, isNeofetchEnabled, setNeofetchState } from "./neofetch";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { interactiveLs, pendingOpen, clearPendingOpen } from "./interactiveLs";
import { pauseInput, resumeInput, reloadHistoryInRl } from "./main";
import { interactiveTrash } from "./trashLs";
import { showHistoryManager, loadHistoryEntries } from "./historyManager";
import { setAlias, removeAlias, getAllAliases } from "./aliases";
import { loadFshrc, generateDefaultFshrc } from "./fshrc";

const builtins = ["exit", "echo", "type", "pwd", "cd", "ls", "alias", "unalias", "clear", "history", "fshrc", "trash", "neofetch"];

export function handleBuiltin(
  cmd: string,
  args: string[],
  done: () => void
): boolean {
  switch (cmd) {
    case "neofetch":
      handleNeofetch(args);
      done();
      return true;

    case "trash":
      pauseInput();
      interactiveTrash(() => resumeInput());
      return true;

    case "fshrc":
      handleFshrc(args);
      done();
      return true;

    case "history":
      pauseInput();
      showHistoryManager(loadHistoryEntries(), (updated) => {
        reloadHistoryInRl(updated);
        resumeInput();
      });
      return true;

    case "clear": {
      const rows = process.stdout.rows || 24;
      process.stdout.write("\n".repeat(rows) + "\x1b[3J\x1b[2J\x1b[H");
      done();
      return true;
    }

    case "exit":
      process.exit(0);

    case "echo":
      console.log(args.join(" "));
      done();
      return true;

    case "type":
      handleType(args);
      done();
      return true;

    case "pwd":
      console.log(process.cwd());
      done();
      return true;

    case "cd":
      handleCd(args);
      done();
      return true;

    case "ls":
      pauseInput();
      interactiveLs(() => {
        const open = pendingOpen;
        clearPendingOpen();

        if (open) {
          const { execute } = require("./executor");
          const { parseInput } = require("./parser");
          resumeInput();
          setTimeout(() => {
            const stmt = parseInput(`${open.editor} "${open.file}"`);
            execute(stmt, () => {});
          }, 60);
        } else {
          resumeInput();
        }
      });
      return true;

    case "alias":
      handleAlias(args);
      done();
      return true;

    case "unalias":
      handleUnalias(args);
      done();
      return true;

    default:
      return false;
  }
}

function handleAlias(args: string[]) {
  if (args.length === 0) {
    const all = getAllAliases();
    if (all.size === 0) {
      console.log("(no aliases defined)");
    } else {
      for (const [name, value] of all) {
        console.log(`alias ${name}='${value}'`);
      }
    }
    return;
  }

  for (const arg of args) {
    const eq = arg.indexOf("=");
    if (eq === -1) {
      const val = getAllAliases().get(arg);
      if (val !== undefined) {
        console.log(`alias ${arg}='${val}'`);
      } else {
        console.log(`fsh: alias: ${arg}: not found`);
      }
    } else {
      const name = arg.slice(0, eq).trim();
      let value = arg.slice(eq + 1).trim();
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }
      if (!name) {
        console.log(`fsh: alias: invalid name`);
        return;
      }
      setAlias(name, value);
    }
  }
}

function handleUnalias(args: string[]) {
  if (args.length === 0) {
    console.log("usage: unalias <name>");
    return;
  }
  for (const name of args) {
    if (!removeAlias(name)) {
      console.log(`fsh: unalias: ${name}: not found`);
    }
  }
}

function handleCd(args: string[]) {
  let target = args[0];
  const home = process.env.HOME || process.env.USERPROFILE;

  if (!target || target === "~") target = home || "";
  if (target.startsWith("~/") && home) {
    target = path.join(home, target.slice(2));
  }

  try {
    process.chdir(target);
  } catch {
    console.log(`cd: ${target}: No such file or directory`);
  }
}

function handleType(args: string[]) {
  const target = args[0];
  if (!target) return;

  const allAliases = getAllAliases();
  if (allAliases.has(target)) {
    console.log(`${target} is aliased to '${allAliases.get(target)}'`);
    return;
  }

  if (builtins.includes(target)) {
    console.log(`${target} is a shell builtin`);
    return;
  }

  const paths = process.env.PATH?.split(":") || [];
  for (const p of paths) {
    const fullPath = path.join(p, target);
    if (fs.existsSync(fullPath)) {
      console.log(`${target} is ${fullPath}`);
      return;
    }
  }

  console.log(`${target}: not found`);
}

function handleFshrc(args: string[]) {
  const FSHRC = path.join(process.env.HOME ?? "~", ".fshrc");
  const sub = args[0];

  if (sub === "init") {
    if (fs.existsSync(FSHRC)) {
      console.log(`~/.fshrc already exists. Use 'fshrc reload' to reload it.`);
      return;
    }
    fs.writeFileSync(FSHRC, generateDefaultFshrc(), "utf8");
    console.log(`Created ~/.fshrc — edit it and run 'fshrc reload' to apply.`);
    return;
  }

  if (sub === "reload" || !sub) {
    loadFshrc();
    console.log(chalk.green("✓") + chalk.white(" fsh reloaded"));
    return;
  }

  if (sub === "path") {
    console.log(FSHRC);
    return;
  }

  console.log(`usage: fshrc [init|reload|path]`);
}

function handleNeofetch(args: string[]) {
  const sub = args[0];

  if (sub === "on") {
    setNeofetchState("on");
    console.log(chalk.green("✓") + chalk.white(" neofetch enabled — will show on every startup"));
    return;
  }

  if (sub === "off") {
    setNeofetchState("off");
    console.log(chalk.gray("✗ neofetch disabled"));
    return;
  }

  printNeofetch();
}