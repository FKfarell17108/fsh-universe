import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execFileSync } from "child_process";

export type GitInfo = {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  staged: boolean;
  untracked: boolean;
};

function findGitRoot(dir: string): string | null {
  let current = dir;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readFile(p: string): string | null {
  try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; }
}

export function getGitInfo(): GitInfo | null {
  const root = findGitRoot(process.cwd());
  if (!root) return null;

  const gitDir = path.join(root, ".git");

  let branch = "HEAD";
  const head = readFile(path.join(gitDir, "HEAD"));
  if (head) {
    if (head.startsWith("ref: refs/heads/")) {
      branch = head.slice("ref: refs/heads/".length);
    } else {
      branch = head.slice(0, 7);
    }
  }

  let dirty = false;
  let staged = false;
  let untracked = false;
  let ahead = 0;
  let behind = 0;

  try {
    const out: string = execFileSync(
      "git",
      ["status", "--porcelain=v2", "--branch"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );

    for (const line of out.split("\n")) {
      if (line.startsWith("# branch.ab ")) {
        const m = line.match(/\+(\d+) -(\d+)/);
        if (m) { ahead = parseInt(m[1]); behind = parseInt(m[2]); }
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const xy = line.slice(2, 4);
        if (xy[0] !== "." && xy[0] !== "?") staged = true;
        if (xy[1] !== "." && xy[1] !== "?") dirty = true;
      } else if (line.startsWith("? ")) {
        untracked = true;
      }
    }
  } catch {
    return null;
  }

  return { branch, dirty, staged, untracked, ahead, behind };
}

export function formatGitPrompt(info: GitInfo): string {
  let s = chalk.gray("(") + chalk.magenta(info.branch);

  const indicators: string[] = [];
  if (info.staged)    indicators.push(chalk.green("●")); 
  if (info.dirty)     indicators.push(chalk.yellow("✚"));
  if (info.untracked) indicators.push(chalk.red("…"));  

  if (indicators.length > 0) s += " " + indicators.join("");

  if (info.ahead > 0)  s += " " + chalk.cyan(`↑${info.ahead}`);
  if (info.behind > 0) s += " " + chalk.red(`↓${info.behind}`);

  s += chalk.gray(")");
  return s;
}