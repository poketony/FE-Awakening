import { AwakeningRenderer } from "./renderer.js";
import { hairColorForAssetPath } from "./hair-colors.js";
import { KOREAN_NAME_MAP, cleanCharacterId, containsJapanese } from "./names-ko.js";

const ORIGINAL_RENDER = AwakeningRenderer.prototype.render;
const ORIGINAL_DISPLAY_NAME = AwakeningRenderer.prototype.displayName;

AwakeningRenderer.prototype.render = function renderWithKoreanNames(value, canvas, options = {}) {
  if (canvas?.id !== "koCanvas") return ORIGINAL_RENDER.call(this, value, canvas, options);

  const names = new Map(KOREAN_NAME_MAP);
  for (const [id, name] of options.nameMap ?? []) {
    if (name && !containsJapanese(name)) names.set(id, name);
  }
  return ORIGINAL_RENDER.call(this, value, canvas, {
    ...options,
    nameMap: names,
    playerName: options.playerName || "러플레",
  });
};

AwakeningRenderer.prototype.displayName = function displayKoreanNameAliases(name, nameMap, playerName) {
  const id = String(name || "");
  if (id.startsWith("username") || id.startsWith("プレイヤー")) return playerName || "러플레";
  const clean = cleanCharacterId(id);
  return nameMap?.get(id) ?? nameMap?.get(clean) ?? ORIGINAL_DISPLAY_NAME.call(this, clean || id, nameMap, playerName);
};

AwakeningRenderer.prototype.recolorHair = function recolorCanonicalHair(image, cacheKey) {
  const hairColor = hairColorForAssetPath(cacheKey);
  const coloredCacheKey = `${cacheKey}|${hairColor.join(",")}`;
  if (this.recolored.has(coloredCacheKey)) return this.recolored.get(coloredCacheKey);

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (!pixels.data[index + 3]) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const source = hairColor[channel] / 255;
      const destination = pixels.data[index + channel] / 255;
      const value = destination < .5 ? 2 * source * destination : 1 - 2 * (1 - source) * (1 - destination);
      pixels.data[index + channel] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
  }
  context.putImageData(pixels, 0, 0);
  this.recolored.set(coloredCacheKey, canvas);
  return canvas;
};

await import("./app.js");

const toolbarSave = document.querySelector("#saveFile");
const controls = document.querySelector(".myunit-controls");
if (toolbarSave && controls && !document.querySelector("#quickSaveFile")) {
  const quickSave = document.createElement("button");
  quickSave.id = "quickSaveFile";
  quickSave.type = "button";
  quickSave.className = "save";
  quickSave.textContent = "저장";
  quickSave.title = "현재 번역 파일 저장";
  quickSave.addEventListener("click", () => toolbarSave.click());

  const syncDisabled = () => { quickSave.disabled = toolbarSave.disabled; };
  syncDisabled();
  new MutationObserver(syncDisabled).observe(toolbarSave, { attributes: true, attributeFilter: ["disabled"] });
  controls.prepend(quickSave);
}

const playerName = document.querySelector("#playerName");
if (playerName && !localStorage.getItem("fe13-live:playerName") && playerName.value === "Robin") {
  playerName.value = "러플레";
  playerName.dispatchEvent(new Event("input", { bubbles: true }));
}
