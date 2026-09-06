import { emptyProgress, parseProgress } from "./review-progress-core.js";

export const SYNC_DB = "fe13-review-sync";
export const SYNC_STORE = "settings";
export const HANDLE_KEY = "reviewProgressFile";
export const LOCAL_SHARED_KEY = "fe13-live:sharedProgress:v2";
export const MAIN_PREFIX = "Awakening/Messages (K)/";
export const DLC_PREFIX = "Awakening/DLC Message (K)/";

let dbPromise;
let progressWriteFilterInstalled = false;

function entrySnapshot(value) {
  const progress = parseProgress(value);
  return JSON.stringify(Object.keys(progress.entries || {}).sort().map((key) => [key, progress.entries[key]]));
}

export function installProgressWriteFilter() {
  if (progressWriteFilterInstalled) return;
  const prototype = globalThis.FileSystemFileHandle?.prototype;
  const original = prototype?.createWritable;
  if (!prototype || typeof original !== "function") return;

  const wrapped = async function filteredCreateWritable(...createArgs) {
    if (this.name !== "review-progress.json") return original.apply(this, createArgs);
    const handle = this;
    const operations = [];
    let aborted = false;
    return {
      async write(data) { if (!aborted) operations.push({ type: "write", data }); },
      async seek(position) { if (!aborted) operations.push({ type: "seek", position }); },
      async truncate(size) { if (!aborted) operations.push({ type: "truncate", size }); },
      async abort() { aborted = true; operations.length = 0; },
      async close() {
        if (aborted || !operations.length) return;
        const single = operations.length === 1 && operations[0].type === "write" && typeof operations[0].data === "string";
        if (single) {
          try {
            const before = await (await handle.getFile()).text();
            const after = operations[0].data;
            // files/expected 같은 인벤토리 메타데이터만 달라졌다면 실제 파일은 건드리지 않는다.
            // 실제 MID 검수 상태(entries)가 바뀐 경우에만 review-progress.json을 기록한다.
            if (entrySnapshot(before) === entrySnapshot(after)) return;
          } catch {
            // 비교에 실패하면 데이터 손실 방지를 위해 원래 쓰기를 수행한다.
          }
        }
        const writable = await original.apply(handle, createArgs);
        for (const operation of operations) {
          if (operation.type === "write") await writable.write(operation.data);
          else if (operation.type === "seek") await writable.seek(operation.position);
          else if (operation.type === "truncate") await writable.truncate(operation.size);
        }
        await writable.close();
      },
    };
  };

  try {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "createWritable");
    Object.defineProperty(prototype, "createWritable", { ...descriptor, value: wrapped });
    progressWriteFilterInstalled = true;
  } catch {
    try {
      prototype.createWritable = wrapped;
      progressWriteFilterInstalled = true;
    } catch {
      // 브라우저 구현상 프로토타입 패치가 불가능하면 기존 동작을 유지한다.
    }
  }
}

export function openSyncDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SYNC_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SYNC_STORE)) request.result.createObjectStore(SYNC_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

export async function readSyncSetting(key) {
  const db = await openSyncDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SYNC_STORE, "readonly").objectStore(SYNC_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function writeSyncSetting(key, value) {
  const db = await openSyncDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_STORE, "readwrite");
    transaction.objectStore(SYNC_STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function normalizeRelativePath(path) {
  return String(path || "").replaceAll("\\", "/").replace(/^\.\//u, "").toLocaleLowerCase();
}

export function canonicalPath(profile, relativePath) {
  return `${profile === "dlc" ? DLC_PREFIX : MAIN_PREFIX}${String(relativePath || "").replaceAll("\\", "/").replace(/^\.\//u, "")}`;
}

function splitSharedPath(path) {
  const lower = String(path || "").toLocaleLowerCase();
  if (lower.startsWith(MAIN_PREFIX.toLocaleLowerCase())) {
    return { profile: "main", relativePath: String(path).slice(MAIN_PREFIX.length) };
  }
  if (lower.startsWith(DLC_PREFIX.toLocaleLowerCase())) {
    return { profile: "dlc", relativePath: String(path).slice(DLC_PREFIX.length) };
  }
  return null;
}

export function mirrorSharedToLegacyLocalStorage(progress) {
  const parsed = parseProgress(progress);
  const maps = {};
  for (const profile of ["main", "dlc"]) {
    try { maps[profile] = JSON.parse(localStorage.getItem(`fe13-live:reviewStatuses:${profile}`) || "{}"); }
    catch { maps[profile] = {}; }
  }
  for (const entry of Object.values(parsed.entries)) {
    const location = splitSharedPath(entry.path);
    if (!location) continue;
    const id = `${normalizeRelativePath(location.relativePath)}\u0000${entry.entryKey}`;
    if (entry.status === "unreviewed") delete maps[location.profile][id];
    else maps[location.profile][id] = entry.status;
  }
  for (const profile of ["main", "dlc"]) {
    localStorage.setItem(`fe13-live:reviewStatuses:${profile}`, JSON.stringify(maps[profile]));
  }
}

export async function readProgressHandle() {
  if (!window.indexedDB) return null;
  try { return await readSyncSetting(HANDLE_KEY); } catch { return null; }
}

export async function readProgressFromHandle(handle) {
  if (!handle) return emptyProgress();
  const file = await handle.getFile();
  return parseProgress(await file.text());
}

export async function preloadReviewSync() {
  installProgressWriteFilter();
  if (!window.indexedDB) return;
  const handle = await readProgressHandle();
  if (!handle) return;
  try {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") return;
    const progress = await readProgressFromHandle(handle);
    mirrorSharedToLegacyLocalStorage(progress);
    localStorage.setItem(LOCAL_SHARED_KEY, JSON.stringify(progress));
  } catch {
    // 공용 기록이 없어도 라이브 렌더러 본체는 정상 실행되어야 한다.
  }
}

installProgressWriteFilter();
