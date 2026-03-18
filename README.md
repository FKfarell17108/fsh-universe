# FSH (FK Shell) v1.0.0

> A custom Unix shell built from scratch using TypeScript, designed to offer a unique terminal experience.

---

## What is fsh?

**FSH** (FK Shell) is a full-featured Unix shell developed from scratch using TypeScript and Node.js. FSH replaces the default shell (bash/zsh) and provides all standard shell features, such as executing commands, piping, and redirection.

**Shell** is a program that runs when you open a terminal. It reads commands, executes them, and displays the results. FSH does all of that, and significantly enhances the experience with features like file browsing, tab-based autocompletion, history management, and much more.

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
| `cd` | Change directory with `~` support |
| `clear` | Clear screen and scrollback buffer |
| `alias` | Create/list/remove aliases |
| `history` | Visual history manager |
| `trash` | Move files to trash, restore, or delete permanently |
| `fshrc` | Manage shell config file |
| `neofetch` | Display system info on startup |

### Interactive `ls`
- Grid layout with color coding (directories, hidden files, regular files)
- Navigate with arrow keys
- Press `Enter` on a file → choose which editor to open it with
- Press `Enter` on a directory → navigate into it
- Press `d` → move to trash with preview confirmation

### Tab Completion
- Single match → auto-complete inline
- Multiple matches → interactive picker UI (same style as `ls`)
- Completes commands, filenames, paths, and aliases
- Press `Tab` on empty line → browse command history

### Git Info in Prompt
```
fsh/fsh-universe (main ●↑2) >
```
Shows branch name, staged (`●`), modified (`✚`), untracked (`…`), ahead (`↑`), behind (`↓`).

### Syntax Highlight While Typing
- Valid command → green
- Invalid command → red
- Flags (`-v`, `--help`) → yellow
- Operators (`|`, `&&`) → cyan
- Strings (`"hello"`) → orange
- Variables (`$HOME`) → magenta

### History Manager (`history`)
- Browse history grouped by time: Last hour, Today, Yesterday, This week, Older
- Navigate with `↑↓`
- Delete a single entry: `d`
- Delete an entire group: `d` on the group header
- Delete all history: `D` (with confirmation)
- History persists across sessions in `~/.fsh_history`

### Trash System (`trash`)
- Files deleted from `ls` go to `~/.fsh_trash/` — not permanent
- `trash` → open visual trash viewer
- Browse trashed files, preview contents, enter directories
- `r` → restore to original location
- `x` → permanently delete one item
- `D` → empty entire trash (with confirmation)

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
Custom system info display with fsh ASCII logo showing OS, kernel, shell version, CPU, RAM, disk, uptime, IP, and color palette.

---

## What Makes fsh Different

| Feature | bash/zsh | fsh |
|---|---|---|
| Interactive file browser | ❌ | ✅ Grid with colors |
| Tab completion UI | Basic list | ✅ Visual picker |
| Delete to trash from ls | ❌ | ✅ With preview |
| Git info in prompt | Plugin needed | ✅ Built-in |
| Syntax highlight while typing | Plugin needed | ✅ Built-in |
| History manager UI | ❌ | ✅ Group by time |
| Custom neofetch | ❌ | ✅ Built-in |

---

## Setup

### Prerequisites
- Node.js v16+ (recommended: use [nvm](https://github.com/nvm-sh/nvm))
- npm
- Linux / WSL Ubuntu

### Install

Clone the repository
```bash
git clone https://github.com/FKfarell17108/fsh-universe.git
cd fsh-universe
```

Install dependencies
```bash
npm install
```

Build
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

Make executable
```bash
sudo chmod +x /usr/local/bin/fsh
```

Register as valid shell
```bash
echo "/usr/local/bin/fsh" | sudo tee -a /etc/shells
```

Set as default
```bash
chsh -s /usr/local/bin/fsh
```

Restart your terminal.

### Update After Code Changes

```bash
cd ~/path/to/fsh-universe
npm run build
# Restart terminal - changes apply immediately
```

---

## Usage

### Basic Commands
```bash
# Run any command
git status
npm install
ping google.com

# Pipes and redirection
ls | grep ".ts"
cat error.log > backup.log
echo "hello" >> notes.txt

# Logical operators
mkdir new-project && cd new-project
cat file.txt || echo "file not found"

# Background
npm run dev &
```

### Aliases
```bash
alias gs='git status'     # create
alias                     # list all
unalias gs                # remove
```

### Config File
```bash
fshrc init      # create ~/.fshrc with defaults
fshrc reload    # reload after editing
fshrc path      # show file location
```

### History
```bash
history         # open history manager
# ↑↓ navigate, d delete entry, D delete all, q quit
```

### Trash
```bash
trash           # open trash viewer
# In ls: press d on any file/folder to move to trash
# In trash: r restore, x delete forever, D empty all
```

### Neofetch
```bash
neofetch        # show once
neofetch on     # enable on every startup
neofetch off    # disable
```

---

## © 2026 Farell Kurniawan

Copyright © 2026 Farell Kurniawan. All rights reserved.  
Distribution and use of this code is permitted under the terms of the **MIT** license.
