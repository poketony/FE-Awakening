import {
  emptyProgress, parseProgress, mergeProgress, registerFile, setReviewStatus,
  completedToday, progressMessage, serializeProgress,
} from "./review-progress-core.js";
import { isReviewProgressEntry, normalizePath } from "./format.js";
import {
  HANDLE_KEY, LOCAL_SHARED_KEY, MAIN_PREFIX, DLC_PREFIX,
  canonicalPath, mirrorSharedToLegacyLocalStorage, readProgressHandle,
  readProgressFromHandle, writeSyncSetting,
} from "./review-sync-preload.js";

const $ = (selector) => document.querySelector(selector);
const els = {
  toolbar: $(".toolbar"), profileMain: $("#profileMain"), profileDlc: $("#profileDlc"),
  currentFileName: $("#currentFileName"), fileList: $("#fileList"), entryList: $("#entryList"),
  entryKey: $("#entryKey"), entrySearch: $("#entrySearch"), reviewFilter: $("#reviewFilter"), reviewStatus: $("#reviewStatus"),
  dirtyMark: $("#dirtyMark"), toast: $("#toast"), statusText: $("#statusText"),
  reviewProgress: $("#reviewProgress"), progressPercent: $("#progressPercent"), progressFill: $("#progressFill"),
  progressDetail: $("#progressDetail"), progressFiles: $("#progressFiles"), progressCheer: $("#progressCheer"),
};

let sharedProgress = parseProgress(localStorage.getItem(LOCAL_SHARED_KEY));
let syncHandle = null;
let syncBusy = false;
let progressUiGuard = false;
let inventoryTimer = 0;

function profile() {
  return els.profileDlc?.classList.contains("active") ? "dlc" : "main";
}

function profilePrefix(mode = profile()) {
  return mode === "dlc" ? DLC_PREFIX : MAIN_PREFIX;
}

function currentRelativePath() {
  const activeSub = els.fileList?.querySelector(".list-item.active .sub")?.textContent?.trim() || "";
  if (activeSub) {
    const parts = activeSub.split(" · ");
    return parts.at(-1)?.trim() || "";
  }
  const name = els.currentFileName?.textContent?.trim() || "";
  return name && name !== "메시지 항목" ? name : "";
}

function currentCanonicalPath() {
  const relative = currentRelativePath();
  return relative ? canonicalPath(profile(), relative) : "";
}

function relativeFromCanonical(path, mode) {
  const prefix = profilePrefix(mode);
  return String(path || "").toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? String(path).slice(prefix.length)
    : "";
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function setStatus(message) {
  if (els.statusText) els.statusText.textContent = message;
}

function persistShared() {
  localStorage.setItem(LOCAL_SHARED_KEY, serializeProgress(sharedProgress));
}

function legacyProgress() {
  const imported = emptyProgress();
  const oldAt = "2000-01-01T00:00:00.000Z";
  for (const mode of ["main", "dlc"]) {
    let map = {};
    try { map = JSON.parse(localStorage.getItem(`fe13-live:reviewStatuses:${mode}`) || "{}"); } catch { map = {}; }
    for (const [id, status] of Object.entries(map)) {
      const split = id.indexOf("\u0000");
      if (split < 0) continue;
      const relativePath = id.slice(0, split);
      const entryKey = id.slice(split + 1);
      if (!relativePath || !entryKey || status === "unreviewed") continue;
      setReviewStatus(imported, {
        path: canonicalPath(mode, relativePath),
        entryKey,
        status,
        at: oldAt,
      });
    }
  }
  return imported;
}

function installSyncUi() {
  if (!els.toolbar || $("#reviewSyncButton")) return;
  const button = document.createElement("button");
  button.id = "reviewSyncButton";
  button.type = "button";
  button.textContent = "검수 기록 연결";
  button.title = "Awakening/review-progress.json 연결 및 새로고침";
  const state = document.createElement("span");
  state.id = "reviewSyncState";
  state.className = "review-sync-state";
  state.textContent = "공용 기록 미연결";
  els.toolbar.append(button, state);
  button.addEventListener("click", handleSyncButton);
  if (!$("#reviewSyncStyle")) {
    const style = document.createElement("style");
    style.id = "reviewSyncStyle";
    style.textContent = `.review-sync-state{font-size:.72rem;color:var(--muted,#aaa);align-self:center;white-space:nowrap}`;
    document.head.append(style);
  }
}

function syncButton() { return $("#reviewSyncButton"); }
function syncState() { return $("#reviewSyncState"); }

async function updateSyncUi() {
  installSyncUi();
  const button = syncButton();
  const state = syncState();
  if (!button || !state) return;
  syncHandle ||= await readProgressHandle();
  if (!syncHandle) {
    button.textContent = "검수 기록 연결";
    state.textContent = "공용 기록 미연결";
    return;
  }
  let permission = "prompt";
  try { permission = await syncHandle.queryPermission({ mode: "readwrite" }); } catch { permission = "prompt"; }
  button.textContent = permission === "granted" ? "검수 기록 새로고침" : "검수 기록 권한";
  state.textContent = permission === "granted" ? `연결됨 · ${syncHandle.name}` : `${syncHandle.name} · 권한 필요`;
}

async function writeProgressToHandle(handle, progress) {
  const writable = await handle.createWritable();
  await writable.write(serializeProgress(progress));
  await writable.close();
}

function registerCurrentInventory() {
  const path = currentCanonicalPath();
  if (!path || !els.entryList) return false;
  if (els.entrySearch?.value.trim() || els.reviewFilter?.value !== "all") return false;
  const keys = [...els.entryList.querySelectorAll(".list-item:not(.review-excluded) .title")]
    .map((node) => node.textContent.trim())
    .filter((key) => key && isReviewProgressEntry(key));
  if (!keys.length) return false;
  return registerFile(sharedProgress, { path, mode: profile(), expected: keys });
}

function scheduleInventorySync() {
  clearTimeout(inventoryTimer);
  inventoryTimer = setTimeout(async () => {
    if (!registerCurrentInventory()) return;
    persistShared();
    await flushSharedToDisk({ quiet: true });
  }, 180);
}

function legacyStatusFor(path, entryKey, mode = profile()) {
  const relative = relativeFromCanonical(path, mode);
  if (!relative) return "unreviewed";
  let map = {};
  try { map = JSON.parse(localStorage.getItem(`fe13-live:reviewStatuses:${mode}`) || "{}"); } catch { map = {}; }
  return map[`${normalizePath(relative)}\u0000${entryKey}`] || "unreviewed";
}

async function captureStatus(path, entryKey, mode) {
  if (!path || !entryKey || !isReviewProgressEntry(entryKey)) return;
  const status = legacyStatusFor(path, entryKey, mode);
  const changed = setReviewStatus(sharedProgress, { path, entryKey, status });
  const inventoryChanged = registerCurrentInventory();
  if (!changed && !inventoryChanged) return;
  persistShared();
  harmonizeProgressUi();
  await flushSharedToDisk({ quiet: true });
}

async function flushSharedToDisk({ quiet = false } = {}) {
  if (syncBusy) return;
  syncHandle ||= await readProgressHandle();
  if (!syncHandle) return;
  let permission;
  try { permission = await syncHandle.queryPermission({ mode: "readwrite" }); } catch { return; }
  if (permission !== "granted") {
    await updateSyncUi();
    return;
  }
  syncBusy = true;
  try {
    const disk = await readProgressFromHandle(syncHandle);
    const merged = mergeProgress(disk, sharedProgress);
    const changed = serializeProgress(merged) !== serializeProgress(disk);
    sharedProgress = merged;
    persistShared();
    if (changed) await writeProgressToHandle(syncHandle, sharedProgress);
    if (!quiet && changed) showToast("공용 검수 기록을 저장했습니다.");
    await updateSyncUi();
  } catch (error) {
    if (!quiet) showToast(`검수 기록 저장 실패: ${error.message}`);
  } finally {
    syncBusy = false;
  }
}

async function connectProgressFile() {
  if (!window.showOpenFilePicker) {
    showToast("공용 검수 기록 연결은 최신 Edge/Chrome의 localhost 실행이 필요합니다.");
    return;
  }
  if (els.dirtyMark?.classList.contains("on")) {
    showToast("번역 파일을 먼저 저장한 뒤 검수 기록을 연결하세요.");
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "FE 검수 진행 기록", accept: { "application/json": [".json"] } }],
    });
    if (handle.name !== "review-progress.json" && !window.confirm(`${handle.name} 파일을 공용 검수 기록으로 연결할까요?\n권장 파일명은 review-progress.json입니다.`)) return;
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("파일 쓰기 권한이 허용되지 않았습니다.");
    await writeSyncSetting(HANDLE_KEY, handle);
    syncHandle = handle;
    const disk = await readProgressFromHandle(handle);
    sharedProgress = mergeProgress(disk, mergeProgress(legacyProgress(), sharedProgress));
    registerCurrentInventory();
    await writeProgressToHandle(handle, sharedProgress);
    persistShared();
    mirrorSharedToLegacyLocalStorage(sharedProgress);
    showToast("공용 검수 기록을 연결했습니다. 상태를 다시 불러옵니다.");
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    if (error.name !== "AbortError") showToast(`검수 기록을 연결하지 못했습니다: ${error.message}`);
  }
}

async function refreshFromDisk({ userInitiated = false } = {}) {
  syncHandle ||= await readProgressHandle();
  if (!syncHandle) {
    if (userInitiated) await connectProgressFile();
    return;
  }
  let permission = await syncHandle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted" && userInitiated) permission = await syncHandle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    await updateSyncUi();
    return;
  }
  try {
    const before = serializeProgress(sharedProgress);
    const disk = await readProgressFromHandle(syncHandle);
    sharedProgress = mergeProgress(sharedProgress, disk);
    sharedProgress = mergeProgress(sharedProgress, legacyProgress());
    registerCurrentInventory();
    persistShared();
    const after = serializeProgress(sharedProgress);
    mirrorSharedToLegacyLocalStorage(sharedProgress);
    await flushSharedToDisk({ quiet: true });
    await updateSyncUi();
    if (after !== before) {
      if (els.dirtyMark?.classList.contains("on")) {
        showToast("외부 검수 기록 변경을 감지했습니다. 번역 저장 후 새로고침하세요.");
      } else {
        showToast("공용 검수 기록을 갱신했습니다.");
        setTimeout(() => location.reload(), 500);
      }
    } else if (userInitiated) showToast("공용 검수 기록이 최신입니다.");
  } catch (error) {
    if (userInitiated) showToast(`검수 기록 새로고침 실패: ${error.message}`);
  }
}

async function handleSyncButton() {
  syncHandle ||= await readProgressHandle();
  if (!syncHandle) await connectProgressFile();
  else await refreshFromDisk({ userInitiated: true });
}

function parseFraction(text) {
  const match = String(text || "").match(/([\d,]+)\s*\/\s*([\d,]+)/u);
  if (!match) return null;
  return [Number(match[1].replaceAll(",", "")), Number(match[2].replaceAll(",", ""))];
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function percentLabel(value) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function harmonizeProgressUi() {
  if (progressUiGuard || !els.progressFiles || !els.progressDetail) return;
  const fileFraction = parseFraction(els.progressFiles.textContent);
  const entryFraction = parseFraction(els.progressDetail.textContent);
  if (!fileFraction || !entryFraction) return;
  const [completeFiles, totalFiles] = fileFraction;
  const [approvedEntries, totalEntries] = entryFraction;
  if (!totalFiles) return;
  const filePercent = percent(completeFiles, totalFiles);
  const entryPercent = percent(approvedEntries, totalEntries);
  const visibleProgress = [...(els.fileList?.querySelectorAll(".list-item") || [])]
    .filter((item) => !item.classList.contains("file-reviewed") && /\d+\/\d+|!|…/u.test(item.querySelector(".file-review-summary")?.textContent || "")).length;
  const summary = {
    percent: filePercent,
    complete: completeFiles,
    total: totalFiles,
    remaining: Math.max(0, totalFiles - completeFiles),
    inProgress: visibleProgress || (approvedEntries && completeFiles < totalFiles ? 1 : 0),
  };
  const today = completedToday(sharedProgress);
  progressUiGuard = true;
  try {
    const nextPercent = percentLabel(filePercent);
    if (els.progressPercent.textContent !== nextPercent) els.progressPercent.textContent = nextPercent;
    const nextWidth = `${Math.max(0, Math.min(100, filePercent))}%`;
    if (els.progressFill.style.width !== nextWidth) els.progressFill.style.width = nextWidth;
    const nextFiles = `검수 완료 파일 ${completeFiles} / ${totalFiles}`;
    if (els.progressFiles.textContent !== nextFiles) els.progressFiles.textContent = nextFiles;
    const nextDetail = `단계 기준 ${percentLabel(entryPercent)} · ${approvedEntries.toLocaleString()} / ${totalEntries.toLocaleString()}개 확인 완료 · 오늘 +${today}단계`;
    if (els.progressDetail.textContent !== nextDetail) els.progressDetail.textContent = nextDetail;
    const nextCheer = progressMessage(summary);
    if (els.progressCheer.textContent !== nextCheer) els.progressCheer.textContent = nextCheer;
    els.reviewProgress?.classList.toggle("complete", filePercent >= 100);
  } finally {
    progressUiGuard = false;
  }
}

sharedProgress = mergeProgress(legacyProgress(), sharedProgress);
persistShared();
installSyncUi();
void updateSyncUi();
harmonizeProgressUi();
scheduleInventorySync();

els.reviewStatus?.addEventListener("change", () => {
  const path = currentCanonicalPath();
  const key = els.entryKey?.textContent?.trim() || "";
  const mode = profile();
  queueMicrotask(() => captureStatus(path, key, mode));
});

window.addEventListener("keydown", (event) => {
  const approve = (event.ctrlKey || event.metaKey) && !event.altKey && event.key === "Enter";
  const f3 = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === "F3";
  const f2 = !event.ctrlKey && !event.metaKey && !event.altKey && event.key === "F2";
  if (!approve && !f3 && !f2) return;
  const path = currentCanonicalPath();
  const key = els.entryKey?.textContent?.trim() || "";
  const mode = profile();
  if (!path || !isReviewProgressEntry(key)) return;
  setTimeout(() => captureStatus(path, key, mode), 0);
}, true);

const inventoryObserver = new MutationObserver(() => scheduleInventorySync());
if (els.entryList) inventoryObserver.observe(els.entryList, { childList: true, subtree: true });
if (els.currentFileName) inventoryObserver.observe(els.currentFileName, { childList: true, characterData: true, subtree: true });
els.entrySearch?.addEventListener("input", scheduleInventorySync);
els.reviewFilter?.addEventListener("change", scheduleInventorySync);

const progressObserver = new MutationObserver(() => {
  if (!progressUiGuard) queueMicrotask(harmonizeProgressUi);
});
if (els.reviewProgress) progressObserver.observe(els.reviewProgress, { childList: true, characterData: true, subtree: true });

window.addEventListener("focus", () => { void refreshFromDisk({ userInitiated: false }); });
