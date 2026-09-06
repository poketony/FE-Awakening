export const PROGRESS_VERSION = 2;
export const REVIEW_STATUSES = Object.freeze(["unreviewed", "approved", "needs_fix", "deferred"]);
const STATUS_SET = new Set(REVIEW_STATUSES);

export function normalizeReviewPath(path) {
  return String(path || "").replaceAll("\\", "/").replace(/^\.\//u, "").toLocaleLowerCase();
}

export function makeEntryId(path, entryKey) {
  return `${normalizeReviewPath(path)}\u0000${String(entryKey || "")}`;
}

export function makeFileId(path) {
  return normalizeReviewPath(path);
}

export function emptyProgress() {
  return { version: PROGRESS_VERSION, files: {}, entries: {} };
}

function validIso(value) {
  if (typeof value !== "string" || !value) return new Date(0).toISOString();
  const time = Date.parse(value);
  return Number.isNaN(time) ? new Date(0).toISOString() : new Date(time).toISOString();
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

export function parseProgress(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return emptyProgress();
    const output = emptyProgress();
    if (parsed.files && typeof parsed.files === "object") {
      for (const file of Object.values(parsed.files)) {
        if (!file || typeof file !== "object" || !file.path) continue;
        const id = makeFileId(file.path);
        output.files[id] = {
          path: String(file.path),
          mode: file.mode === "dlc" ? "dlc" : "main",
          expected: uniqueStrings(file.expected),
          updatedAt: validIso(file.updatedAt),
        };
      }
    }
    if (parsed.entries && typeof parsed.entries === "object") {
      for (const entry of Object.values(parsed.entries)) {
        if (!entry || typeof entry !== "object" || !entry.path || !entry.entryKey) continue;
        const status = STATUS_SET.has(entry.status) ? entry.status : "unreviewed";
        const id = makeEntryId(entry.path, entry.entryKey);
        output.entries[id] = {
          path: String(entry.path),
          entryKey: String(entry.entryKey),
          status,
          updatedAt: validIso(entry.updatedAt),
        };
      }
    }
    return output;
  } catch {
    return emptyProgress();
  }
}

function newer(left, right, preferRightOnTie = true) {
  if (!left) return right;
  if (!right) return left;
  const leftTime = Date.parse(left.updatedAt || 0) || 0;
  const rightTime = Date.parse(right.updatedAt || 0) || 0;
  if (rightTime > leftTime) return right;
  if (rightTime < leftTime) return left;
  return preferRightOnTie ? right : left;
}

export function mergeProgress(base, incoming) {
  const left = parseProgress(base);
  const right = parseProgress(incoming);
  const output = emptyProgress();
  for (const id of new Set([...Object.keys(left.files), ...Object.keys(right.files)])) {
    const chosen = newer(left.files[id], right.files[id]);
    if (chosen) output.files[id] = { ...chosen, expected: [...chosen.expected] };
  }
  for (const id of new Set([...Object.keys(left.entries), ...Object.keys(right.entries)])) {
    const chosen = newer(left.entries[id], right.entries[id]);
    if (chosen) output.entries[id] = { ...chosen };
  }
  return output;
}

export function registerFile(progress, { path, mode = "main", expected = [], at = new Date().toISOString() }) {
  if (!path) return false;
  const parsed = parseProgress(progress);
  const id = makeFileId(path);
  const nextExpected = uniqueStrings(expected);
  const current = parsed.files[id];
  const same = current
    && current.path === path
    && current.mode === (mode === "dlc" ? "dlc" : "main")
    && current.expected.length === nextExpected.length
    && current.expected.every((value, index) => value === nextExpected[index]);
  if (same) {
    Object.assign(progress, parsed);
    return false;
  }
  parsed.files[id] = {
    path: String(path),
    mode: mode === "dlc" ? "dlc" : "main",
    expected: nextExpected,
    updatedAt: validIso(at),
  };
  Object.assign(progress, parsed);
  return true;
}

export function setReviewStatus(progress, {
  path,
  entryKey,
  status,
  at = new Date().toISOString(),
}) {
  if (!path || !entryKey || !STATUS_SET.has(status)) return false;
  const parsed = parseProgress(progress);
  const id = makeEntryId(path, entryKey);
  const current = parsed.entries[id];
  if (current?.status === status) {
    Object.assign(progress, parsed);
    return false;
  }
  parsed.entries[id] = {
    path: String(path),
    entryKey: String(entryKey),
    status,
    updatedAt: validIso(at),
  };
  Object.assign(progress, parsed);
  return true;
}

export function getReviewStatus(progress, path, entryKey) {
  return parseProgress(progress).entries[makeEntryId(path, entryKey)]?.status || "unreviewed";
}

export function fileProgress(progress, path) {
  const parsed = parseProgress(progress);
  const file = parsed.files[makeFileId(path)];
  if (!file || !file.expected.length) {
    const prefix = `${makeFileId(path)}\u0000`;
    const statuses = Object.entries(parsed.entries)
      .filter(([id]) => id.startsWith(prefix))
      .map(([, entry]) => entry.status);
    const touched = statuses.filter((status) => status !== "unreviewed").length;
    return {
      expected: 0,
      approved: statuses.filter((status) => status === "approved").length,
      needsFix: statuses.filter((status) => status === "needs_fix").length,
      deferred: statuses.filter((status) => status === "deferred").length,
      touched,
      fraction: 0,
      state: touched ? "progress" : "incomplete",
    };
  }
  let approved = 0;
  let needsFix = 0;
  let deferred = 0;
  let touched = 0;
  for (const entryKey of file.expected) {
    const status = parsed.entries[makeEntryId(file.path, entryKey)]?.status || "unreviewed";
    if (status !== "unreviewed") touched += 1;
    if (status === "approved") approved += 1;
    else if (status === "needs_fix") needsFix += 1;
    else if (status === "deferred") deferred += 1;
  }
  const complete = approved === file.expected.length;
  return {
    expected: file.expected.length,
    approved,
    needsFix,
    deferred,
    touched,
    fraction: file.expected.length ? approved / file.expected.length : 0,
    state: complete ? "complete" : touched ? "progress" : "incomplete",
  };
}

function roundedPercent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function summarizeMode(progress, mode, catalogPaths = []) {
  const parsed = parseProgress(progress);
  const target = mode === "dlc" ? "dlc" : "main";
  const paths = catalogPaths.length
    ? [...new Set(catalogPaths.map(String))]
    : Object.values(parsed.files).filter((file) => file.mode === target).map((file) => file.path);
  let complete = 0;
  let inProgress = 0;
  let totalEntries = 0;
  let approvedEntries = 0;
  let needsFix = 0;
  let deferred = 0;
  for (const path of paths) {
    const summary = fileProgress(parsed, path);
    if (summary.state === "complete") complete += 1;
    else if (summary.state === "progress") inProgress += 1;
    totalEntries += summary.expected;
    approvedEntries += summary.approved;
    needsFix += summary.needsFix;
    deferred += summary.deferred;
  }
  return {
    total: paths.length,
    complete,
    inProgress,
    remaining: Math.max(0, paths.length - complete),
    percent: roundedPercent(complete, paths.length),
    totalEntries,
    approvedEntries,
    entryPercent: roundedPercent(approvedEntries, totalEntries),
    needsFix,
    deferred,
  };
}

export function completedToday(progress, now = new Date()) {
  const target = [now.getFullYear(), now.getMonth(), now.getDate()];
  let count = 0;
  for (const entry of Object.values(parseProgress(progress).entries)) {
    if (entry.status !== "approved") continue;
    const date = new Date(entry.updatedAt);
    if (Number.isNaN(date.getTime())) continue;
    if (date.getFullYear() === target[0] && date.getMonth() === target[1] && date.getDate() === target[2]) count += 1;
  }
  return count;
}

export function progressMessage(input = {}) {
  const percent = Number(input.percent) || 0;
  const complete = Number(input.complete) || 0;
  const total = Number(input.total) || 0;
  const remaining = Number.isFinite(input.remaining) ? input.remaining : Math.max(0, total - complete);
  const inProgress = Number(input.inProgress) || 0;
  if (percent >= 100 && total) return "끝. 전부 검수 완료. 이 숫자는 네가 직접 밀어 올린 거다.";
  if (percent >= 90) return `90% 넘겼다. 남은 ${remaining}개. 이제 마무리만 하면 끝이다.`;
  if (percent >= 75) return `3/4 돌파. 남은 ${remaining}개. 끝이 숫자로 보인다.`;
  if (percent >= 50) return "절반 넘겼다. 이제 끝낸 파일이 남은 파일보다 많다.";
  if (percent >= 25) return `4분의 1 돌파. 벌써 ${complete}개를 실제로 끝냈다. 계속 밀자.`;
  if (percent >= 10) return "두 자릿수 진입. 이제 이건 '시작'이 아니라 제대로 진행 중이다.";
  if (complete >= 5) return `좋다. ${complete}개 끝냈다. 총량은 도망 못 간다. 한 파일씩 지우자.`;
  if (complete >= 1) return "첫 파일 넘겼다. 이제 0%가 아니다. 다음 하나만 보자.";
  if (inProgress > 0) return "첫 파일이 진행 중이다. 지금 것만 끝내면 큰 숫자가 움직인다.";
  return "첫 파일 하나만 끝내자. 0 → 1이 제일 큰 변화다.";
}

export function serializeProgress(progress) {
  const parsed = parseProgress(progress);
  const files = {};
  const entries = {};
  for (const id of Object.keys(parsed.files).sort()) files[id] = parsed.files[id];
  for (const id of Object.keys(parsed.entries).sort()) entries[id] = parsed.entries[id];
  return `${JSON.stringify({ version: PROGRESS_VERSION, files, entries }, null, 2)}\n`;
}
