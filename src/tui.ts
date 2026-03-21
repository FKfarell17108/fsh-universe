import chalk from "chalk";

export const w   = process.stdout.write.bind(process.stdout);
export const at  = (r: number, c: number) => `\x1b[${r};${c}H`;
export const clr = () => `\x1b[2K`;
export const C   = () => process.stdout.columns || 80;
export const R   = () => process.stdout.rows    || 24;

export const NAVBAR_ROWS = 3;
export const FOOTER_ROWS = 0;
export function getNR(): number { return 0; }

export type NavItem = { key: string; label: string; };

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

function renderNavRow(items: NavItem[], cols: number): string {
  if (items.length === 0) return chalk.bgBlack(" ".repeat(cols));

  const n        = items.length;
  const keyW     = Math.max(items.reduce((m, it) => Math.max(m, it.key.length), 0), 3);
  const keyBlockW = keyW + 2;
  const sepCount  = n - 1;
  const usableW   = cols - sepCount;
  const slotW     = Math.floor(usableW / n);
  const lastSlotW = usableW - slotW * (n - 1);
  const sep       = chalk.dim.bgBlack("│");
  let   out       = "";

  for (let i = 0; i < n; i++) {
    const slotWidth = i === n - 1 ? lastSlotW : slotW;
    const { key, label } = items[i];

    const keyPad   = Math.max(0, keyW - key.length);
    const keyLeft  = Math.floor(keyPad / 2);
    const keyRight = keyPad - keyLeft;
    const keyStr   = " ".repeat(keyLeft) + key + " ".repeat(keyRight);
    const keyBlock = chalk.bgWhite.black.bold(` ${keyStr} `);

    const labelAvail = Math.max(0, slotWidth - keyBlockW - 1);
    const truncated  = label.length > labelAvail
      ? label.slice(0, Math.max(0, labelAvail - 1)) + "…"
      : label;
    const labelPad = Math.max(0, labelAvail - truncated.length);

    out += keyBlock + chalk.bgBlack.white(" " + truncated + " ".repeat(labelPad));
    if (i < n - 1) out += sep;
  }

  return out;
}

export type NavRows = NavItem[][];

export function drawNavbar(rows: NavRows | NavItem[], split?: number): void {
  const cols = C();
  let   out  = "";
  let   rowArr: NavItem[][];

  if (Array.isArray(rows) && rows.length > 0 && !Array.isArray(rows[0])) {
    const flat    = rows as NavItem[];
    const splitAt = split !== undefined
      ? Math.max(1, Math.min(split, flat.length))
      : Math.ceil(flat.length / 2);
    const r1 = flat.slice(0, splitAt);
    const r2 = flat.slice(splitAt);
    rowArr = r2.length ? [r1, r2] : [r1];
  } else {
    rowArr = rows as NavItem[][];
  }

  if (rowArr.length === 0) {
    out += at(1, 1) + clr() + chalk.bgBlack(" ".repeat(cols));
    out += at(2, 1) + clr() + chalk.dim("─".repeat(cols));
    w(out);
    return;
  }

  for (let r = 0; r < rowArr.length; r++) {
    out += at(r + 1, 1) + clr() + renderNavRow(rowArr[r], cols);
  }
  out += at(rowArr.length + 1, 1) + clr() + chalk.dim("─".repeat(cols));

  w(out);
}

export function nrFromRows(rows: NavRows | NavItem[], split?: number): number {
  if (Array.isArray(rows) && rows.length > 0 && !Array.isArray(rows[0])) {
    const flat    = rows as NavItem[];
    const splitAt = split !== undefined
      ? Math.max(1, Math.min(split, flat.length))
      : Math.ceil(flat.length / 2);
    return flat.length > splitAt ? 3 : 2;
  }
  return (rows as NavItem[][]).length + 1;
}

export function drawBottomBar(left: string, right: string): void {
  const cols = C();
  const row  = R();
  const ls   = left  ? "  " + left  : "";
  const rs   = right ? right + "  " : "";
  const gap  = Math.max(0, cols - visibleLen(ls) - visibleLen(rs));
  w(at(row, 1) + clr() + chalk.dim(ls) + " ".repeat(gap) + chalk.dim(rs));
}

export function drawFooter(
  _footerRow: number,
  total: number,
  scrollTop: number,
  vis: number,
  statLeft?: string
): void {
  const more = total - (scrollTop + vis);
  const rs   = total > vis ? (more > 0 ? `↓ ${more} more` : "end") : "";
  drawBottomBar(statLeft ?? "", rs);
}

export function kb(s: string): string {
  return chalk.bgGray.white.bold(` ${s} `);
}

export function enterAlt(): void    { w("\x1b[?1049h\x1b[?25l"); }
export function exitAlt(): void     { w("\x1b[?25h\x1b[?1049l\x1b[0m"); }
export function clearScreen(): void { w("\x1b[2J"); }