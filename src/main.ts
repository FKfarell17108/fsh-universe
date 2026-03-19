import readline from "readline";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { parseInput } from "./parser";
import { execute, getLastExitCode } from "./executor";
import { expandAliases } from "./aliases";
import { getCandidates, commonPrefix, showPicker } from "./completion";
import { getGitInfo, formatGitPrompt } from "./git";
import {
  loadHistoryEntries, saveHistoryEntries,
  entriesToStrings, pushEntry, HistoryEntry,
  showHistoryManager,
} from "./historyManager";
import { highlight } from "./highlight";
import { loadFshrc } from "./fshrc";
import { printNeofetch, isNeofetchEnabled } from "./neofetch";
import { showSearch } from "./search";

loadFshrc();

if (isNeofetchEnabled()) printNeofetch();

let rl: readline.Interface;
let historyEntries: HistoryEntry[] = loadHistoryEntries();
let savedHistory: string[]          = entriesToStrings(historyEntries);
let tabHandlerActive                = false;
let lastExitCodeForPrompt           = 0;
let inputPaused                     = false;

export function isInputPaused(): boolean {
  return inputPaused;
}

export function getPrompt(): string {
  const cwd    = process.cwd();
  const folder = path.basename(cwd) || "/";
  const gitInfo = getGitInfo();
  const git     = gitInfo ? " " + formatGitPrompt(gitInfo) : "";
  const arrow   = lastExitCodeForPrompt !== 0 ? chalk.red(" > ") : " > ";
  return `fsh/${chalk.blue(folder)}${git}${arrow}`;
}

export function setLastExitCode(code: number) {
  lastExitCodeForPrompt = code;
}

export function pauseInput() {
  inputPaused = true;
  if (rl) {
    savedHistory = (rl as any).history?.slice() ?? [];
    saveHistoryEntries(historyEntries);
    rl.close();
  }
  tabHandlerActive = false;
}

export function resumeInput() {
  inputPaused = false;
  setTimeout(() => {
    createRl();
    prompt();
  }, 50);
}

export function reloadHistoryInRl(updated: HistoryEntry[]) {
  historyEntries = updated;
  savedHistory   = entriesToStrings(updated);
  saveHistoryEntries(updated);
  if (rl) {
    (rl as any).history = savedHistory.slice();
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function ansiLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*[\x40-\x7e]/g, "").length;
}

function ansiCursorPos(highlighted: string, rawCursor: number): number {
  let visible = 0;
  let i       = 0;
  while (i < highlighted.length && visible < rawCursor) {
    if (highlighted[i] === "\x1b") {
      const end = highlighted.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visible++;
    i++;
  }
  return i;
}

function setupTabIntercept() {
  const rlAny    = rl as any;
  const original = rlAny._ttyWrite?.bind(rl);
  if (!original) return;

  tabHandlerActive = true;

  rlAny._ttyWrite = function (s: string, key: any) {
    if (!key) return original(s, key);

    if (tabHandlerActive && key.name === "tab") {
      const line: string = rlAny.line ?? "";

      if (line.trim() === "") {
        const hist: string[] = rlAny.history ?? [];
        if (hist.length === 0) {
          process.stdout.write("\n" + chalk.gray("  (no command history yet)") + "\n");
          rlAny._refreshLine?.();
          return;
        }
        openPicker(hist, line, "");
        return;
      }

      const { candidates, partial } = getCandidates(line);
      if (candidates.length === 0) return;

      if (candidates.length === 1) {
        setLine(line.slice(0, line.length - partial.length) + candidates[0]);
        return;
      }

      const prefix = commonPrefix(candidates);
      if (prefix.length > partial.length) {
        setLine(line.slice(0, line.length - partial.length) + prefix);
        return;
      }

      openPicker(candidates, line, partial);
      return;
    }

    if (tabHandlerActive && key.name === "tab") return;

    if (tabHandlerActive && key.sequence === "\x12") {
      openSearch();
      return;
    }

    original(s, key);

    if (tabHandlerActive) {
      rlAny._refreshLine?.();
    }
  };

  const origRefresh = rlAny._refreshLine?.bind(rl);
  if (origRefresh) {
    rlAny._refreshLine = function () {
      const rawLine: string   = rlAny.line   ?? "";
      const rawCursor: number = rlAny.cursor  ?? 0;

      if (rawLine.length === 0) return origRefresh();

      const highlighted       = highlight(rawLine);
      const cursorInHighlight = ansiCursorPos(highlighted, rawCursor);

      rlAny.line   = highlighted;
      rlAny.cursor = cursorInHighlight;

      origRefresh();

      rlAny.line   = rawLine;
      rlAny.cursor = rawCursor;
    };
  }
}

function openHistory() {
  tabHandlerActive = false;
  pauseInput();
  showHistoryManager(historyEntries, (updated) => {
    reloadHistoryInRl(updated);
    resumeInput();
  });
}

function openSearch() {
  tabHandlerActive = false;
  pauseInput();
  showSearch(
    historyEntries,
    (value) => resumeInputWithLine(value),
    () => resumeInput()
  );
}

function openPicker(candidates: string[], line: string, partial: string) {
  tabHandlerActive = false;
  pauseInput();

  showPicker(
    candidates,
    (chosen) => {
      const newLine = line.slice(0, line.length - partial.length) + chosen;
      resumeInputWithLine(newLine);
    },
    () => resumeInputWithLine(line),
    () => {
      resumeInput();
      setTimeout(() => openHistory(), 60);
    }
  );
}

function resumeInputWithLine(restoreLine: string) {
  setTimeout(() => {
    createRl();
    promptWithLine(restoreLine);
  }, 50);
}

function createRl() {
  if (rl) {
    savedHistory = (rl as any).history?.slice() ?? [];
    saveHistoryEntries(historyEntries);
    rl.close();
  }

  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  rl = readline.createInterface({
    input:       process.stdin,
    output:      process.stdout,
    terminal:    true,
    historySize: 500,
  });

  if (savedHistory.length > 0) {
    (rl as any).history = savedHistory.slice();
  }

  rl.on("SIGINT", () => {
    lastExitCodeForPrompt = 0;
    process.stdout.write("\n");
    createRl();
    prompt();
  });

  setupTabIntercept();
}

function setLine(newLine: string) {
  const rlAny    = rl as any;
  rlAny.line     = newLine;
  rlAny.cursor   = newLine.length;
  rlAny._refreshLine?.();
}

export function startPrompt() {
  createRl();
  prompt();
}

function prompt() {
  tabHandlerActive = true;
  rl.question(getPrompt(), (input) => {
    tabHandlerActive    = false;
    const cleanInput    = input.trim();
    if (!cleanInput) return prompt();

    const rawInput = stripAnsi(cleanInput);

    historyEntries = pushEntry(historyEntries, rawInput);
    savedHistory   = entriesToStrings(historyEntries);
    saveHistoryEntries(historyEntries);

    const expanded  = expandAliases(rawInput);
    const statement = parseInput(expanded);

    execute(statement, () => {
      setLastExitCode(getLastExitCode());
      prompt();
    });
  });
}

function promptWithLine(prefill: string) {
  tabHandlerActive = true;
  rl.question(getPrompt(), (input) => {
    tabHandlerActive    = false;
    const cleanInput    = input.trim();
    if (!cleanInput) return prompt();

    const rawInput = stripAnsi(cleanInput);

    historyEntries = pushEntry(historyEntries, rawInput);
    savedHistory   = entriesToStrings(historyEntries);
    saveHistoryEntries(historyEntries);

    const expanded  = expandAliases(rawInput);
    const statement = parseInput(expanded);

    execute(statement, () => {
      setLastExitCode(getLastExitCode());
      prompt();
    });
  });

  if (prefill) {
    setTimeout(() => setLine(prefill), 10);
  }
}

startPrompt();