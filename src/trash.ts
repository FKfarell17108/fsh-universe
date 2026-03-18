import fs from "fs";
import path from "path";

export const TRASH_DIR = path.join(process.env.HOME ?? "~", ".fsh_trash");
export const TRASH_META = path.join(TRASH_DIR, ".meta.json");

export type TrashEntry = {
  id: string;          
  name: string;        
  originalPath: string; 
  trashedAt: number;   
  isDir: boolean;
};

export function ensureTrashDir() {
  if (!fs.existsSync(TRASH_DIR)) {
    fs.mkdirSync(TRASH_DIR, { recursive: true });
  }
}

export function loadMeta(): TrashEntry[] {
  try {
    return JSON.parse(fs.readFileSync(TRASH_META, "utf8"));
  } catch {
    return [];
  }
}

export function saveMeta(entries: TrashEntry[]) {
  fs.writeFileSync(TRASH_META, JSON.stringify(entries, null, 2), "utf8");
}

export function moveToTrash(fullPath: string): TrashEntry {
  ensureTrashDir();

  const name = path.basename(fullPath);
  const isDir = fs.statSync(fullPath).isDirectory();
  const id = `${Date.now()}_${name}`;
  const dest = path.join(TRASH_DIR, id);

  fs.renameSync(fullPath, dest);

  const entry: TrashEntry = {
    id,
    name,
    originalPath: fullPath,
    trashedAt: Date.now(),
    isDir,
  };

  const meta = loadMeta();
  meta.unshift(entry);
  saveMeta(meta);

  return entry;
}

export function restoreFromTrash(entry: TrashEntry): string | null {
  const src = path.join(TRASH_DIR, entry.id);

  if (!fs.existsSync(src)) return "File not found in trash";

  let dest = entry.originalPath;
  if (fs.existsSync(dest)) {
    const ext = path.extname(dest);
    const base = dest.slice(0, dest.length - ext.length);
    dest = `${base}(restored)${ext}`;
  }

  try {
    fs.renameSync(src, dest);
    const meta = loadMeta().filter((e) => e.id !== entry.id);
    saveMeta(meta);
    return null;
  } catch (err: any) {
    return err.message;
  }
}

export function deleteFromTrash(entry: TrashEntry): string | null {
  const src = path.join(TRASH_DIR, entry.id);
  try {
    if (fs.existsSync(src)) {
      fs.rmSync(src, { recursive: true, force: true });
    }
    const meta = loadMeta().filter((e) => e.id !== entry.id);
    saveMeta(meta);
    return null;
  } catch (err: any) {
    return err.message;
  }
}

export function deleteAllFromTrash(): string | null {
  try {
    const meta = loadMeta();
    for (const entry of meta) {
      const src = path.join(TRASH_DIR, entry.id);
      if (fs.existsSync(src)) fs.rmSync(src, { recursive: true, force: true });
    }
    saveMeta([]);
    return null;
  } catch (err: any) {
    return err.message;
  }
}