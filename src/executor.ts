import { spawn } from "child_process";
import { handleBuiltin } from "./builtins";
import { Command } from "./parser";

export function execute(commands: Command[], callback: () => void) {
  if (commands.length === 0) return callback();

  let called = false;

  function done() {
    if (!called) {
      called = true;
      callback();
    }
  }

  if (commands.length === 1) {
    const { cmd, args } = commands[0];

    if (handleBuiltin(cmd, args, done)) {
      return;
    }
  }

  let prevProcess: any = null;

  commands.forEach((command, index) => {
    const child = spawn(command.cmd, command.args);

    if (prevProcess) {
      prevProcess.stdout.pipe(child.stdin);
    }

    if (index === commands.length - 1) {
      child.stdout.pipe(process.stdout);
    }

    child.stderr.pipe(process.stderr);

    child.on("error", () => {
      console.log(`${command.cmd}: command not found`);
      done();
    });

    prevProcess = child;

    if (index === commands.length - 1) {
      child.on("exit", () => {
        done();
      });
    }
  });
}