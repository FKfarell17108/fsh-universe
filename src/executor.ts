import { spawn, StdioOptions } from "child_process";
import * as pty from "node-pty";
import fs from "fs";
import { handleBuiltin } from "./builtins";
import { Statement, Pipeline, Command } from "./parser";
import { pauseInput, resumeInput } from "./main";

let lastExitCode = 0;

export function getLastExitCode(): number {
  return lastExitCode;
}

const PTY_COMMANDS = new Set([
  "vim", "vi", "nvim", "nano", "emacs", "micro", "helix", "hx",
  "htop", "btop", "top", "atop",
  "less", "more", "man",
  "fzf", "ranger", "nnn", "mc",
  "ssh", "ssh-keygen", "ssh-add", "scp", "sftp", "tmux", "screen",
  "python", "python3", "node", "irb", "ghci", "lua",
  "bash", "zsh", "fish", "sh",
  "git", "sudo", "su",
]);

function needsPty(cmd: string): boolean {
  const base = cmd.split("/").pop() ?? cmd;
  return PTY_COMMANDS.has(base);
}

export function execute(statement: Statement | null, callback: () => void) {
  if (!statement) return callback();
  lastExitCode = 0;
  executeStatement(statement, callback);
}

function executeStatement(stmt: Statement, callback: () => void) {
  switch (stmt.kind) {
    case "pipeline":
      executePipeline(stmt.pipeline, callback);
      break;
    case "seq":
      executeStatement(stmt.left, () => executeStatement(stmt.right, callback));
      break;
    case "and":
      executeStatement(stmt.left, () => {
        if (lastExitCode === 0) executeStatement(stmt.right, callback);
        else callback();
      });
      break;
    case "or":
      executeStatement(stmt.left, () => {
        if (lastExitCode !== 0) executeStatement(stmt.right, callback);
        else callback();
      });
      break;
  }
}

function executePipeline(pipeline: Pipeline, callback: () => void) {
  const { commands, background } = pipeline;
  if (background) {
    runPipeline(commands, () => {});
    callback();
    return;
  }
  runPipeline(commands, callback);
}

function runPipeline(commands: Command[], done: () => void) {
  if (commands.length === 0) return done();

  if (commands.length === 1) {
    const cmd = commands[0];
    if (handleBuiltin(cmd.cmd, cmd.args, done)) return;

    if (needsPty(cmd.cmd) && process.stdin.isTTY) {
      spawnWithPty(cmd, done);
    } else {
      spawnExternal(cmd, done);
    }
    return;
  }

  const children: ReturnType<typeof spawn>[] = [];

  commands.forEach((command, index) => {
    const isFirst = index === 0;
    const isLast = index === commands.length - 1;

    const stdio: StdioOptions = [
      isFirst ? resolveStdin(command) : "pipe",
      isLast ? resolveStdout(command) : "pipe",
      "inherit",
    ];

    const child = spawn(command.cmd, command.args, { stdio, env: process.env });

    if (!isFirst) {
      const prev = children[index - 1];
      if (prev.stdout) prev.stdout.pipe(child.stdin!);
    }

    let hadError = false;

    child.on("error", (err: NodeJS.ErrnoException) => {
      hadError = true;
      printSpawnError(command.cmd, err);
      if (isLast) done();
    });

    if (isLast) {
      child.on("exit", (code) => {
        if (!hadError) lastExitCode = code ?? 0;
        if (!hadError) done();
      });
    }

    children.push(child);
  });
}

function spawnWithPty(command: Command, done: () => void) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  let term: pty.IPty;

  try {
    term = pty.spawn(command.cmd, command.args, {
      name: process.env.TERM || "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string },
    });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      console.log(`fsh: ${command.cmd}: command not found`);
    } else {
      console.log(`fsh: ${command.cmd}: ${err.message}`);
    }
    lastExitCode = 1;
    return done();
  }

  pauseInput();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  term.onData((data) => {
    process.stdout.write(data);
  });

  const onData = (data: string) => {
    term.write(data);
  };
  process.stdin.on("data", onData);

  const onResize = () => {
    term.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  };
  process.stdout.on("resize", onResize);

  term.onExit(({ exitCode }) => {
    process.stdin.removeListener("data", onData);
    process.stdout.removeListener("resize", onResize);
    process.stdin.setRawMode(false);
    process.stdin.pause();

    lastExitCode = exitCode ?? 0;

    setTimeout(() => resumeInput(), 30);
  });
}

function spawnExternal(command: Command, done: () => void) {
  const child = spawn(command.cmd, command.args, {
    stdio: [resolveStdin(command), resolveStdout(command), resolveStderr(command)],
    env: process.env,
  });

  const sigintHandler = () => {};
  process.on("SIGINT", sigintHandler);
  let hadError = false;

  child.on("error", (err: NodeJS.ErrnoException) => {
    hadError = true;
    printSpawnError(command.cmd, err);
    process.removeListener("SIGINT", sigintHandler);
    done();
  });

  child.on("exit", (code) => {
    process.removeListener("SIGINT", sigintHandler);
    if (!hadError) {
      lastExitCode = code ?? 0;
    }
    if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
    if (!hadError) done();
  });
}

function resolveStdin(cmd: Command): any {
  const r = cmd.redirects.find((r) => r.type === "<");
  if (r) {
    try { return fs.openSync(r.file, "r"); }
    catch { console.log(`fsh: ${r.file}: No such file or directory`); }
  }
  return "inherit";
}

function resolveStdout(cmd: Command): any {
  const r = cmd.redirects.find((r) => r.type === ">" || r.type === ">>");
  if (r) {
    try { return fs.openSync(r.file, r.type === ">>" ? "a" : "w"); }
    catch { console.log(`fsh: ${r.file}: Permission denied`); }
  }
  return "inherit";
}

function resolveStderr(cmd: Command): any {
  return "inherit";
}

function printSpawnError(cmd: string, err: NodeJS.ErrnoException) {
  if (err.code === "ENOENT") {
    console.log(`fsh: ${cmd}: command not found`);
    lastExitCode = 127;
  } else {
    console.log(`fsh: ${cmd}: ${err.message}`);
    lastExitCode = 1;
  }
}