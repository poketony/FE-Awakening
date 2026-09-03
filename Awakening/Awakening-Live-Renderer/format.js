const ENTRY_RE = /^([^:\r\n]+):([ \t]?)([^\r\n]*)/gm;

export function decodeMessageFile(buffer) {
  const bytes = new Uint8Array(buffer);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(body),
    hasBom,
  };
}

export function encodeMessageFile(text, hasBom = false) {
  const encoded = new TextEncoder().encode(text);
  if (!hasBom) return encoded;
  const bytes = new Uint8Array(encoded.length + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(encoded, 3);
  return bytes;
}

export function parseMessageDocument(text, metadata = {}) {
  const entries = [];
  const byKey = new Map();
  ENTRY_RE.lastIndex = 0;
  let match;
  while ((match = ENTRY_RE.exec(text)) !== null) {
    const valueStart = match.index + match[1].length + 1 + match[2].length;
    const entry = {
      key: match[1],
      value: match[3],
      lineStart: match.index,
      valueStart,
      valueEnd: valueStart + match[3].length,
    };
    entries.push(entry);
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
  }

  const firstLine = text.match(/^[^\r\n]*/)?.[0]?.replace(/^\uFEFF/, "").trim() ?? "";
  const archive = /^MESS_ARCHIVE_[^\s]+$/.test(firstLine) ? firstLine : "";
  return { ...metadata, text, entries, byKey, archive };
}

export function replaceEntryValue(document, key, nextValue) {
  const entry = document.byKey.get(key);
  if (!entry) throw new Error(`항목을 찾을 수 없습니다: ${key}`);
  const nextText = document.text.slice(0, entry.valueStart) + nextValue + document.text.slice(entry.valueEnd);
  return parseMessageDocument(nextText, {
    fileHandle: document.fileHandle,
    fileName: document.fileName,
    relativePath: document.relativePath,
    hasBom: document.hasBom,
  });
}

export function splitConversationFrames(value) {
  if (!value) return [];
  const frames = value
    .split(/(?:\$k\$p|\$k\\n|\r?\n)/)
    .filter((part) => part.length > 0 && !/^\$Sbs\w+\|/.test(part));
  return frames.length ? frames : [value];
}

export function formatEntryForEditing(value) {
  return value.replace(/\$k(?=\\n|\$p)/g, "$k\n");
}

export function unformatEntryFromEditing(value) {
  return value.replace(/[\r\n]/g, "");
}

export function isReviewProgressEntry(entryKey) {
  return entryKey !== "Message Name" && !/(?:^|_)(?:PCM[23]|PCF[23])$/.test(entryKey);
}

export function buildNameMap(document) {
  const names = new Map();
  if (!document) return names;
  for (const entry of document.entries) {
    if (entry.key.startsWith("MPID_")) names.set(entry.key.slice(5), entry.value);
  }
  return names;
}

export function summarizeEntry(entry) {
  return entry.value
    .replace(/\$(?:k|p)/g, " ")
    .replace(/\$(?:Sbv|Sbp|Sls|Slp)[^|$]*\|[^|$]*\|/g, "")
    .replace(/\$(?:VNMPID|Sbs|Sve|Svj|Svp|Sre|Ssp|Fw|Ws|VF|Fo|Fi|E|b|w|l)[^|$]*\|/g, "")
    .replace(/\$Wm[^|$]*\|./g, "")
    .replace(/\$(?:G|c)[^|$]*\|/g, "")
    .replace(/\$(?:Wa|Wc|Nu|N0|N1|t0|t1|Wv|Wd|a)/g, "")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").toLocaleLowerCase();
}

export function sortFileDescriptors(files, mode = "name") {
  return [...files].sort((a, b) => {
    if (mode === "recent") {
      const modifiedDifference = (b.lastModified || 0) - (a.lastModified || 0);
      if (modifiedDifference) return modifiedDifference;
    }
    return a.relativePath.localeCompare(b.relativePath, "ko", { numeric: true });
  });
}
