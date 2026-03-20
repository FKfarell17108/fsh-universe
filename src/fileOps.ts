import fs from "fs";
import path from "path";
import os from "os";

export type OpKind = "copy" | "cut" | "rename" | "move";

export type FileOp = {
  id:        string;
  kind:      OpKind;
  srcPath:   string;
  srcName:   string;
  destPath:  string;
  destName:  string;
  isDir:     boolean;
  timestamp: number;
  status:    "pending" | "done" | "error";
  error?:    string;
};

export type Clipboard = {
  kind:    "copy" | "cut";
  srcPath: string;
  srcName: string;
  isDir:   boolean;
} | null;

const LOG_FILE = path.join(os.homedir(), ".fsh_fileops.json");

let clipboard: Clipboard = null;
let opLog: FileOp[]      = [];

export function loadLog(): void {
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf8");
    opLog = JSON.parse(raw);
  } catch {
    opLog = [];
  }
}

function saveLog(): void {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(opLog, null, 2), "utf8");
  } catch {}
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function getClipboard(): Clipboard {
  return clipboard;
}

export function setClipboard(c: Clipboard): void {
  clipboard = c;
}

export function clearClipboard(): void {
  clipboard = null;
}

export function getLog(): FileOp[] {
  return opLog;
}

function pushOp(op: FileOp): void {
  opLog.unshift(op);
  if (opLog.length > 200) opLog = opLog.slice(0, 200);
  saveLog();
}

export function execCopy(srcFull: string, destFull: string): string | null {
  const srcName  = path.basename(srcFull);
  const destName = path.basename(destFull);
  const isDir    = fs.statSync(srcFull).isDirectory();
  const op: FileOp = {
    id:        makeId(),
    kind:      "copy",
    srcPath:   srcFull,
    srcName,
    destPath:  destFull,
    destName,
    isDir,
    timestamp: Date.now(),
    status:    "pending",
  };

  try {
    copyRecursive(srcFull, destFull);
    op.status = "done";
    pushOp(op);
    return null;
  } catch (e: any) {
    op.status = "error";
    op.error  = e.message;
    pushOp(op);
    return e.message;
  }
}

export function execMove(srcFull: string, destFull: string): string | null {
  const srcName  = path.basename(srcFull);
  const destName = path.basename(destFull);
  const isDir    = fs.statSync(srcFull).isDirectory();
  const op: FileOp = {
    id:        makeId(),
    kind:      "move",
    srcPath:   srcFull,
    srcName,
    destPath:  destFull,
    destName,
    isDir,
    timestamp: Date.now(),
    status:    "pending",
  };

  try {
    fs.renameSync(srcFull, destFull);
    op.status = "done";
    pushOp(op);
    return null;
  } catch (e: any) {
    try {
      copyRecursive(srcFull, destFull);
      fs.rmSync(srcFull, { recursive: true, force: true });
      op.status = "done";
      pushOp(op);
      return null;
    } catch (e2: any) {
      op.status = "error";
      op.error  = e2.message;
      pushOp(op);
      return e2.message;
    }
  }
}

export function execRename(srcFull: string, newName: string): string | null {
  const destFull = path.join(path.dirname(srcFull), newName);
  const srcName  = path.basename(srcFull);
  let isDir      = false;
  try { isDir = fs.statSync(srcFull).isDirectory(); } catch {}

  const op: FileOp = {
    id:        makeId(),
    kind:      "rename",
    srcPath:   srcFull,
    srcName,
    destPath:  destFull,
    destName:  newName,
    isDir,
    timestamp: Date.now(),
    status:    "pending",
  };

  try {
    fs.renameSync(srcFull, destFull);
    op.status = "done";
    pushOp(op);
    return null;
  } catch (e: any) {
    op.status = "error";
    op.error  = e.message;
    pushOp(op);
    return e.message;
  }
}

function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

export function uniqueDest(destDir: string, name: string): string {
  const ext  = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(destDir, name);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${base} (${i})${ext}`);
    i++;
  }
  return candidate;
}