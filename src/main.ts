import readline from "readline";
import path from "path";
import chalk from "chalk";
import { parseInput } from "./parser";
import { execute } from "./executor";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export function getPrompt(): string {
  const cwd = process.cwd();
  const folder = path.basename(cwd) || "/";
  return `fsh/${chalk.blue(folder)} > `;
}

export function pauseInput() {
  rl.pause();
}

export function resumeInput() {
  rl.resume();
}

export function startPrompt() {
  prompt();
}

function prompt() {
  rl.question(getPrompt(), (input) => {
    const cleanInput = input.trim();

    if (!cleanInput) return prompt();

    const commands = parseInput(cleanInput);

    execute(commands, () => {
      prompt();
    });
  });
}

startPrompt();