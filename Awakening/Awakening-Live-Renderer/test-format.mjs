import assert from "node:assert/strict";
import {
  decodeMessageFile,
  encodeMessageFile,
  formatEntryForEditing,
  isReviewProgressEntry,
  parseMessageDocument,
  replaceEntryValue,
  splitConversationFrames,
  sortFileDescriptors,
  summarizeEntry,
  unformatEntryFromEditing,
} from "./format.js";
import { AwakeningRenderer, createState } from "./renderer.js";

const original = "MESS_ARCHIVE_TEST\r\n\r\nMessage Name: Message\r\n\r\nMID_A: $t1$Wmクロム|3$Wsクロム|$Wa첫째\\n둘째$k$p셋째$k\r\nMPID_クロム: 크롬\r\n";
const document = parseMessageDocument(original, { fileName: "test.txt", hasBom: true });
assert.equal(document.archive, "MESS_ARCHIVE_TEST");
assert.equal(document.byKey.get("MID_A").value, "$t1$Wmクロム|3$Wsクロム|$Wa첫째\\n둘째$k$p셋째$k");
assert.deepEqual(splitConversationFrames(document.byKey.get("MID_A").value), ["$t1$Wmクロム|3$Wsクロム|$Wa첫째\\n둘째", "셋째$k"]);

const displayValue = formatEntryForEditing("첫째$k\\n$Ws리사|$Wa둘째$k$p셋째$k");
assert.equal(displayValue, "첫째$k\n\\n$Ws리사|$Wa둘째$k\n$p셋째$k");
assert.equal(unformatEntryFromEditing(displayValue), "첫째$k\\n$Ws리사|$Wa둘째$k$p셋째$k");
assert.equal(isReviewProgressEntry("MID_001_PCM1"), true);
assert.equal(isReviewProgressEntry("MID_001_PCM2"), false);
assert.equal(isReviewProgressEntry("MID_001_PCM3"), false);
assert.equal(isReviewProgressEntry("MID_001_PCF2"), false);
assert.equal(isReviewProgressEntry("MID_001_PCF3"), false);
assert.equal(
  summarizeEntry({ value: "$t1$Wsアズール|$Wa첫째 대사\\n둘째 줄$k\\n$Wsウード|$Wa두 번째 대사$k$p다음 화면$k" }),
  "첫째 대사 둘째 줄 두 번째 대사 다음 화면",
);
const fileDescriptors = [
  { relativePath: "010.txt", lastModified: 100 },
  { relativePath: "002.txt", lastModified: 300 },
  { relativePath: "001.txt", lastModified: 200 },
];
assert.deepEqual(sortFileDescriptors(fileDescriptors, "name").map((file) => file.relativePath), ["001.txt", "002.txt", "010.txt"]);
assert.deepEqual(sortFileDescriptors(fileDescriptors, "recent").map((file) => file.relativePath), ["002.txt", "001.txt", "010.txt"]);

const changed = replaceEntryValue(document, "MID_A", "$t1수정$k");
assert.equal(changed.text, original.replace("$t1$Wmクロム|3$Wsクロム|$Wa첫째\\n둘째$k$p셋째$k", "$t1수정$k"));
assert.ok(changed.text.includes("\r\n\r\nMessage Name: Message\r\n\r\n"));

const encoded = encodeMessageFile(changed.text, true);
assert.deepEqual([...encoded.slice(0, 3)], [0xef, 0xbb, 0xbf]);
assert.equal(decodeMessageFile(encoded).text, changed.text);

const renderer = new AwakeningRenderer();
assert.equal(renderer.parseFrame("$G남성,여성| / $Nu", createState("루플레", "male")), "남성 / 루플레");
assert.equal(renderer.parseFrame("$G남성,여성| / $Nu", createState("루플레", "female")), "여성 / 루플레");
assert.equal(renderer.assetCharacterName("username", "male"), "マイユニ_青年_顔立ちA");
assert.equal(renderer.assetCharacterName("username", "female"), "マイユニ_少女_顔立ちA");

const bustData = new DataView(new ArrayBuffer(0x28));
bustData.setUint16(0x14, 32, true);
bustData.setUint16(0x16, 32, true);
renderer.faceData.set("FSID_BU_クロム", bustData);
renderer.loadImage = async (path) => path.startsWith("img/face/") ? {} : null;
const transforms = [];
const context = {
  save() {},
  scale(x, y) { transforms.push([x, y]); },
  drawImage() {},
  restore() {},
};
await renderer.drawBust(context, { name: "クロム", emotion: "通常,", flip: false }, 160, new Set(), "female");
assert.deepEqual(transforms, [[-1, 1]], "$t0 아래쪽 초상도 캔버스 안으로 반전 배치해야 합니다.");
console.log("format tests passed");
