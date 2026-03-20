import chalk from "chalk";

export const w   = process.stdout.write.bind(process.stdout);
export const at  = (r: number, c: number) => `\x1b[${r};${c}H`;
export const clr = () => `\x1b[2K`;
export const C   = () => process.stdout.columns || 80;
export const R   = () => process.stdout.rows    || 24;

export const FOOTER_ROWS = 1;
export const NAVBAR_ROWS = 2; // kept for compat, use getNR() for actual value

let _navbarRows = 2;
export function getNR(): number { return _navbarRows; }

export function visibleLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*[\x40-\x7e]/g, "").length;
}

export function padOrTrim(str: string, width: number): string {
  const vlen = visibleLen(str);
  if (vlen < width) return str + " ".repeat(width - vlen);
  if (vlen === width) return str;
  let out = ""; let count = 0; let i = 0;
  while (i < str.length) {
    if (str[i] === "\x1b") {
      const end = str.indexOf("m", i);
      if (end !== -1) { out += str.slice(i, end + 1); i = end + 1; continue; }
    }
    if (count >= width - 1) { out += chalk.reset(""); break; }
    out += str[i]; count++; i++;
  }
  return out + chalk.reset("");
}

// Split a hint string into individual key+label tokens so we can wrap them
// across 2 navbar rows. Each token is like: kb("x") + gray(" label  ")
// We detect boundaries by looking for the grey reset pattern between tokens.
function splitHintTokens(hint: string): string[] {
  // Tokens are separated by visible space sequences between ANSI runs.
  // Strategy: split on pattern reset+bgGray (start of a new kb()) boundary.
  // We scan for '\x1b[0m' followed (after other escapes) by '\x1b[' which
  // starts the next kb bgGray — that's the boundary between tokens.
  const tokens: string[] = [];
  let current = "";
  let i = 0;

  while (i < hint.length) {
    // Detect start of a new kb() block: bgGray escape \x1b[4...m or similar
    // More reliable: split just before each " \x1b[" that starts a bgGray kb
    // Pattern: visible space(s) then \x1b[47m or \x1b[100m (bgGray variants)
    const rest = hint.slice(i);
    // Match: end of previous label (gray text ends) then start of new kb block
    // A kb block starts with chalk.bgGray which produces \x1b[XX;Xm` \x1b[Xm`
    // Simplest: split at every occurrence of "  " + ESC that's after content
    const match = rest.match(/^(\x1b\[[0-9;]*m)/);
    if (match) {
      current += match[0];
      i += match[0].length;
      continue;
    }
    // Check if we're at a natural split point: after gray label text,
    // before a new kb() — indicated by multiple spaces then ESC[
    const splitMatch = rest.match(/^(  +)(\x1b\[)/);
    if (splitMatch && current.length > 0 && visibleLen(current) > 4) {
      // Trim trailing spaces from current token, push, start new
      tokens.push(current);
      current = "";
      // skip the separator spaces (but keep one for indent)
      i += splitMatch[1].length;
      continue;
    }
    current += hint[i];
    i++;
  }
  if (current) tokens.push(current);
  return tokens.filter(t => visibleLen(t.trim()) > 0);
}

export function drawNavbar(hints: string[], right?: string): number {
  const cols     = C();
  const rightStr = right ? " " + right + " " : "";
  const rightLen = visibleLen(rightStr);
  const avail    = cols - 2 - rightLen;

  // Try to fit the most complete hint in 1 row
  let chosen: string | null = null;
  for (const h of hints) {
    if (visibleLen(h) <= avail) { chosen = h; break; }
  }

  let out = "";

  if (chosen !== null) {
    // Single row navbar
    _navbarRows = 2;
    const row1 = padOrTrim(" " + chosen, cols - rightLen) +
                 (rightLen > 0 ? chalk.bgBlack.dim(rightStr) : "");
    out  = at(1, 1) + clr() + chalk.bgBlack.white(row1);
    out += at(2, 1) + clr() + chalk.dim("─".repeat(cols));
  } else {
    // Need 2 content rows — split the fullest hint across 2 lines
    _navbarRows = 3;
    const fullHint = hints[0]; // most complete hint
    const tokens   = splitHintTokens(fullHint);

    // Find optimal split point: half the visual width
    const totalLen = visibleLen(fullHint);
    const target   = Math.floor(totalLen / 2);

    let accum = 0;
    let splitAt = Math.ceil(tokens.length / 2); // fallback: half tokens
    for (let i = 0; i < tokens.length; i++) {
      accum += visibleLen(tokens[i]);
      if (accum >= target) { splitAt = i + 1; break; }
    }

    const line1Tokens = tokens.slice(0, splitAt);
    const line2Tokens = tokens.slice(splitAt);

    // Join tokens back with minimal spacing
    const line1Content = line1Tokens.join("  ");
    const line2Content = line2Tokens.join("  ");

    const row1 = padOrTrim(" " + line1Content, cols - rightLen) +
                 (rightLen > 0 ? chalk.bgBlack.dim(rightStr) : "");
    const row2 = padOrTrim(" " + line2Content, cols);

    out  = at(1, 1) + clr() + chalk.bgBlack.white(row1);
    out += at(2, 1) + clr() + chalk.bgBlack.white(row2);
    out += at(3, 1) + clr() + chalk.dim("─".repeat(cols));
  }

  w(out);
  return _navbarRows;
}

export function drawFooter(
  footerRow: number,
  total: number,
  scrollTop: number,
  vis: number,
  statLeft?: string
) {
  const cols    = C();
  const more    = total - (scrollTop + vis);
  const leftStr = statLeft ? "  " + statLeft : "";
  let rightStr  = "";
  if (total > vis) {
    rightStr = more > 0 ? `  ↓ ${more} more  ` : "  (end)  ";
  }
  const gap = Math.max(0, cols - visibleLen(leftStr) - visibleLen(rightStr));
  w(at(footerRow, 1) + clr() + chalk.dim(leftStr) + " ".repeat(gap) + chalk.dim(rightStr));
}

export function kb(s: string): string {
  return chalk.bgGray.white.bold(` ${s} `);
}

export function enterAlt() {
  w("\x1b[?1049h\x1b[?25l");
}

export function exitAlt() {
  w("\x1b[?25h\x1b[?1049l\x1b[0m");
}

export function clearScreen() {
  w("\x1b[2J");
}