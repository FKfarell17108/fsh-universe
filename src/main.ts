import readline from "readline";
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
  showHistoryManager, HistoryResult,
} from "./historyManager";
import { highlight } from "./highlight";
import { loadFshrc } from "./fshrc";
import { printNeofetch, isNeofetchEnabled } from "./neofetch";
import { showSearch } from "./search";
import { showGeneralHistory, loadGeneralHistory, logEvent } from "./generalHistory";
import { openFileOpsLogFromMain } from "./fileOpsLog";
import { loadLog } from "./fileOps";

loadFshrc();
loadLog();
loadGeneralHistory();

if (isNeofetchEnabled()) printNeofetch();

let rl: readline.Interface;
let historyEntries: HistoryEntry[] = loadHistoryEntries();
let savedHistory: string[]         = entriesToStrings(historyEntries);
let tabHandlerActive               = false;
let lastExitCodeForPrompt          = 0;
let inputPaused                    = false;

// Global SIGINT guard: absorb SIGINT ONLY during interactive UI transitions
// (when _absorbSigint=true / inputPaused=true).
// When false: readline handles it, or executor's per-child handler does.
// An empty handler here would prevent SIGINT from reaching child processes.
let _absorbSigint = false;
export function setAbsorbSigint(v: boolean) { _absorbSigint = v; }

process.on("SIGINT", () => {
  // Absorb silently during interactive UI transitions.
  // During spawnExternal: _absorbSigint is false, executor's own
  // sigintHandler forwards SIGINT to the child process.
  if (_absorbSigint) return;
});

export function isInputPaused(): boolean { return inputPaused; }

export function getPrompt(): string {
  const cwd     = process.cwd();
  const folder  = path.basename(cwd) || "/";
  const gitInfo = getGitInfo();
  const git     = gitInfo ? " " + formatGitPrompt(gitInfo) : "";
  const arrow   = lastExitCodeForPrompt !== 0 ? chalk.red(" > ") : " > ";
  return `fsh/${chalk.blue(folder)}${git}${arrow}`;
}

export function setLastExitCode(code: number) {
  lastExitCodeForPrompt = code;
}

export function pauseInput() {
  inputPaused   = true;
  _absorbSigint = true;
  if (rl) {
    savedHistory = (rl as any).history?.slice() ?? [];
    saveHistoryEntries(historyEntries);
    rl.close();
    (rl as any) = null;
  }
  tabHandlerActive = false;
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
}

export function resumeInput() {
  inputPaused   = false;
  _absorbSigint = false;
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  setTimeout(() => { createRl(); prompt(); }, 50);
}

// Pause readline without setting _absorbSigint — used by spawnExternal
// so Ctrl+C is NOT intercepted by the global SIGINT guard.
export function pauseInputForExternal() {
  inputPaused = true;
  // _absorbSigint stays false — executor registers its own sigintHandler
  if (rl) {
    savedHistory = (rl as any).history?.slice() ?? [];
    saveHistoryEntries(historyEntries);
    rl.close();
    (rl as any) = null;
  }
  tabHandlerActive = false;
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
}

// Like resumeInput but calls callback instead of prompt() after rl is ready.
// Used by spawnExternal so the executor done() callback runs with rl active.
export function resumeInputThen(cb: () => void) {
  inputPaused   = false;
  _absorbSigint = false;
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  setTimeout(() => { createRl(); cb(); }, 50);
}

export function resumeInputAndExecute(cmdLine: string) {
  inputPaused   = false;
  _absorbSigint = false;
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  setTimeout(() => {
    createRl();
    const statement = parseInput(cmdLine);
    execute(statement, () => { setLastExitCode(getLastExitCode()); prompt(); });
  }, 50);
}

export function reloadHistoryInRl(updated: HistoryEntry[]) {
  historyEntries = updated;
  savedHistory   = entriesToStrings(updated);
  saveHistoryEntries(updated);
  if (rl) (rl as any).history = savedHistory.slice();
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function ansiCursorPos(highlighted: string, rawCursor: number): number {
  let visible = 0; let i = 0;
  while (i < highlighted.length && visible < rawCursor) {
    if (highlighted[i] === "\x1b") {
      const end = highlighted.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visible++; i++;
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

    // Ctrl+H = general history / file ops log
    if (tabHandlerActive && key.sequence === "\x08") {
      openGeneralHistory();
      return;
    }

    // Ctrl+R = fuzzy search
    if (tabHandlerActive && key.sequence === "\x12") {
      openSearch();
      return;
    }

    if (tabHandlerActive && key.name === "tab") {
      const line: string = rlAny.line ?? "";

      if (line.trim() === "") {
        if (historyEntries.length === 0) {
          process.stdout.write("\n" + chalk.gray("  (no command history yet)") + "\n");
          rlAny._refreshLine?.();
          return;
        }
        openCommandHistoryPicker();
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

      openCompletionPicker(candidates, line, partial);
      return;
    }

    original(s, key);
    if (tabHandlerActive) rlAny._refreshLine?.();
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

function openGeneralHistory() {
  tabHandlerActive = false;
  pauseInput();
  showGeneralHistory(() => resumeInput());
}

function openCommandHistoryPicker() {
  tabHandlerActive = false;
  pauseInput();
  showHistoryManager(historyEntries, (result: HistoryResult) => {
    historyEntries = result.entries;
    savedHistory   = entriesToStrings(result.entries);
    saveHistoryEntries(result.entries);
    if (result.kind === "selected") {
      resumeInputWithLine(result.cmd);
    } else {
      resumeInput();
    }
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

function openCompletionPicker(candidates: string[], line: string, partial: string) {
  tabHandlerActive = false;
  pauseInput();
  showPicker(
    candidates,
    (chosen) => resumeInputWithLine(line.slice(0, line.length - partial.length) + chosen),
    () => resumeInputWithLine(line),
    () => {
      resumeInput();
      setTimeout(() => {
        pauseInput();
        showHistoryManager(historyEntries, (result: HistoryResult) => {
          historyEntries = result.entries;
          savedHistory   = entriesToStrings(result.entries);
          saveHistoryEntries(result.entries);
          if (result.kind === "selected") {
            resumeInputWithLine(result.cmd);
          } else {
            resumeInput();
          }
        });
      }, 60);
    }
  );
}

function resumeInputWithLine(restoreLine: string) {
  inputPaused   = false;
  _absorbSigint = false;
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  setTimeout(() => { createRl(); promptWithLine(restoreLine); }, 50);
}

function createRl() {
  if (rl) {
    try {
      savedHistory = (rl as any).history?.slice() ?? [];
      saveHistoryEntries(historyEntries);
      rl.close();
    } catch {}
    (rl as any) = null;
  }
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  rl = readline.createInterface({
    input: process.stdin, output: process.stdout,
    terminal: true, historySize: 500,
  });
  if (savedHistory.length > 0) (rl as any).history = savedHistory.slice();
  rl.on("SIGINT", () => {
    lastExitCodeForPrompt = 0;
    process.stdout.write("\n");
    createRl();
    prompt();
  });
  setupTabIntercept();
}

function setLine(newLine: string) {
  const rlAny  = rl as any;
  rlAny.line   = newLine;
  rlAny.cursor = newLine.length;
  rlAny._refreshLine?.();
}

export function startPrompt() { createRl(); prompt(); }

function prompt() {
  tabHandlerActive = true;
  rl.question(getPrompt(), (input) => {
    tabHandlerActive = false;
    const cleanInput = input.trim();
    if (!cleanInput) return prompt();
    const rawInput = stripAnsi(cleanInput);
    historyEntries = pushEntry(historyEntries, rawInput);
    savedHistory   = entriesToStrings(historyEntries);
    saveHistoryEntries(historyEntries);
    logEvent("command", rawInput, "");
    const expanded  = expandAliases(rawInput);
    const statement = parseInput(expanded);
    execute(statement, () => { setLastExitCode(getLastExitCode()); prompt(); });
  });
}

function promptWithLine(prefill: string) {
  tabHandlerActive = true;
  rl.question(getPrompt(), (input) => {
    tabHandlerActive = false;
    const cleanInput = input.trim();
    if (!cleanInput) return prompt();
    const rawInput = stripAnsi(cleanInput);
    historyEntries = pushEntry(historyEntries, rawInput);
    savedHistory   = entriesToStrings(historyEntries);
    saveHistoryEntries(historyEntries);
    logEvent("command", rawInput, "");
    const expanded  = expandAliases(rawInput);
    const statement = parseInput(expanded);
    execute(statement, () => { setLastExitCode(getLastExitCode()); prompt(); });
  });
  if (prefill) setTimeout(() => setLine(prefill), 10);
}

startPrompt();