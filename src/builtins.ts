import fs from "fs";
import path from "path";
import { interactiveLs } from "./interactiveLs";
import { pauseInput, resumeInput } from "./main";

const builtins = ["exit", "echo", "type", "pwd", "cd", "ls"];

export function handleBuiltin(
  cmd: string,
  args: string[],
  done: () => void
): boolean {
  switch (cmd) {
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
        resumeInput();
        done();
      });

      return true;

    default:
      return false;
  }
}

function handleCd(args: string[]) {
  let target = args[0];

  const home = process.env.HOME || process.env.USERPROFILE;

  if (!target || target === "~") {
    target = home || "";
  }

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