# FSH (FK Shell) v2.0.0

> A custom Unix shell, developed using TypeScript, and designed specifically for FK Universe to deliver a unique terminal experience.

---

## What is fsh?

**FSH** (FK Shell) is a full-featured Unix shell developed using TypeScript and Node.js. FSH replaces the default shell (bash/zsh) and provides all standard shell features, such as executing commands, piping, and redirection.

**Shell** is a program that interprets what we type in the terminal. It operates using the REPL (Read, Evaluate, Print, Loop) model. FSH is capable of doing all of that, while significantly enhancing the user experience to meet the specific needs of the FK Universe — an interactive terminal, a history manager, a trash system, an auto-completion system, and much more.

---

## Changelog

### v2.0.0 — Major Update

#### TUI Architecture Overhaul
- **Nano-style navbar** — all interactive screens display a fixed navbar at the top with keyboard shortcuts. Adaptive: 1 row when shortcuts are 7 or fewer, 2 rows when more are needed. Auto-collapses to shorter hint strings when the terminal is narrow
- **Bottom status bar** — every screen shows a persistent bottom bar with context info (path, counts, clipboard state) on the left and a scroll indicator (`↓ 12 more` / `end`) on the right
- **Consistent layout across all screens** — `ls`, `dir`, `trash`, `history`, `search`, `completion picker`, `file ops log`, and `activity log` all share the same layout: navbar → separator → content → bottom bar
- **Fully responsive** — all screens recalculate layout on terminal resize, both while active and after returning from a sub-screen
- `drawNavbar(hints[], right?)` — adaptive tier system: picks the longest hint string that fits, automatically falls back to shorter versions as the terminal narrows; 2-row mode activates when no single row fits, split at the midpoint
- `drawFooter(footerRow, total, scrollTop, vis, statLeft?)` — two-zone footer: left = statistics (e.g. `3 dirs  12 files`), right = `↓ N more` or `(end)`
- `getNR()` — dynamic navbar height so all position calculations use it instead of a hardcoded constant
- `exitAlt()` — no longer sends extra `\r\n`, fixing the prompt appearing on the wrong line after leaving any interactive UI

#### File Operations System (new)
- **Copy / Cut / Paste** — `c` copy, `x` cut, `v` paste, available in both `ls` and `dir`
- **Rename** — `r` renames inline with a text input at the bottom
- **Move To** — `m` moves selected items to any path you specify
- **Persistent clipboard** — copy in folder A, navigate into any subdirectory, paste in folder B; clipboard stays active across navigation
- **Clipboard indicator** — bottom bar shows `⎘ filename` (copy) or `✂ filename` (cut) while clipboard is active; `Esc` cancels clipboard without quitting
- **File ops log** — every copy, cut, move, and rename is tracked with a unique id, source path, destination path, timestamp, and status (`✓` / `✗` / `…`). Persisted to `~/.fsh_fileops.json` (max 200 entries)
- **Log panel** — `h` inside `ls` / `dir`, or `Ctrl+H` from the prompt, opens the log panel. Press `Enter` on any entry for full detail view

#### Persistent Browser in ls
- `Enter` on a directory navigates into it without exiting the alt screen
- `Tab` goes up to the parent directory
- Clipboard and multi-selection persist across folder navigation
- `Esc` when clipboard is active cancels the clipboard, not quit
- `Ctrl+C` always quits

#### Multi-Select (ls, dir, trash)
- `Space` toggles selection on the item at cursor
- `a` selects all / deselects all
- All operations (copy, cut, paste, delete, restore) act on the full selection at once
- Selected items shown with `✓` prefix in magenta

#### interactiveDir
- Directory-only browser with full file operations parity to `ls`
- Copy, cut, paste, rename, move, delete, multi-select, clipboard, hidden toggle, and file ops log all available

#### General Activity Log (new)
- Centralized log for all shell activity: commands, copy, move, rename, trash, restore, delete. Persisted to `~/.fsh_general_history.json`
- `Ctrl+H` from the prompt opens the general history panel
- Three categories: **Commands**, **File & Folder Mutations**, **Trash Operations** — each collapsible with `Enter`
- Command history supports per-entry delete, group delete, multi-select delete, and delete all

#### History Manager
- Multi-select with `Space` and `a`
- `Enter` on an entry immediately uses the command (pastes to prompt)
- `d` deletes selected entries or the group at cursor; `D` deletes all with confirmation
- Grouped by time: Last hour, Today, Yesterday, This week, Older
- Returns typed `HistoryResult` — enables direct command execution from the picker

#### Fuzzy Search (`Ctrl+R`)
- Searches across command history, filesystem (files + directories), builtins, aliases, and executables simultaneously
- Results categorized by type with distinct colors
- `Enter` on a directory → `cd` into it; `Enter` on a file → opens editor picker; `Enter` on a command → uses it immediately

#### Show / Hide Hidden Files
- Press `.` inside `ls` or `dir` to toggle dotfiles on and off
- Available in the navbar on both screens

#### SIGINT & Process Fixes
- `Ctrl+C` no longer crashes or glitches during `ping`, `curl`, or other long-running commands
- `pauseInputForExternal()` — pauses readline without absorbing `SIGINT`, so the signal reaches the child process group correctly
- `resumeInputThen(cb)` — recreates readline then calls callback in one path, eliminating the double-prompt bug
- Pipeline exit code — only the last command in a pipe writes `lastExitCode`
- ANSI leak in syntax highlight fixed — `_refreshLine` saves and restores the raw line so highlight codes do not leak into history
- Circular alias loop detection — `expandAliases` has a depth limit of 10
- TTY race condition between `pauseInput` / `resumeInput` resolved
- `rl = null` check prevents double-call to `prompt()` after child exit
- `ls` returns typed `LsResult` (`{ kind: "quit" }` or `{ kind: "open"; editor; file }`) instead of a global variable

---

### v1.0.0 — Initial Release

- Core shell: pipes, redirection, logical operators, background jobs, env variable expansion
- Full PTY support for interactive TUI apps (vim, nano, htop, ssh, git, sudo)
- Interactive `ls` with grid layout, color coding, and editor picker
- Tab completion with visual picker UI
- Git info in prompt (branch, staged, modified, untracked, ahead/behind)
- Syntax highlighting while typing (commands, flags, operators, strings, variables)
- History manager grouped by time with delete
- Trash system with preview, restore, and permanent delete
- `~/.fshrc` config file for aliases and environment variables
- Neofetch on startup with custom FSH ASCII logo

---

## Features

### Core Shell
- Run any OS command (`git`, `npm`, `ping`, `curl`, etc.)
- Pipes: `cat file.txt | grep "error" | wc -l`
- Redirection: `echo "log" >> app.log`, `cat < input.txt`
- Logical operators: `&&`, `||`, `;`
- Background jobs: `npm run dev &`
- Environment variable expansion: `$HOME`, `$USER`
- Full PTY support for interactive TUI apps (vim, nano, htop, ssh, git, sudo, etc.)

### Built-in Commands

| Command | Description |
|---|---|
| `ls` | Interactive file browser with grid layout |
| `dir` | Interactive directory-only browser |
| `cd` | Change directory with `~` support |
| `clear` | Clear screen and scrollback buffer |
| `alias` | Create / list / remove aliases |
| `history` | Visual history manager |
| `trash` | Move files to trash, restore, or delete permanently |
| `fshrc` | Manage shell config file |
| `neofetch` | Display system info on startup |

### Interactive `ls`

Grid layout with color coding. Navigate entirely with the keyboard.

| Key | Action |
|---|---|
| `↑↓←→` | Navigate grid |
| `Space` | Select / deselect item |
| `a` | Select all / deselect all |
| `Enter` | Open file (editor picker) or enter directory |
| `Tab` | Go to parent directory |
| `c` | Copy selected item(s) to clipboard |
| `x` | Cut selected item(s) to clipboard |
| `v` | Paste clipboard contents to current directory |
| `r` | Rename selected item |
| `m` | Move selected item(s) to a specified path |
| `d` | Move to trash (with preview confirmation) |
| `.` | Toggle hidden files on / off |
| `h` | Open file operations log |
| `Esc` | Cancel clipboard / deselect all / quit |

### Interactive `dir`

Directory-only browser. Identical keyboard layout to `ls` with all file operations available.

### Tab Completion

- Single match → auto-complete inline
- Multiple matches → interactive picker UI (same grid style as `ls`)
- Completes commands, filenames, paths, and aliases
- `Tab` on an empty line → browse command history picker

### Git Info in Prompt

```
fsh/fsh-universe (main ●↑2) >
```

| Indicator | Meaning |
|---|---|
| `●` | Staged changes |
| `✚` | Modified files |
| `…` | Untracked files |
| `↑N` | N commits ahead of remote |
| `↓N` | N commits behind remote |

### Syntax Highlight While Typing

| Token | Color |
|---|---|
| Valid command | Green |
| Invalid command | Red |
| Flags (`-v`, `--help`) | Yellow |
| Operators (`\|`, `&&`) | Cyan |
| Strings (`"hello"`) | Orange |
| Variables (`$HOME`) | Magenta |

### History Manager (`history`)

| Key | Action |
|---|---|
| `↑↓` | Navigate |
| `Space` | Select / deselect entry |
| `a` | Select all / deselect all |
| `Enter` | Use command immediately |
| `d` | Delete selected entries or group at cursor |
| `D` | Delete all history (with confirmation) |
| `Esc` | Deselect / close |

History is grouped by time: Last hour, Today, Yesterday, This week, Older. Persisted to `~/.fsh_history`.

### Fuzzy Search (`Ctrl+R`)

Full-screen search across all sources simultaneously.

| Key | Action |
|---|---|
| Type | Filter results in real time |
| `↑↓` | Navigate results |
| `Enter` on command | Use command |
| `Enter` on directory | `cd` into it |
| `Enter` on file | Open with editor picker |
| `Esc` | Cancel |

Results are categorized: Command history, Directories, Files, Builtins, Aliases, Executables.

### General Activity Log (`Ctrl+H` from prompt)

Centralized log of all shell activity. Persisted to `~/.fsh_general_history.json`.

| Category | What is logged |
|---|---|
| Commands | Every command executed |
| File & Folder Mutations | Copy, move, rename operations |
| Trash Operations | Trash, restore, delete, empty trash |

Press `Enter` on a category header to expand it. Press `Enter` on the **Commands** header to open the command editor, where entries can be deleted individually or in bulk.

### File Operations Log (`h` inside `ls` or `dir`)

Every copy, cut, move, and rename is logged with:

| Field | Description |
|---|---|
| ID | Unique identifier |
| From | Source path |
| To | Destination path |
| Timestamp | Date and time |
| Status | `✓` done, `✗` error, `…` pending |

Persisted to `~/.fsh_fileops.json` (max 200 entries). Press `Enter` on any entry for the full detail view.

### Trash System (`trash`)

| Key | Action |
|---|---|
| `↑↓` | Navigate |
| `Space` | Select / deselect item |
| `a` | Select all |
| `Enter` | Preview file or directory contents |
| `r` | Restore to original location |
| `x` | Delete forever (with confirmation) |
| `D` | Empty entire trash (with confirmation) |
| `Esc` | Deselect / quit |

Files deleted from `ls` go to `~/.fsh_trash/` and can be browsed, restored, or permanently deleted.

### Config File (`~/.fshrc`)

```bash
# Aliases
alias ll='ls -la'
alias gs='git status'
alias ..='cd ..'

# Environment variables
export EDITOR=nano
export NODE_ENV=development
```

### Neofetch on Startup

Custom system info display with FSH ASCII logo showing OS, kernel, shell version, CPU, RAM, disk, uptime, IP, and color palette.

---

## TUI Layout

All interactive screens share the same structure:

```
┌─────────────────────────────────────────────────────────────────┐
│  ↑↓←→ Move   Spc Select   A All   Ent Open   Tab Parent  ...   │  ← navbar row 1
│  C Copy   X Cut   V Paste   R Rename   D Delete   . Hidden ...  │  ← navbar row 2 (> 7 items)
│  ─────────────────────────────────────────────────────────────  │  ← separator
│                                                                  │
│  [content area]                                                  │
│                                                                  │
│  ~/projects/fsh-universe  4d  12f  2 hidden      ↓ 8 more      │  ← bottom bar
└─────────────────────────────────────────────────────────────────┘
```

The navbar adapts to terminal width — longer hint strings when there is space, shorter ones when narrow. 1 row for screens with 7 shortcuts or fewer, 2 rows otherwise.

---

## What Makes fsh Different

| Feature | bash/zsh | fsh |
|---|---|---|
| Interactive file browser | ❌ | ✅ Grid with colors |
| Tab completion UI | Basic list | ✅ Visual picker |
| Delete to trash from ls | ❌ | ✅ With preview |
| Git info in prompt | Plugin needed | ✅ Built-in |
| Syntax highlight while typing | Plugin needed | ✅ Built-in |
| History manager UI | ❌ | ✅ Grouped by time |
| Custom neofetch | ❌ | ✅ Built-in |
| Nano-style keyboard navigation | ❌ | ✅ All TUI screens |
| Persistent bottom status bar | ❌ | ✅ Path + scroll info |
| Show / hide hidden files toggle | ❌ | ✅ Press `.` in ls / dir |
| In-shell copy / cut / paste | ❌ | ✅ With persistent clipboard |
| File operations log | ❌ | ✅ Tracked with id + timestamp |
| Centralized activity log | ❌ | ✅ Commands + file ops + trash |
| Fuzzy search across all sources | ❌ | ✅ `Ctrl+R` |
| Multi-select for bulk operations | ❌ | ✅ `Space` + `a` |
| Persistent browser (no exit on Enter) | ❌ | ✅ Navigate without leaving ls |

---

## Setup

### Prerequisites
- Node.js v16+ (recommended: use [nvm](https://github.com/nvm-sh/nvm))
- npm
- Linux / WSL Ubuntu

### Install

Clone the repository:

```bash
git clone https://github.com/FKfarell17108/fsh-universe.git
cd fsh-universe
```

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

### Set as Default Shell

```bash
sudo nano /usr/local/bin/fsh
```

Paste this content:

```bash
#!/bin/bash

if [[ ! -t 0 ]] || \
   [[ -n "$VSCODE_AGENT_FOLDER" ]] || \
   [[ -n "$VSCODE_IPC_HOOK_CLI" ]] || \
   [[ -n "$VSCODE_HANDLES_SIGPIPE" ]]; then
  exec /bin/bash "$@"
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
exec node /home/farell/projects/shell/fsh-universe/dist/main.js "$@"
```

Make executable:

```bash
sudo chmod +x /usr/local/bin/fsh
```

Register as valid shell:

```bash
echo "/usr/local/bin/fsh" | sudo tee -a /etc/shells
```

Set as default:

```bash
chsh -s /usr/local/bin/fsh
```

Restart your terminal.

### Update After Code Changes

```bash
cd ~/path/to/fsh-universe
npm run build
# Restart terminal — changes apply immediately
```

---

## Data Files

| File | Contents | Max entries |
|---|---|---|
| `~/.fsh_history` | Command history | 500 |
| `~/.fsh_general_history.json` | All activity: commands, file ops, trash | 500 |
| `~/.fsh_fileops.json` | File operation log: copy, move, rename | 200 |
| `~/.fsh_trash/` | Trashed files | — |
| `~/.fsh_trash/.meta.json` | Trash metadata: original paths, timestamps | — |
| `~/.fshrc` | Shell configuration: aliases, env vars | — |
| `~/.fsh_neofetch` | Neofetch on/off state | — |

---

## © 2026 Farell Kurniawan

This project is proprietary software under the FK Universe License.
All rights reserved. Unauthorized use, copying, or distribution is strictly prohibited.
This repository is for viewing purposes only.
