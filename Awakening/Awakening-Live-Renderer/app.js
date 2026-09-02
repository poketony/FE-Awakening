import {
  buildNameMap,
  decodeMessageFile,
  encodeMessageFile,
  normalizePath,
  parseMessageDocument,
  replaceEntryValue,
  summarizeEntry,
} from "./format.js";
import { AwakeningRenderer } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  workspace: $(".workspace"), filesPanel: $(".files"), messagesPanel: $(".messages"),
  toggleFiles: $("#toggleFiles"), toggleMessages: $("#toggleMessages"),
  profileMain: $("#profileMain"), profileDlc: $("#profileDlc"), profileLabel: $("#profileLabel"),
  pickKoDir: $("#pickKoDir"), pickJaDir: $("#pickJaDir"), pickKoFile: $("#pickKoFile"), pickJaFile: $("#pickJaFile"), saveFile: $("#saveFile"),
  fileSearch: $("#fileSearch"), entrySearch: $("#entrySearch"), reviewFilter: $("#reviewFilter"), fileList: $("#fileList"), entryList: $("#entryList"),
  koDirName: $("#koDirName"), jaDirName: $("#jaDirName"), jaDirDot: $("#jaDirDot"), fileCount: $("#fileCount"), entryCount: $("#entryCount"),
  currentFileName: $("#currentFileName"), entryKey: $("#entryKey"), dirtyMark: $("#dirtyMark"),
  playerName: $("#playerName"), playerGender: $("#playerGender"), reviewStatus: $("#reviewStatus"),
  sourceEditor: $("#sourceEditor"), jaEditor: $("#jaEditor"), charCount: $("#charCount"), jaEntryKey: $("#jaEntryKey"),
  koCanvas: $("#koCanvas"), jaCanvas: $("#jaCanvas"), koRenderState: $("#koRenderState"), jaMatchState: $("#jaMatchState"),
  prevFrame: $("#prevFrame"), nextFrame: $("#nextFrame"), frameLabel: $("#frameLabel"),
  diagnostics: $("#diagnostics"), diagnosticCount: $("#diagnosticCount"), diagnosticList: $("#diagnosticList"),
  statusText: $("#statusText"), toast: $("#toast"),
};

const renderer = new AwakeningRenderer();
const SETTINGS_DB = "fe13-live-renderer";
const SETTINGS_STORE = "settings";
const PROFILES = {
  main: { label: "본편", directoryKeys: { ko: "koreanDirectory", ja: "japaneseDirectory" } },
  dlc: { label: "DLC", directoryKeys: { ko: "dlcKoreanDirectory", ja: "dlcJapaneseDirectory" } },
};
const REVIEW_STATUSES = {
  unreviewed: { label: "미검수", badge: "미검수" },
  approved: { label: "확인 완료", badge: "완료" },
  needs_fix: { label: "수정 필요", badge: "수정" },
  deferred: { label: "보류", badge: "보류" },
};
const savedProfile = localStorage.getItem("fe13-live:profile");
const savedReviewFilter = localStorage.getItem("fe13-live:reviewFilter");
const state = {
  koFiles: [], jaFiles: [], koFileMap: new Map(), jaFileMap: new Map(), jaNameMap: new Map(), jaArchiveMap: new Map(),
  currentDocument: null, japaneseDocument: null, originalText: "", selectedKey: "", dirty: false,
  frameIndex: 0, renderTimer: 0, renderRevision: 0, matchRevision: 0,
  profile: savedProfile === "dlc" ? "dlc" : "main",
  switchingProfile: false,
  rememberedDirectories: { main: { ko: null, ja: null }, dlc: { ko: null, ja: null } },
  loadedDirectories: { ko: null, ja: null },
  collapsedSidebars: {
    files: localStorage.getItem("fe13-live:filesCollapsed") === "true",
    messages: localStorage.getItem("fe13-live:messagesCollapsed") === "true",
  },
  reviewStatuses: { main: loadReviewStatuses("main"), dlc: loadReviewStatuses("dlc") },
  reviewFilter: savedReviewFilter && (savedReviewFilter === "all" || REVIEW_STATUSES[savedReviewFilter]) ? savedReviewFilter : "all",
  playerName: localStorage.getItem("fe13-live:playerName") || "Robin",
  playerGender: localStorage.getItem("fe13-live:playerGender") === "male" ? "male" : "female",
};

elements.playerName.value = state.playerName;
elements.playerGender.value = state.playerGender;
elements.reviewFilter.value = state.reviewFilter;

function loadReviewStatuses(profile) {
  try {
    const saved = JSON.parse(localStorage.getItem(`fe13-live:reviewStatuses:${profile}`) || "{}");
    return new Map(Object.entries(saved).filter(([, status]) => status !== "unreviewed" && REVIEW_STATUSES[status]));
  } catch {
    return new Map();
  }
}

let settingsDatabasePromise;
function openSettingsDatabase() {
  if (!settingsDatabasePromise) {
    settingsDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SETTINGS_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(SETTINGS_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return settingsDatabasePromise;
}

async function readSetting(key) {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeSetting(key, value) {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SETTINGS_STORE, "readwrite");
    transaction.objectStore(SETTINGS_STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function setStatus(message) { elements.statusText.textContent = message; }

let toastTimer;
function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function setDirty(value) {
  state.dirty = value;
  elements.dirtyMark.classList.toggle("on", value);
  elements.saveFile.disabled = !state.currentDocument || !value;
  document.title = `${value ? "● " : ""}FE 각성 메시지 실시간 검수기`;
}

function canLeaveCurrentFile() {
  return !state.dirty || window.confirm("저장하지 않은 변경이 있습니다. 변경을 버리고 다른 파일을 열까요?");
}

function currentProfile() { return PROFILES[state.profile]; }

function reviewItemId(relativePath, entryKey) {
  return `${normalizePath(relativePath)}\u0000${entryKey}`;
}

function reviewStatusMap() { return state.reviewStatuses[state.profile]; }

function getReviewStatus(relativePath, entryKey) {
  return reviewStatusMap().get(reviewItemId(relativePath, entryKey)) ?? "unreviewed";
}

function persistReviewStatuses() {
  localStorage.setItem(
    `fe13-live:reviewStatuses:${state.profile}`,
    JSON.stringify(Object.fromEntries(reviewStatusMap())),
  );
}

function currentEntryReviewStatus(entryKey = state.selectedKey) {
  if (!state.currentDocument || !entryKey) return "unreviewed";
  return getReviewStatus(state.currentDocument.relativePath, entryKey);
}

function setEntryReviewStatus(status, nextKey = "") {
  if (!state.currentDocument || !state.selectedKey || !REVIEW_STATUSES[status]) return;
  const itemId = reviewItemId(state.currentDocument.relativePath, state.selectedKey);
  if (status === "unreviewed") reviewStatusMap().delete(itemId);
  else reviewStatusMap().set(itemId, status);
  try {
    persistReviewStatuses();
  } catch {
    toast("검수 상태를 브라우저에 저장하지 못했습니다.");
  }
  elements.reviewStatus.value = status;
  renderFileList();
  renderEntryList();
  toast(`${state.selectedKey} · ${REVIEW_STATUSES[status].label}`);
  if (nextKey) {
    selectEntry(nextKey, true);
  } else {
    requestAnimationFrame(() => elements.sourceEditor.focus({ preventScroll: true }));
  }
}

function fileReviewSummary(relativePath) {
  const prefix = `${normalizePath(relativePath)}\u0000`;
  const counts = { approved: 0, needs_fix: 0, deferred: 0 };
  for (const [itemId, status] of reviewStatusMap()) {
    if (itemId.startsWith(prefix) && counts[status] !== undefined) counts[status] += 1;
  }
  return counts;
}

function lastKoreanFileKey(handle) {
  return `fe13-live:lastKoFile:${state.profile}:${handle.name}`;
}

function updateSidebarLayout() {
  for (const kind of ["files", "messages"]) {
    const collapsed = state.collapsedSidebars[kind];
    const panel = kind === "files" ? elements.filesPanel : elements.messagesPanel;
    const button = kind === "files" ? elements.toggleFiles : elements.toggleMessages;
    const label = kind === "files" ? "FILES" : "MESSAGES";
    panel.classList.toggle("collapsed", collapsed);
    elements.workspace.classList.toggle(`${kind}-collapsed`, collapsed);
    button.textContent = collapsed ? "›" : "‹";
    button.title = `${label} ${collapsed ? "열기" : "닫기"}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-expanded", String(!collapsed));
  }
}

function toggleSidebar(kind) {
  const shouldRestoreEditor = !elements.sourceEditor.disabled;
  const selectionStart = elements.sourceEditor.selectionStart;
  const selectionEnd = elements.sourceEditor.selectionEnd;
  const editorScrollTop = elements.sourceEditor.scrollTop;
  state.collapsedSidebars[kind] = !state.collapsedSidebars[kind];
  localStorage.setItem(`fe13-live:${kind}Collapsed`, String(state.collapsedSidebars[kind]));
  updateSidebarLayout();
  if (shouldRestoreEditor) {
    requestAnimationFrame(() => {
      if (elements.sourceEditor.disabled) return;
      elements.sourceEditor.focus({ preventScroll: true });
      elements.sourceEditor.setSelectionRange(selectionStart, selectionEnd);
      elements.sourceEditor.scrollTop = editorScrollTop;
    });
  }
}

async function* walkDirectory(handle, prefix = "") {
  for await (const [name, child] of handle.entries()) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (child.kind === "directory") yield* walkDirectory(child, relativePath);
    else if (name.toLocaleLowerCase().endsWith(".txt")) yield { name, relativePath, handle: child };
  }
}

async function chooseDirectory(kind) {
  if (!window.showDirectoryPicker) {
    toast("폴더 열기는 최신 Edge/Chrome에서 localhost로 실행해야 합니다.");
    return;
  }
  if (kind === "ko" && !canLeaveCurrentFile()) return;
  try {
    const mode = kind === "ko" ? "readwrite" : "read";
    let handle = null;
    const remembered = state.rememberedDirectories[state.profile][kind];
    if (remembered && !state.loadedDirectories[kind]) {
      const permission = await remembered.requestPermission({ mode });
      if (permission === "granted") handle = remembered;
    }
    if (!handle) handle = await window.showDirectoryPicker({ mode });
    await loadDirectory(kind, handle);
    state.rememberedDirectories[state.profile][kind] = handle;
    try {
      await writeSetting(currentProfile().directoryKeys[kind], handle);
    } catch {
      toast("폴더는 열었지만 이 브라우저에서는 경로를 기억하지 못했습니다.");
    }
  } catch (error) {
    if (error.name !== "AbortError") toast(`폴더를 열지 못했습니다: ${error.message}`);
  }
}

async function loadDirectory(kind, handle) {
  try {
    setStatus(`${handle.name} 폴더의 텍스트 파일을 찾는 중…`);
    const files = [];
    for await (const file of walkDirectory(handle)) files.push(file);
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "ko", { numeric: true }));
    state.loadedDirectories[kind] = handle;
    if (kind === "ko") {
      state.koFiles = files;
      state.koFileMap = new Map(files.map((file) => [normalizePath(file.relativePath), file]));
      elements.koDirName.textContent = handle.name;
      elements.pickKoDir.textContent = "번역 폴더 변경";
      elements.fileCount.textContent = String(files.length);
      renderFileList();
      setStatus(`${files.length}개 번역 파일을 찾았습니다.`);
      const lastPath = localStorage.getItem(lastKoreanFileKey(handle))
        ?? (state.profile === "main" ? localStorage.getItem(`fe13-live:lastKoFile:${handle.name}`) : null);
      const initialFile = state.koFileMap.get(normalizePath(lastPath ?? "")) ?? files[0];
      if (initialFile) await openKoreanFile(initialFile, true);
    } else {
      state.jaFiles = files;
      state.jaFileMap = new Map(files.map((file) => [normalizePath(file.relativePath), file]));
      state.jaNameMap = new Map();
      state.jaArchiveMap.clear();
      for (const file of files) {
        const key = file.name.toLocaleLowerCase();
        const list = state.jaNameMap.get(key) ?? [];
        list.push(file);
        state.jaNameMap.set(key, list);
      }
      elements.jaDirName.textContent = `${handle.name} · ${files.length}개`;
      elements.pickJaDir.textContent = "일본어 폴더 변경";
      elements.jaDirDot.classList.add("ready");
      setStatus(`${files.length}개 일본어 파일을 찾았습니다.`);
      if (state.currentDocument) await autoMatchJapanese();
    }
  } catch (error) {
    state.loadedDirectories[kind] = null;
    throw error;
  }
}

function updateProfileUi() {
  elements.profileMain.classList.toggle("active", state.profile === "main");
  elements.profileDlc.classList.toggle("active", state.profile === "dlc");
  elements.profileMain.setAttribute("aria-pressed", String(state.profile === "main"));
  elements.profileDlc.setAttribute("aria-pressed", String(state.profile === "dlc"));
  elements.profileLabel.textContent = currentProfile().label;
}

function resetProfileWorkspace() {
  clearTimeout(state.renderTimer);
  state.renderRevision += 1;
  state.matchRevision += 1;
  state.koFiles = [];
  state.jaFiles = [];
  state.koFileMap = new Map();
  state.jaFileMap = new Map();
  state.jaNameMap = new Map();
  state.jaArchiveMap = new Map();
  state.currentDocument = null;
  state.japaneseDocument = null;
  state.originalText = "";
  state.selectedKey = "";
  state.frameIndex = 0;
  state.loadedDirectories = { ko: null, ja: null };
  setDirty(false);
  elements.koDirName.textContent = `${currentProfile().label} 번역 파일`;
  elements.jaDirName.textContent = `${currentProfile().label} 일본어 폴더 미지정`;
  elements.pickKoDir.textContent = "번역 폴더 열기";
  elements.pickJaDir.textContent = "일본어 폴더 열기";
  elements.fileCount.textContent = "0";
  elements.entryCount.textContent = "0";
  elements.currentFileName.textContent = "메시지 항목";
  elements.jaDirDot.classList.remove("ready");
  elements.jaMatchState.textContent = "미지정";
  elements.koRenderState.textContent = "준비 완료";
  elements.diagnosticCount.textContent = "0";
  elements.diagnosticList.textContent = "누락 에셋이나 알 수 없는 제어코드가 없습니다.";
  renderFileList();
  renderEntryList();
  clearSelection();
}

async function loadRememberedProfileDirectories() {
  const profile = state.profile;
  const handles = state.rememberedDirectories[profile];
  let needsPermission = false;
  for (const [kind, handle] of [["ko", handles.ko], ["ja", handles.ja]]) {
    if (!handle || state.profile !== profile) continue;
    const mode = kind === "ko" ? "readwrite" : "read";
    if (await handle.queryPermission({ mode }) === "granted") {
      await loadDirectory(kind, handle);
    } else {
      needsPermission = true;
      if (kind === "ko") {
        elements.koDirName.textContent = `${handle.name} · 권한 필요`;
        elements.pickKoDir.textContent = "번역 폴더 다시 열기";
      } else {
        elements.jaDirName.textContent = `${handle.name} · 권한 필요`;
        elements.pickJaDir.textContent = "일본어 폴더 다시 열기";
      }
    }
  }
  if (needsPermission) {
    setStatus(`${currentProfile().label} 폴더를 기억하고 있습니다. 다시 열기 버튼을 눌러 권한을 허용하세요.`);
  } else if (!handles.ko && !handles.ja) {
    setStatus(`${currentProfile().label} 모드 · 번역/일본어 폴더를 지정하세요.`);
  }
}

async function restoreRememberedDirectories() {
  if (!window.showDirectoryPicker || !window.indexedDB) return;
  try {
    const profileNames = Object.keys(PROFILES);
    const handles = await Promise.all(profileNames.flatMap((profile) => [
      readSetting(PROFILES[profile].directoryKeys.ko),
      readSetting(PROFILES[profile].directoryKeys.ja),
    ]));
    profileNames.forEach((profile, index) => {
      state.rememberedDirectories[profile].ko = handles[index * 2];
      state.rememberedDirectories[profile].ja = handles[index * 2 + 1];
    });
    await loadRememberedProfileDirectories();
  } catch {
    setStatus(`${currentProfile().label} 모드 · 번역 폴더를 여세요.`);
  }
}

async function switchProfile(profile) {
  if (!PROFILES[profile] || profile === state.profile || state.switchingProfile) return;
  if (!canLeaveCurrentFile()) return;
  state.switchingProfile = true;
  state.profile = profile;
  localStorage.setItem("fe13-live:profile", profile);
  updateProfileUi();
  resetProfileWorkspace();
  setStatus(`${currentProfile().label} 모드로 전환하는 중…`);
  try {
    await loadRememberedProfileDirectories();
  } catch (error) {
    toast(`${currentProfile().label} 폴더를 열지 못했습니다: ${error.message}`);
  } finally {
    state.switchingProfile = false;
  }
}

async function chooseSingleFile(kind) {
  if (!window.showOpenFilePicker) {
    toast("파일 열기는 최신 Edge/Chrome에서 localhost로 실행해야 합니다.");
    return;
  }
  if (kind === "ko" && !canLeaveCurrentFile()) return;
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "Fire Emblem text", accept: { "text/plain": [".txt"] } }],
    });
    const descriptor = { name: handle.name, relativePath: handle.name, handle };
    if (kind === "ko") {
      state.koFiles = [descriptor];
      elements.koDirName.textContent = "단일 파일";
      elements.fileCount.textContent = "1";
      renderFileList();
      await openKoreanFile(descriptor, true);
    } else {
      state.japaneseDocument = await readDocument(descriptor);
      elements.jaMatchState.textContent = handle.name;
      updateJapaneseEntry();
      scheduleRender();
    }
  } catch (error) {
    if (error.name !== "AbortError") toast(`파일을 열지 못했습니다: ${error.message}`);
  }
}

async function readDocument(descriptor) {
  const file = await descriptor.handle.getFile();
  const decoded = decodeMessageFile(await file.arrayBuffer());
  return parseMessageDocument(decoded.text, {
    fileHandle: descriptor.handle,
    fileName: descriptor.name,
    relativePath: descriptor.relativePath,
    hasBom: decoded.hasBom,
  });
}

async function openKoreanFile(descriptor, skipConfirmation = false) {
  if (!skipConfirmation && state.currentDocument && descriptor.relativePath !== state.currentDocument.relativePath && !canLeaveCurrentFile()) return;
  try {
    setStatus(`${descriptor.relativePath} 읽는 중…`);
    state.currentDocument = await readDocument(descriptor);
    state.originalText = state.currentDocument.text;
    state.selectedKey = "";
    state.frameIndex = 0;
    setDirty(false);
    elements.currentFileName.textContent = descriptor.name;
    elements.entryCount.textContent = String(displayEntries().length);
    renderFileList();
    renderEntryList();
    clearSelection();
    await autoMatchJapanese();
    const preferred = displayEntries().find((entry) => /^(MID_|MSID_)/.test(entry.key) && entry.value.includes("$W")) ?? displayEntries()[0];
    if (preferred) selectEntry(preferred.key);
    if (state.loadedDirectories.ko) {
      localStorage.setItem(lastKoreanFileKey(state.loadedDirectories.ko), descriptor.relativePath);
    }
    setStatus(`${descriptor.relativePath} · ${state.currentDocument.entries.length}개 항목`);
  } catch (error) {
    toast(`파일을 읽지 못했습니다: ${error.message}`);
  }
}

function displayEntries() {
  return state.currentDocument?.entries.filter((entry) => entry.key !== "Message Name") ?? [];
}

async function autoMatchJapanese() {
  const revision = ++state.matchRevision;
  state.japaneseDocument = null;
  elements.jaMatchState.textContent = state.jaFiles.length ? "찾는 중…" : "폴더 미지정";
  updateJapaneseEntry();
  if (!state.currentDocument || !state.jaFiles.length) return;

  let descriptor = state.jaFileMap.get(normalizePath(state.currentDocument.relativePath));
  if (!descriptor) {
    const sameNames = state.jaNameMap.get(state.currentDocument.fileName.toLocaleLowerCase()) ?? [];
    if (sameNames.length === 1) descriptor = sameNames[0];
  }
  if (!descriptor && state.currentDocument.archive) descriptor = await findByArchive(state.currentDocument.archive);
  if (revision !== state.matchRevision) return;
  if (!descriptor) {
    elements.jaMatchState.textContent = "자동 매칭 없음";
    scheduleRender();
    return;
  }
  try {
    state.japaneseDocument = await readDocument(descriptor);
    if (revision !== state.matchRevision) return;
    elements.jaMatchState.textContent = descriptor.relativePath;
    updateJapaneseEntry();
    scheduleRender();
  } catch (error) {
    elements.jaMatchState.textContent = "읽기 실패";
  }
}

async function findByArchive(archive) {
  if (state.jaArchiveMap.has(archive)) return state.jaArchiveMap.get(archive);
  setStatus(`${archive}와 대응하는 일본어 파일을 찾는 중…`);
  for (const descriptor of state.jaFiles) {
    try {
      const file = await descriptor.handle.getFile();
      const head = await file.slice(0, 256).text();
      const firstLine = head.match(/^[^\r\n]*/)?.[0]?.replace(/^\uFEFF/, "").trim();
      if (firstLine) state.jaArchiveMap.set(firstLine, descriptor);
      if (firstLine === archive) return descriptor;
    } catch { /* 읽을 수 없는 참조 파일은 건너뛴다. */ }
  }
  return null;
}

function renderFileList() {
  const query = elements.fileSearch.value.trim().toLocaleLowerCase();
  const files = state.koFiles.filter((file) => file.relativePath.toLocaleLowerCase().includes(query));
  elements.fileList.className = files.length ? "list" : "list empty-state";
  elements.fileList.replaceChildren();
  if (!files.length) {
    elements.fileList.textContent = state.koFiles.length ? "검색 결과가 없습니다." : "번역 폴더나 파일을 여세요.";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const button = document.createElement("button");
    const reviewSummary = fileReviewSummary(file.relativePath);
    button.className = `list-item${state.currentDocument?.relativePath === file.relativePath ? " active" : ""}`;
    button.innerHTML = `<span class="title-row"><span class="title"></span><span class="file-review-summary"></span></span><span class="sub"></span>`;
    button.querySelector(".title").textContent = file.name;
    button.querySelector(".sub").textContent = file.relativePath;
    const summary = button.querySelector(".file-review-summary");
    const labels = [];
    if (reviewSummary.approved) labels.push(`✓ ${reviewSummary.approved}`);
    if (reviewSummary.needs_fix) labels.push(`! ${reviewSummary.needs_fix}`);
    if (reviewSummary.deferred) labels.push(`… ${reviewSummary.deferred}`);
    summary.textContent = labels.join(" · ");
    summary.classList.toggle("has-fix", reviewSummary.needs_fix > 0);
    summary.title = labels.length ? `완료 ${reviewSummary.approved} · 수정 필요 ${reviewSummary.needs_fix} · 보류 ${reviewSummary.deferred}` : "";
    button.addEventListener("click", () => openKoreanFile(file));
    fragment.append(button);
  }
  elements.fileList.append(fragment);
}

function filteredEntries() {
  const query = elements.entrySearch.value.trim().toLocaleLowerCase();
  const filter = elements.reviewFilter.value;
  return displayEntries().filter((entry) => {
    const matchesQuery = `${entry.key}\n${entry.value}`.toLocaleLowerCase().includes(query);
    return matchesQuery && (filter === "all" || currentEntryReviewStatus(entry.key) === filter);
  });
}

function renderEntryList() {
  const allEntries = displayEntries();
  const entries = filteredEntries();
  elements.entryCount.textContent = entries.length === allEntries.length ? String(allEntries.length) : `${entries.length}/${allEntries.length}`;
  elements.entryList.className = entries.length ? "list" : "list empty-state";
  elements.entryList.replaceChildren();
  if (!entries.length) {
    elements.entryList.textContent = state.currentDocument ? "현재 검색·검수 필터에 맞는 항목이 없습니다." : "파일을 선택하면 항목이 표시됩니다.";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const button = document.createElement("button");
    const reviewStatus = currentEntryReviewStatus(entry.key);
    button.className = `list-item review-${reviewStatus}${state.selectedKey === entry.key ? " active" : ""}`;
    button.innerHTML = `<span class="title-row"><span class="title"></span><span class="review-badge"></span></span><span class="sub"></span>`;
    button.querySelector(".title").textContent = entry.key;
    button.querySelector(".review-badge").textContent = REVIEW_STATUSES[reviewStatus].badge;
    button.querySelector(".sub").textContent = summarizeEntry(entry) || "(빈 값)";
    button.addEventListener("click", () => selectEntry(entry.key, true));
    fragment.append(button);
  }
  elements.entryList.append(fragment);
  requestAnimationFrame(() => elements.entryList.querySelector(".active")?.scrollIntoView({ block: "nearest" }));
}

function clearSelection() {
  elements.entryKey.textContent = "항목을 선택하세요";
  elements.sourceEditor.value = "";
  elements.sourceEditor.disabled = true;
  elements.reviewStatus.value = "unreviewed";
  elements.reviewStatus.disabled = true;
  elements.jaEditor.value = "";
  elements.jaEntryKey.textContent = "—";
  elements.charCount.textContent = "0자";
  clearCanvas(elements.koCanvas);
  clearCanvas(elements.jaCanvas);
  updateFrameControls(0, 0);
}

function selectEntry(key, focusEditor = false) {
  const entry = state.currentDocument?.byKey.get(key);
  if (!entry) return;
  state.selectedKey = key;
  state.frameIndex = 0;
  elements.entryKey.textContent = key;
  elements.sourceEditor.disabled = false;
  elements.sourceEditor.value = entry.value;
  elements.reviewStatus.disabled = false;
  elements.reviewStatus.value = currentEntryReviewStatus(key);
  elements.charCount.textContent = `${entry.value.length.toLocaleString()}자`;
  renderEntryList();
  updateJapaneseEntry();
  scheduleRender();
  if (focusEditor) requestAnimationFrame(() => elements.sourceEditor.focus({ preventScroll: true }));
}

function updateJapaneseEntry() {
  const entry = state.japaneseDocument?.byKey.get(state.selectedKey);
  elements.jaEditor.value = entry?.value ?? "";
  elements.jaEntryKey.textContent = entry ? entry.key : "대응 항목 없음";
  if (state.japaneseDocument && !entry) elements.jaMatchState.textContent = `${state.japaneseDocument.fileName} · 키 없음`;
}

function onEditorInput() {
  if (!state.currentDocument || !state.selectedKey) return;
  try {
    state.currentDocument = replaceEntryValue(state.currentDocument, state.selectedKey, elements.sourceEditor.value);
    elements.charCount.textContent = `${elements.sourceEditor.value.length.toLocaleString()}자`;
    setDirty(state.currentDocument.text !== state.originalText);
    scheduleRender();
  } catch (error) {
    toast(error.message);
  }
}

function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(renderSelected, 55);
}

async function renderSelected() {
  const revision = ++state.renderRevision;
  const koEntry = state.currentDocument?.byKey.get(state.selectedKey);
  const jaEntry = state.japaneseDocument?.byKey.get(state.selectedKey);
  if (!koEntry) { clearSelection(); return; }
  elements.koRenderState.textContent = "렌더링…";
  const [koResult, jaResult] = await Promise.all([
    renderer.render(koEntry.value, elements.koCanvas, { frameIndex: state.frameIndex, nameMap: buildNameMap(state.currentDocument), playerName: state.playerName, playerGender: state.playerGender }),
    renderer.render(jaEntry?.value ?? "", elements.jaCanvas, { frameIndex: state.frameIndex, nameMap: buildNameMap(state.japaneseDocument), playerName: state.playerName, playerGender: state.playerGender }),
  ]);
  if (revision !== state.renderRevision) return;
  state.frameIndex = Math.min(state.frameIndex, Math.max(0, koResult.frameCount - 1));
  updateFrameControls(state.frameIndex, koResult.frameCount);
  elements.koRenderState.textContent = koResult.frameCount ? `타입 ${koResult.type} · ${koResult.frameCount}화면` : "렌더할 내용 없음";
  if (!state.japaneseDocument) elements.jaMatchState.textContent = state.jaFiles.length ? "자동 매칭 없음" : "폴더 미지정";
  else if (!jaEntry) elements.jaMatchState.textContent = `${state.japaneseDocument.fileName} · 키 없음`;
  updateDiagnostics([...koResult.diagnostics, ...jaResult.diagnostics]);
}

function updateFrameControls(index, count) {
  elements.frameLabel.textContent = count ? `${index + 1} / ${count}` : "0 / 0";
  elements.prevFrame.disabled = !count || index <= 0;
  elements.nextFrame.disabled = !count || index >= count - 1;
}

function updateDiagnostics(items) {
  const unique = [...new Map(items.map((item) => [item.message, item])).values()];
  elements.diagnosticCount.textContent = String(unique.length);
  elements.diagnosticList.replaceChildren();
  if (!unique.length) {
    elements.diagnosticList.textContent = "누락 에셋이나 알 수 없는 제어코드가 없습니다.";
    return;
  }
  for (const item of unique) {
    const row = document.createElement("div");
    row.className = "diagnostic-item warn";
    row.textContent = item.message;
    elements.diagnosticList.append(row);
  }
}

function clearCanvas(canvas) { canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); }

async function saveCurrentFile() {
  if (!state.currentDocument || !state.dirty) return;
  try {
    const permission = await state.currentDocument.fileHandle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("파일 쓰기 권한이 허용되지 않았습니다.");
    const writable = await state.currentDocument.fileHandle.createWritable();
    await writable.write(encodeMessageFile(state.currentDocument.text, state.currentDocument.hasBom));
    await writable.close();
    state.originalText = state.currentDocument.text;
    setDirty(false);
    setStatus(`${state.currentDocument.relativePath} 저장 완료`);
    toast("원본 텍스트 형식으로 저장했습니다.");
  } catch (error) {
    toast(`저장하지 못했습니다: ${error.message}`);
  }
}

function adjacentEntryKey(direction, entries = filteredEntries()) {
  if (!entries.length) return "";
  const index = entries.findIndex((entry) => entry.key === state.selectedKey);
  if (index < 0) return direction > 0 ? entries[0].key : entries.at(-1).key;
  return entries[index + direction]?.key ?? "";
}

function moveEntry(direction) {
  const key = adjacentEntryKey(direction);
  if (!key) {
    toast(direction > 0 ? "마지막 메시지입니다." : "첫 메시지입니다.");
    return;
  }
  selectEntry(key, true);
}

async function moveFile(direction) {
  const query = elements.fileSearch.value.trim().toLocaleLowerCase();
  const files = state.koFiles.filter((file) => file.relativePath.toLocaleLowerCase().includes(query));
  if (!files.length) return;
  const index = files.findIndex((file) => file.relativePath === state.currentDocument?.relativePath);
  const target = files[index < 0 ? (direction > 0 ? 0 : files.length - 1) : index + direction];
  if (!target) {
    toast(direction > 0 ? "마지막 파일입니다." : "첫 파일입니다.");
    return;
  }
  await openKoreanFile(target);
  if (state.currentDocument?.relativePath === target.relativePath) {
    requestAnimationFrame(() => elements.sourceEditor.focus({ preventScroll: true }));
  }
}

function moveFrame(direction) {
  const button = direction < 0 ? elements.prevFrame : elements.nextFrame;
  if (button.disabled) return;
  state.frameIndex += direction;
  scheduleRender();
}

function approveAndAdvance() {
  if (!state.currentDocument || !state.selectedKey) return;
  const nextKey = adjacentEntryKey(1);
  setEntryReviewStatus("approved", nextKey);
}

elements.profileMain.addEventListener("click", () => switchProfile("main"));
elements.profileDlc.addEventListener("click", () => switchProfile("dlc"));
elements.toggleFiles.addEventListener("click", () => toggleSidebar("files"));
elements.toggleMessages.addEventListener("click", () => toggleSidebar("messages"));
elements.pickKoDir.addEventListener("click", () => chooseDirectory("ko"));
elements.pickJaDir.addEventListener("click", () => chooseDirectory("ja"));
elements.pickKoFile.addEventListener("click", () => chooseSingleFile("ko"));
elements.pickJaFile.addEventListener("click", () => chooseSingleFile("ja"));
elements.saveFile.addEventListener("click", saveCurrentFile);
elements.fileSearch.addEventListener("input", renderFileList);
elements.entrySearch.addEventListener("input", renderEntryList);
elements.reviewFilter.addEventListener("change", () => {
  state.reviewFilter = elements.reviewFilter.value;
  localStorage.setItem("fe13-live:reviewFilter", state.reviewFilter);
  renderEntryList();
});
elements.reviewStatus.addEventListener("change", () => setEntryReviewStatus(elements.reviewStatus.value));
elements.sourceEditor.addEventListener("input", onEditorInput);
elements.playerName.addEventListener("input", () => {
  state.playerName = elements.playerName.value || "Robin";
  localStorage.setItem("fe13-live:playerName", state.playerName);
  scheduleRender();
});
elements.playerGender.addEventListener("change", () => {
  state.playerGender = elements.playerGender.value === "male" ? "male" : "female";
  localStorage.setItem("fe13-live:playerGender", state.playerGender);
  scheduleRender();
});
elements.prevFrame.addEventListener("click", () => { state.frameIndex -= 1; scheduleRender(); });
elements.nextFrame.addEventListener("click", () => { state.frameIndex += 1; scheduleRender(); });
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
    event.preventDefault();
    saveCurrentFile();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === "Enter") {
    event.preventDefault();
    approveAndAdvance();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    moveFrame(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "F2") {
    event.preventDefault();
    setEntryReviewStatus("needs_fix");
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveEntry(event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      void moveFile(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) event.preventDefault();
});

updateSidebarLayout();
updateProfileUi();
resetProfileWorkspace();

try {
  await renderer.initialize();
  setStatus("에셋 준비 완료 · 번역 폴더를 여세요.");
  elements.koRenderState.textContent = "준비 완료";
  await restoreRememberedDirectories();
} catch (error) {
  setStatus(error.message);
  toast("에셋 로드 실패: start.bat로 실행했는지 확인하세요.");
}
