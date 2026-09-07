import {
  emptyProgress, parseProgress, mergeProgress, registerFile, setReviewStatus,
  completedToday, progressMessage, serializeProgress,
} from "./review-progress-core.js";
import { isReviewProgressEntry, normalizePath } from "./format.js";
import {
  LOCAL_SHARED_KEY, TOKEN_KEY, MAIN_PREFIX, DLC_PREFIX, REVIEW_STATE_BRANCH,
  REVIEW_LEGACY_PATH, REVIEW_PC_PATH, REVIEW_MOBILE_PATH,
  canonicalPath, mirrorSharedToLegacyLocalStorage,
} from "./review-sync-preload.js";

const OWNER = "poketony";
const REPO = "FE-Awakening";
const API = "https://api.github.com";
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
let syncBusy = false;
let pushTimer = 0;
let inventoryTimer = 0;
let progressUiGuard = false;
let remoteSignature = "";

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

function persistShared() {
  localStorage.setItem(LOCAL_SHARED_KEY, serializeProgress(sharedProgress));
}

function token() {
  return String(localStorage.getItem(TOKEN_KEY) || "").trim();
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder("utf-8").decode(bytes);
}

async function apiRequest(path, options = {}, { allowConflict = false } = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  const pat = token();
  if (pat) headers.set("Authorization", `Bearer ${pat}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API}${path}`, { ...options, headers, cache: "no-store" });
  if (allowConflict && [409, 422].includes(response.status)) return { conflict: true };
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json())?.message || ""; } catch { detail = await response.text(); }
    throw new Error(`GitHub API ${response.status}: ${detail || response.statusText}`);
  }
  return response.status === 204 ? null : response.json();
}

function encodedPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function fetchProgressFile(path) {
  const endpoint = `/repos/${OWNER}/${REPO}/contents/${encodedPath(path)}?ref=${encodeURIComponent(REVIEW_STATE_BRANCH)}&t=${Date.now()}`;
  const data = await apiRequest(endpoint);
  const text = data?.content ? decodeBase64Utf8(data.content) : serializeProgress(emptyProgress());
  return { progress: parseProgress(text), sha: data?.sha || null, text };
}

async function fetchRemoteProgress() {
  const [legacy, pc, mobile] = await Promise.all([
    fetchProgressFile(REVIEW_LEGACY_PATH),
    fetchProgressFile(REVIEW_PC_PATH),
    fetchProgressFile(REVIEW_MOBILE_PATH),
  ]);
  const progress = mergeProgress(mergeProgress(legacy.progress, pc.progress), mobile.progress);
  return { progress, pcProgress: pc.progress, pcSha: pc.sha };
}

async function pushMergedProgress({ quiet = false } = {}) {
  if (syncBusy || !token()) {
    updateSyncUi();
    return false;
  }
  syncBusy = true;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const remote = await fetchRemoteProgress();
      const merged = mergeProgress(remote.progress, sharedProgress);
      const mergedText = serializeProgress(merged);
      const pcSnapshot = mergeProgress(remote.pcProgress, merged);
      const pcText = serializeProgress(pcSnapshot);
      sharedProgress = merged;
      persistShared();
      mirrorSharedToLegacyLocalStorage(sharedProgress);

      if (serializeProgress(remote.pcProgress) === pcText) {
        remoteSignature = mergedText;
        if (!quiet) showToast("공용 검수 기록이 최신입니다.");
        updateSyncUi();
        return false;
      }

      const endpoint = `/repos/${OWNER}/${REPO}/contents/${encodedPath(REVIEW_PC_PATH)}`;
      const result = await apiRequest(endpoint, {
        method: "PUT",
        body: JSON.stringify({
          message: `PC 검수 기록 동기화 ${new Date().toISOString().slice(0, 10)}`,
          content: utf8Base64(pcText),
          sha: remote.pcSha,
          branch: REVIEW_STATE_BRANCH,
        }),
      }, { allowConflict: true });
      if (result?.conflict) continue;
      remoteSignature = mergedText;
      if (!quiet) showToast("PC 검수 기록을 동기화했습니다.");
      updateSyncUi();
      return true;
    }
    throw new Error("PC 검수 파일이 다른 탭에서 계속 갱신 중입니다. 잠시 뒤 다시 시도하세요.");
  } catch (error) {
    if (!quiet) showToast(`검수 기록 동기화 실패: ${error.message}`);
    updateSyncUi(true);
    return false;
  } finally {
    syncBusy = false;
  }
}

async function pullRemoteProgress({ userInitiated = false } = {}) {
  if (syncBusy) return;
  syncBusy = true;
  try {
    const before = serializeProgress(sharedProgress);
    const remote = await fetchRemoteProgress();
    remoteSignature = serializeProgress(remote.progress);
    const mergedIncoming = mergeProgress(parseProgress(before), remote.progress);
    const incomingChanged = serializeProgress(mergedIncoming) !== before;
    sharedProgress = mergeProgress(remote.progress, sharedProgress);
    persistShared();
    mirrorSharedToLegacyLocalStorage(sharedProgress);
    const after = serializeProgress(sharedProgress);
    updateSyncUi();

    if (incomingChanged) {
      if (els.dirtyMark?.classList.contains("on")) {
        showToast("폰/PC 검수 기록 변경을 받았습니다. 번역 저장 후 새로고침하세요.");
      } else {
        showToast("공용 검수 기록을 갱신했습니다.");
        setTimeout(() => location.reload(), 450);
      }
    } else if (userInitiated) {
      showToast(after === remoteSignature ? "공용 검수 기록이 최신입니다." : "로컬 변경사항을 확인했습니다.");
    }
  } catch (error) {
    if (userInitiated) showToast(`검수 기록 불러오기 실패: ${error.message}`);
    updateSyncUi(true);
  } finally {
    syncBusy = false;
  }
}

function installSyncUi() {
  if (!els.toolbar || $("#reviewSyncButton")) return;
  const tokenInput = document.createElement("input");
  tokenInput.id = "reviewSyncToken";
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.placeholder = "검수 PAT";
  tokenInput.value = token();
  tokenInput.title = "FE-Awakening Contents 읽기/쓰기 Fine-grained PAT · 이 브라우저에만 저장";

  const button = document.createElement("button");
  button.id = "reviewSyncButton";
  button.type = "button";
  button.textContent = "검수 기록 동기화";

  const state = document.createElement("span");
  state.id = "reviewSyncState";
  state.className = "review-sync-state";

  els.toolbar.append(tokenInput, button, state);
  tokenInput.addEventListener("change", () => {
    const value = tokenInput.value.trim();
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    updateSyncUi();
  });
  button.addEventListener("click", async () => {
    const value = tokenInput.value.trim();
    if (value) localStorage.setItem(TOKEN_KEY, value);
    if (!token()) {
      showToast("PC에서도 처음 한 번만 검수 PAT를 입력하세요.");
      tokenInput.focus();
      return;
    }
    await pullRemoteProgress({ userInitiated: true });
    if (!syncBusy) await pushMergedProgress({ quiet: false });
  });

  if (!$("#reviewSyncStyle")) {
    const style = document.createElement("style");
    style.id = "reviewSyncStyle";
    style.textContent = `
      #reviewSyncToken{width:150px;min-width:110px;padding:.45rem .55rem}
      .review-sync-state{font-size:.72rem;color:var(--muted,#aaa);align-self:center;white-space:nowrap}
      @media(max-width:900px){#reviewSyncToken{width:120px}}
    `;
    document.head.append(style);
  }
  updateSyncUi();
}

function updateSyncUi(error = false) {
  const state = $("#reviewSyncState");
  const button = $("#reviewSyncButton");
  if (!state || !button) return;
  button.disabled = syncBusy;
  if (syncBusy) state.textContent = "GitHub 동기화 중…";
  else if (error) state.textContent = "동기화 오류 · 로컬 기록 보존됨";
  else if (token()) state.textContent = "PC 파일 쓰기 · PC+폰 합산";
  else state.textContent = "로컬 기록 · PAT 입력 필요";
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
  inventoryTimer = setTimeout(() => {
    if (!registerCurrentInventory()) return;
    persistShared();
  }, 180);
}

function legacyStatusFor(path, entryKey, mode = profile()) {
  const relative = relativeFromCanonical(path, mode);
  if (!relative) return "unreviewed";
  let map = {};
  try { map = JSON.parse(localStorage.getItem(`fe13-live:reviewStatuses:${mode}`) || "{}"); } catch { map = {}; }
  return map[`${normalizePath(relative)}\u0000${entryKey}`] || "unreviewed";
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void pushMergedProgress({ quiet: true }); }, 900);
}

function captureStatus(path, entryKey, mode) {
  if (!path || !entryKey || !isReviewProgressEntry(entryKey)) return;
  const status = legacyStatusFor(path, entryKey, mode);
  const changed = setReviewStatus(sharedProgress, { path, entryKey, status });
  const inventoryChanged = registerCurrentInventory();
  if (!changed && !inventoryChanged) return;
  persistShared();
  harmonizeProgressUi();
  if (changed) schedulePush();
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

installSyncUi();
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

window.addEventListener("focus", () => { void pullRemoteProgress({ userInitiated: false }); });
window.addEventListener("online", () => { void pullRemoteProgress({ userInitiated: false }); schedulePush(); });
