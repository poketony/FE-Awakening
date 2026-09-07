import { emptyProgress, parseProgress, mergeProgress, setReviewStatus, serializeProgress } from "./review-progress-core.js";

export const SYNC_DB = "fe13-review-sync";
export const SYNC_STORE = "settings";
export const HANDLE_KEY = "reviewProgressFile";
export const LOCAL_SHARED_KEY = "fe13-live:sharedProgress:v2";
export const TOKEN_KEY = "fe13-live:reviewSyncToken:v1";
export const MAIN_PREFIX = "Awakening/Messages (K)/";
export const DLC_PREFIX = "Awakening/DLC Message (K)/";
export const REVIEW_STATE_BRANCH = "review-state";
export const REVIEW_LEGACY_PATH = "Awakening/review-progress.json";
export const REVIEW_PC_PATH = "Awakening/review-progress-pc.json";
export const REVIEW_MOBILE_PATH = "Awakening/review-progress-mobile.json";

let dbPromise;

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

function legacyProgress() {
  const imported = emptyProgress();
  const oldAt = "2000-01-01T00:00:00.000Z";
  for (const profile of ["main", "dlc"]) {
    let map = {};
    try { map = JSON.parse(localStorage.getItem(`fe13-live:reviewStatuses:${profile}`) || "{}"); } catch { map = {}; }
    for (const [id, status] of Object.entries(map)) {
      const split = id.indexOf("\u0000");
      if (split < 0 || status === "unreviewed") continue;
      const relativePath = id.slice(0, split);
      const entryKey = id.slice(split + 1);
      if (!relativePath || !entryKey) continue;
      setReviewStatus(imported, {
        path: canonicalPath(profile, relativePath),
        entryKey,
        status,
        at: oldAt,
      });
    }
  }
  return imported;
}

async function readOldTrackedFileOnce() {
  if (!window.indexedDB) return emptyProgress();
  try {
    const handle = await readSyncSetting(HANDLE_KEY);
    if (!handle) return emptyProgress();
    let permission = "prompt";
    try { permission = await handle.queryPermission({ mode: "read" }); } catch { permission = "prompt"; }
    if (permission !== "granted") return emptyProgress();
    const file = await handle.getFile();
    return parseProgress(await file.text());
  } catch {
    return emptyProgress();
  }
}

function rawUrl(path) {
  return `https://raw.githubusercontent.com/poketony/FE-Awakening/${REVIEW_STATE_BRANCH}/${path}`;
}

async function readRemoteProgress(path) {
  try {
    const response = await fetch(`${rawUrl(path)}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return emptyProgress();
    return parseProgress(await response.text());
  } catch {
    return emptyProgress();
  }
}

async function readRemoteUnion() {
  const [legacy, pc, mobile] = await Promise.all([
    readRemoteProgress(REVIEW_LEGACY_PATH),
    readRemoteProgress(REVIEW_PC_PATH),
    readRemoteProgress(REVIEW_MOBILE_PATH),
  ]);
  return mergeProgress(mergeProgress(legacy, pc), mobile);
}

export async function preloadReviewSync() {
  // main 워킹트리의 review-progress.json은 더 이상 쓰지 않는다.
  // review-state 브랜치의 PC/모바일 전용 파일을 합쳐 읽고, 옛 단일 파일은
  // 기존 검수 기록을 잃지 않기 위한 읽기 전용 마이그레이션 원본으로만 사용한다.
  const localBefore = parseProgress(localStorage.getItem(LOCAL_SHARED_KEY));
  const [remote, oldTracked] = await Promise.all([readRemoteUnion(), readOldTrackedFileOnce()]);
  let merged = mergeProgress(remote, oldTracked);
  merged = mergeProgress(merged, localBefore);
  merged = mergeProgress(legacyProgress(), merged);
  localStorage.setItem(LOCAL_SHARED_KEY, serializeProgress(merged));
  mirrorSharedToLegacyLocalStorage(merged);
}
