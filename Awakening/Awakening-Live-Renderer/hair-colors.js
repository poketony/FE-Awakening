// Keep the live renderer's variable-hair portraits aligned with FE-Support-Archive.
// Characters without a specific override keep the renderer's original neutral tint.

export const DEFAULT_HAIR_COLOR = Object.freeze([0x5b, 0x58, 0x55]);

function rgb(hex) {
  const value = Number.parseInt(hex.replace(/^#/u, ""), 16);
  return Object.freeze([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
}

const AWAKENING_HAIR_COLORS = new Map([
  ["プレイヤー", rgb("#F6F4EF")],
  ["マイユニ_青年_顔立ちA", rgb("#F6F4EF")],
  ["マイユニ_少女_顔立ちA", rgb("#F6F4EF")],
  ["マーク", DEFAULT_HAIR_COLOR],
  ["マーク男", DEFAULT_HAIR_COLOR],
  ["マーク女", DEFAULT_HAIR_COLOR],

  ["ルキナ", rgb("#505C81")],
  ["マルス", rgb("#505C81")],
  ["ウード", rgb("#DAD3BD")],
  ["ウード正体不明", rgb("#DAD3BD")],
  ["アズール", rgb("#999191")],
  ["ブレディ", rgb("#F2E7C4")],
  ["デジェル", rgb("#595655")],
  ["シンシア", rgb("#A19791")],
  ["セレナ", rgb("#AF5454")],
  ["ジェローム", rgb("#D48085")],
  ["シャンブレー", rgb("#463E36")],
  ["ロラン", rgb("#532426")],
  ["ノワール", rgb("#484848")],
  ["ンン", rgb("#C2D6AE")],
]);

export function hairColorForCharacter(characterId) {
  const id = String(characterId || "").trim();
  return AWAKENING_HAIR_COLORS.get(id) || DEFAULT_HAIR_COLOR;
}

export function hairColorForAssetPath(assetPath) {
  const fileName = String(assetPath || "").split("/").pop() || "";
  const id = fileName.replace(/_(?:st|bu|ct)_髪0\.png$/u, "");
  return hairColorForCharacter(id);
}
