import assert from "node:assert/strict";
import { DEFAULT_HAIR_COLOR, hairColorForAssetPath, hairColorForCharacter } from "./hair-colors.js";
import { cleanCharacterId, koreanCharacterName } from "./names-ko.js";

assert.deepEqual(hairColorForCharacter("ルキナ"), [0x50, 0x5c, 0x81]);
assert.deepEqual(hairColorForCharacter("アズール"), [0x99, 0x91, 0x91]);
assert.deepEqual(hairColorForCharacter("セレナ"), [0xaf, 0x54, 0x54]);
assert.deepEqual(hairColorForCharacter("マーク"), DEFAULT_HAIR_COLOR);
assert.deepEqual(hairColorForAssetPath("img/hair/ノワール_bu_髪0.png"), [0x48, 0x48, 0x48]);
assert.deepEqual(hairColorForAssetPath("img/hair/マイユニ_少女_顔立ちA_st_髪0.png"), [0xf6, 0xf4, 0xef]);

assert.equal(koreanCharacterName("クロム"), "크롬");
assert.equal(koreanCharacterName("アズール"), "이니고");
assert.equal(koreanCharacterName("ルキナ"), "루키나");
assert.equal(koreanCharacterName("プレイヤー画像なし", "러플레"), "러플레");
assert.equal(cleanCharacterId("クロム画像なし"), "クロム");

console.log("live enhancement data tests passed");
