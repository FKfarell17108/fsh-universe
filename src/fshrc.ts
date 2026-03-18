import fs from "fs";
import path from "path";
import { setAlias } from "./aliases";

const FSHRC = path.join(process.env.HOME ?? "~", ".fshrc");

export function loadFshrc() {
  let src: string;
  try {
    src = fs.readFileSync(FSHRC, "utf8");
  } catch {
    return;
  }

  for (const raw of src.split("\n")) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("alias ")) {
      const rest = line.slice(6).trim();
      const eq = rest.indexOf("=");
      if (eq === -1) continue;
      const name = rest.slice(0, eq).trim();
      let value = rest.slice(eq + 1).trim();
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }
      if (name) setAlias(name, value);
      continue;
    }

    const exportLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eqIdx = exportLine.indexOf("=");
    if (eqIdx !== -1) {
      const key = exportLine.slice(0, eqIdx).trim();
      let val = exportLine.slice(eqIdx + 1).trim();
      if (
        (val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith('"') && val.endsWith('"'))
      ) {
        val = val.slice(1, -1);
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        process.env[key] = val;
      }
    }
  }
}

export function generateDefaultFshrc(): string {
  return `# ~/.fshrc — fsh configuration file
# Loaded automatically on startup

# ── Aliases ───────────────────────────────────────────────────────────────────
alias ll='ls -la'
alias ..='cd ..'
alias ...='cd ../..'
alias gs='git status'
alias ga='git add .'
alias gc='git commit -m'
alias gp='git push'
alias gl='git log --oneline'

# ── Environment variables ─────────────────────────────────────────────────────
# export EDITOR=nano
# export NODE_ENV=development
`;
}