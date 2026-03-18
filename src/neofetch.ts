import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";

const NEOFETCH_STATE = path.join(process.env.HOME ?? "~", ".fsh_neofetch");

export function isNeofetchEnabled(): boolean {
  try {
    return fs.readFileSync(NEOFETCH_STATE, "utf8").trim() === "on";
  } catch {
    return false;
  }
}

export function setNeofetchState(state: "on" | "off") {
  fs.writeFileSync(NEOFETCH_STATE, state, "utf8");
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

function getOS(): string {
  try {
    const pretty = run("grep PRETTY_NAME /etc/os-release");
    const match = pretty.match(/PRETTY_NAME="(.+)"/);
    if (match) return match[1];
  } catch {}
  return os.type();
}

function getKernel(): string {
  return run("uname -r");
}

function getCPU(): string {
  const raw = run("grep -m1 'model name' /proc/cpuinfo");
  const match = raw.match(/model name\s*:\s*(.+)/);
  if (match) {
    return match[1]
      .replace(/\(R\)|\(TM\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return os.cpus()[0]?.model ?? "unknown";
}

function getRAM(): string {
  try {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const toMB = (b: number) => Math.round(b / 1024 / 1024);
    return `${toMB(used)} MB / ${toMB(total)} MB`;
  } catch {
    return "unknown";
  }
}

function getUptime(): string {
  const secs = os.uptime();
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getIP(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    if (name.startsWith("lo")) continue;
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4") return iface.address;
    }
  }
  return "unknown";
}

function getDisk(): string {
  const raw = run("df -h / | tail -1");
  const parts = raw.split(/\s+/);
  if (parts.length >= 5) {
    return `${parts[2]} used / ${parts[1]} total (${parts[4]})`;
  }
  return "unknown";
}

function getShellVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return `fsh v${pkg.version}`;
  } catch {}
  return "fsh";
}

const FSH_LOGO = [
  "                           ",
  "                           ",
  "  ███████╗███████╗██╗  ██╗ ",
  "  ██╔════╝██╔════╝██║  ██║ ",
  "  █████╗  ███████╗███████║ ",
  "  ██╔══╝  ╚════██║██╔══██║ ",
  "  ██║     ███████║██║  ██║ ",
  "  ╚═╝     ╚══════╝╚═╝  ╚═╝ ",
  "                           ",
  "                           ",
  "                           ",
  "                           ",
  "                           ",
];

function colorRow(): string {
  return [
    chalk.bgBlack("   "),
    chalk.bgRed("   "),
    chalk.bgGreen("   "),
    chalk.bgYellow("   "),
    chalk.bgBlue("   "),
    chalk.bgMagenta("   "),
    chalk.bgCyan("   "),
    chalk.bgWhite("   "),
  ].join("");
}

export function printNeofetch() {
  const user = process.env.USER ?? os.userInfo().username;
  const host = os.hostname();

  const logo = FSH_LOGO.map((l, i) =>
    (i >= 2 && i <= 7) ? chalk.cyan(l) : chalk.dim(l)
  );

  const c = (s: string) => chalk.cyan.bold(s);
  const g = (s: string) => chalk.gray(s);
  const w = (s: string) => chalk.white(s);
  const label = (s: string) => chalk.cyan(s.padEnd(7));
  const sep = chalk.dim("─".repeat(38));

  const info: string[] = [

    `  ${c(user)}${g("@")}${c(host)}`,
    `  ${sep}`,

    `  ${label("OS")} ${w(getOS())}`,
    `  ${label("Kernel")} ${w(getKernel())}`,
    `  ${sep}`,

    `  ${label("CPU")} ${w(getCPU())}`,
    `  ${label("RAM")} ${w(getRAM())}`,
    `  ${label("Disk")} ${w(getDisk())}`,
    `  ${sep}`,

    `  ${label("Shell")} ${w(getShellVersion())}`,
    `  ${label("Uptime")} ${w(getUptime())}`,
    `  ${label("IP")} ${w(getIP())}`,

    `  ${sep}`,
    `  ${colorRow()}`,
    `  ${g("by Farell Kurniawan · github.com/FKfarell17108")}`,
  ];

  const height = Math.max(logo.length, info.length);
  while (logo.length < height) logo.push(" ".repeat(27));
  while (info.length < height) info.push("");

  console.log();
  for (let i = 0; i < height; i++) {
    console.log(`${logo[i]}  ${info[i]}`);
  }
  console.log();
}