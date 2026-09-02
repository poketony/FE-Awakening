import { splitConversationFrames } from "./format.js";

const ASSET_ROOT = "./assets/awakening/";
const TEXT_COLOR = "rgb(68, 8, 0)";
const NAME_COLOR = "rgb(253, 234, 177)";
const HAIR_COLOR = [0x5b, 0x58, 0x55];
const NO_PARAM = ["$Wa", "$Wc", "$Nu", "$N0", "$N1", "$t0", "$t1", "$Wv", "$Wd", "$k", "$p", "$a"];
const ONE_PARAM = ["$VNMPID", "$Sbs", "$Sve", "$Svj", "$Svp", "$Sre", "$Ssp", "$Fw", "$Ws", "$VF", "$Fo", "$Fi", "$E", "$b", "$w", "$l"];
const TWO_PARAM = ["$Sbv", "$Sbp", "$Sls", "$Slp"];

function uint16(view, offset) {
  return offset + 1 < view.byteLength ? view.getUint16(offset, true) : 0;
}

function signedByte(value) {
  return value > 0x7f ? value - 0x100 : value;
}

function cloneCharacter(character) {
  return { name: character.name, emotion: character.emotion, flip: character.flip };
}

function createState(playerName, playerGender) {
  return {
    type: 1,
    typeSet: false,
    charA: { name: "", emotion: "通常,", flip: true },
    charB: { name: "", emotion: "通常,", flip: false },
    active: null,
    activeName: "",
    topMessage: "",
    bottomMessage: "",
    textColor: TEXT_COLOR,
    playerName,
    playerGender,
    unknownCodes: new Set(),
  };
}

export class AwakeningRenderer {
  constructor() {
    this.images = new Map();
    this.glyphs = new Map();
    this.recolored = new Map();
    this.fontCharacters = new Map();
    this.faceData = new Map();
    this.pidNames = new Map();
    this.ready = false;
  }

  async initialize() {
    const [charsBuffer, facesBuffer, fidText, pidText, atlas0, atlas1] = await Promise.all([
      this.fetchBinary("bin/chars.bin"),
      this.fetchBinary("bin/faces.bin"),
      this.fetchText("txt/FID.txt"),
      this.fetchText("txt/xml/lang/en-us/PID.xml"),
      this.loadImage("img/Awakening_0.png"),
      this.loadImage("img/Awakening_1.png"),
    ]);
    this.atlases = [atlas0, atlas1];
    this.loadFontCharacters(charsBuffer);
    this.loadFaceData(facesBuffer, fidText);
    this.loadPidNames(pidText);
    this.ready = true;
  }

  async fetchBinary(relativePath) {
    const response = await fetch(new URL(relativePath, new URL(ASSET_ROOT, location.href)));
    if (!response.ok) throw new Error(`에셋을 불러오지 못했습니다: ${relativePath}`);
    return response.arrayBuffer();
  }

  async fetchText(relativePath) {
    const response = await fetch(new URL(relativePath, new URL(ASSET_ROOT, location.href)));
    if (!response.ok) throw new Error(`에셋을 불러오지 못했습니다: ${relativePath}`);
    return response.text();
  }

  loadImage(relativePath) {
    if (this.images.has(relativePath)) return this.images.get(relativePath);
    const promise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = new URL(relativePath, new URL(ASSET_ROOT, location.href)).href;
    });
    this.images.set(relativePath, promise);
    return promise;
  }

  loadFontCharacters(buffer) {
    const view = new DataView(buffer);
    for (let offset = 0; offset + 15 < view.byteLength; offset += 0x10) {
      const value = uint16(view, offset);
      this.fontCharacters.set(value, {
        value,
        atlas: uint16(view, offset + 2),
        x: uint16(view, offset + 4),
        y: uint16(view, offset + 6),
        width: view.getUint8(offset + 8),
        height: view.getUint8(offset + 9),
        cropHeight: signedByte(view.getUint8(offset + 0x0b)),
        cropWidth: signedByte(view.getUint8(offset + 0x0c)),
      });
    }
    const longDash = this.fontCharacters.get(8213);
    if (longDash) this.fontCharacters.set(8212, { ...longDash, value: 8212, cropHeight: longDash.cropHeight - 2 });
  }

  loadFaceData(buffer, fidText) {
    const bytes = new Uint8Array(buffer);
    const ids = fidText.split(/\r?\n/).filter(Boolean);
    ids.forEach((id, index) => {
      const start = index * 0x28;
      if (start + 0x28 <= bytes.length) this.faceData.set(id, new DataView(buffer, start, 0x28));
    });
  }

  loadPidNames(xmlText) {
    const document = new DOMParser().parseFromString(xmlText, "application/xml");
    for (const node of document.querySelectorAll("translation[name]")) {
      this.pidNames.set(node.getAttribute("name"), node.textContent ?? "");
    }
  }

  async render(value, canvas, options = {}) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.ready || !value) return { frameCount: value ? 1 : 0, diagnostics: [] };

    const frames = splitConversationFrames(value);
    const frameIndex = Math.max(0, Math.min(options.frameIndex ?? 0, frames.length - 1));
    const state = createState(options.playerName || "Robin", options.playerGender === "male" ? "male" : "female");
    const missing = new Set();
    let visibleMessage = "";
    for (let index = 0; index <= frameIndex; index += 1) {
      visibleMessage = this.parseFrame(frames[index], state);
      if (state.type === 0) {
        if (state.active === "A") state.topMessage = visibleMessage;
        else state.bottomMessage = visibleMessage;
      }
    }

    const nameMap = options.nameMap ?? new Map();
    await this.drawBackground(context);
    if (state.type === 0) await this.drawTypeZero(context, state, nameMap, missing);
    else await this.drawTypeOne(context, state, visibleMessage, nameMap, missing, frameIndex < frames.length - 1);

    const diagnostics = [
      ...[...missing].map((item) => ({ type: "asset", message: `누락 에셋(투명 처리): ${item}` })),
      ...[...state.unknownCodes].map((item) => ({ type: "code", message: `알 수 없는 제어코드(무시): ${item}` })),
    ];
    return { frameCount: frames.length, frameIndex, diagnostics, type: state.type };
  }

  parseFrame(source, state) {
    let output = "";
    for (let index = 0; index < source.length;) {
      if (source[index] === "\\" && source[index + 1] === "n") {
        output += "\n";
        index += 2;
        continue;
      }
      if (source[index] !== "$") {
        output += source[index];
        index += 1;
        continue;
      }
      const command = this.readCommand(source, index);
      if (!command) {
        output += source[index];
        index += 1;
        continue;
      }
      this.applyCommand(command, state, (inserted) => { output += inserted; });
      index += command.length;
    }
    return output;
  }

  readCommand(source, offset) {
    const rest = source.slice(offset);
    for (const code of NO_PARAM.sort((a, b) => b.length - a.length)) {
      if (rest.startsWith(code)) return { code, params: [], length: code.length };
    }
    if (rest.startsWith("$G")) {
      const end = rest.indexOf("|");
      const comma = rest.indexOf(",");
      if (end >= 0 && comma > 1 && comma < end) return { code: "$G", params: [rest.slice(2, comma), rest.slice(comma + 1, end)], length: end + 1 };
    }
    if (rest.startsWith("$c")) {
      const end = rest.indexOf("|");
      if (end >= 0) return { code: "$c", params: rest.slice(2, end).split(","), length: end + 1 };
    }
    if (rest.startsWith("$Wm")) {
      const end = rest.indexOf("|");
      if (end >= 0 && end + 1 < rest.length) return { code: "$Wm", params: [rest.slice(3, end), rest[end + 1]], length: end + 2 };
    }
    for (const code of TWO_PARAM.sort((a, b) => b.length - a.length)) {
      if (!rest.startsWith(code)) continue;
      const first = rest.indexOf("|");
      const second = first >= 0 ? rest.indexOf("|", first + 1) : -1;
      if (second >= 0) return { code, params: [rest.slice(code.length, first), rest.slice(first + 1, second)], length: second + 1 };
    }
    for (const code of ONE_PARAM.sort((a, b) => b.length - a.length)) {
      if (!rest.startsWith(code)) continue;
      const end = rest.indexOf("|");
      if (end >= 0) return { code, params: [rest.slice(code.length, end)], length: end + 1 };
    }
    const generic = rest.match(/^\$[A-Za-z][A-Za-z0-9]*/)?.[0];
    if (!generic) return null;
    const end = rest.indexOf("|");
    return { code: generic, params: [], length: end >= 0 ? end + 1 : generic.length, unknown: true };
  }

  applyCommand(command, state, insert) {
    const [param = ""] = command.params;
    switch (command.code) {
      case "$t0": state.type = state.typeSet ? state.type : 0; state.typeSet = true; break;
      case "$t1": state.type = state.typeSet ? state.type : 1; state.typeSet = true; break;
      case "$Wm": {
        const [name, position] = command.params;
        if ((state.type === 1 && position === "3") || (state.type === 0 && ["0", "2"].includes(position))) {
          state.charA.name = name; state.charA.emotion = "通常,";
        } else if ((state.type === 1 && position === "7") || (state.type === 0 && position === "6")) {
          state.charB.name = name; state.charB.emotion = "通常,";
        }
        break;
      }
      case "$Ws":
        if (state.charA.name === param) { state.active = "A"; state.activeName = param; }
        else if (state.charB.name === param) { state.active = "B"; state.activeName = param; }
        else { state.active = null; state.activeName = param; }
        break;
      case "$E": {
        const target = state.active === "B" ? state.charB : state.charA;
        target.emotion = param;
        break;
      }
      case "$Wd":
        if (state.active === "B") { state.active = "A"; state.activeName = state.charA.name; state.charB.name = ""; state.bottomMessage = ""; }
        else { state.active = "B"; state.activeName = state.charB.name; state.charA.name = ""; state.topMessage = ""; }
        break;
      case "$Nu": insert(state.playerName); break;
      case "$G": insert(command.params[state.playerGender === "female" ? 1 : 0] ?? ""); break;
      case "$c": {
        const rgba = command.params.map(Number);
        if (rgba.length >= 3 && rgba.slice(0, 3).every(Number.isFinite)) state.textColor = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(rgba[3] ?? 255) / 255})`;
        break;
      }
      default:
        if (command.unknown) state.unknownCodes.add(command.code);
        break;
    }
  }

  async drawBackground(context) {
    const image = await this.loadImage("img/SupportBG.png");
    if (image) context.drawImage(image, 0, 0);
  }

  async drawTypeOne(context, state, message, nameMap, missing, hasNext) {
    if (state.activeName) {
      if (state.active === "A") {
        await this.drawStage(context, state.charB, false, missing, state.playerGender);
        await this.drawStage(context, state.charA, true, missing, state.playerGender);
      } else {
        await this.drawStage(context, state.charA, false, missing, state.playerGender);
        await this.drawStage(context, state.charB, true, missing, state.playerGender);
      }
    } else {
      await this.drawStage(context, state.charA, false, missing, state.playerGender);
      await this.drawStage(context, state.charB, false, missing, state.playerGender);
    }

    const textBox = await this.loadImage("img/TextBox.png");
    const y = textBox ? 242 - textBox.height : 158;
    if (textBox) context.drawImage(textBox, 10, y);
    this.drawString(context, message, 39, y + 26, state.textColor, missing);
    if (hasNext) {
      const keyPress = await this.loadImage("img/KeyPress.png");
      if (keyPress) context.drawImage(keyPress, 367, 272 - (textBox?.height ?? 84));
    }

    if (state.activeName) {
      const active = state.active === "B" ? state.charB : state.charA;
      const nameBox = await this.loadImage("img/NameBox.png");
      if (nameBox) {
        const x = state.active === "B" ? 394 - nameBox.width - 30 : 37;
        const nameY = 226 - (textBox?.height ?? 84);
        context.drawImage(nameBox, x, nameY);
        const name = this.displayName(active.name || state.activeName, nameMap, state.playerName);
        this.drawString(context, name, x + nameBox.width / 2 - this.textLength(name) / 2, nameY + 16, NAME_COLOR, missing);
      }
    }
  }

  async drawTypeZero(context, state, nameMap, missing) {
    const [textBox, nameBox] = await Promise.all([this.loadImage("img/TextBox.png"), this.loadImage("img/NameBox.png")]);
    if (!textBox) return;
    if (state.topMessage) {
      const y = 20;
      context.drawImage(textBox, 10, y);
      await this.drawBust(context, state.charA, y, missing, state.playerGender);
      this.drawString(context, state.topMessage, 86, y + 26, state.textColor, missing);
      if (nameBox && state.charA.name) {
        const nameY = y - nameBox.height + 10;
        context.drawImage(nameBox, 76, nameY);
        const name = this.displayName(state.charA.name, nameMap, state.playerName);
        this.drawString(context, name, 76 + nameBox.width / 2 - this.textLength(name) / 2, nameY + 16, NAME_COLOR, missing);
      }
    }
    if (state.bottomMessage) {
      const y = 242 - textBox.height;
      context.drawImage(textBox, 10, y);
      await this.drawBust(context, state.charB, y, missing, state.playerGender);
      this.drawString(context, state.bottomMessage, 86, y + 26, state.textColor, missing);
      if (nameBox && state.charB.name) {
        const nameY = y - nameBox.height + 10;
        context.drawImage(nameBox, 76, nameY);
        const name = this.displayName(state.charB.name, nameMap, state.playerName);
        this.drawString(context, name, 76 + nameBox.width / 2 - this.textLength(name) / 2, nameY + 16, NAME_COLOR, missing);
      }
    }
  }

  assetCharacterName(name, playerGender) {
    if (name.startsWith("username")) {
      return playerGender === "male" ? "マイユニ_青年_顔立ちA" : "マイユニ_少女_顔立ちA";
    }
    return name === "ベロア" ? "べロア" : name;
  }

  displayName(name, nameMap, playerName) {
    if (name.startsWith("username")) return playerName;
    return nameMap.get(name) ?? this.pidNames.get(name) ?? name;
  }

  async drawStage(context, character, active, missing, playerGender) {
    if (!character.name) return;
    const name = this.assetCharacterName(character.name, playerGender);
    const [baseEmotion, modifiers = ""] = character.emotion.split(",");
    const path = `img/face/${name}_st_${baseEmotion || "通常"}.png`;
    const image = await this.loadImage(path);
    if (!image) { missing.add(path); return; }
    const x = character.flip ? 28 - image.width : 428 - image.width;
    const y = 254 - image.height;
    context.save();
    if (character.flip) context.scale(-1, 1);
    context.filter = active ? "none" : "brightness(55.7%)";
    context.drawImage(image, x, y);
    context.filter = "none";
    await this.drawEmotionOverlays(context, name, "st", modifiers, x, y, missing);
    const hairPath = `img/hair/${name}_st_髪0.png`;
    const hair = await this.loadImage(hairPath);
    if (hair) {
      const colored = this.recolorHair(hair, hairPath);
      context.filter = active ? "none" : "brightness(55.7%)";
      context.drawImage(colored, x, y);
      context.filter = "none";
    }
    context.restore();
  }

  async drawBust(context, character, drawY, missing, playerGender) {
    if (!character.name) return;
    const name = this.assetCharacterName(character.name, playerGender);
    const [baseEmotion, modifiers = ""] = character.emotion.split(",");
    const path = `img/face/${name}_bu_${baseEmotion || "通常"}.png`;
    const image = await this.loadImage(path);
    if (!image) { missing.add(path); return; }
    const data = this.faceData.get(`FSID_BU_${name}`);
    if (!data) { missing.add(`bin/faces.bin:FSID_BU_${name}`); return; }
    const sx = uint16(data, 0x10);
    const sy = uint16(data, 0x12);
    const sw = uint16(data, 0x14);
    const sh = uint16(data, 0x16);
    const x = -12 - sw;
    const y = character.flip ? 3 : drawY - 17;
    context.save();
    context.scale(-1, 1);
    context.drawImage(image, sx, sy, sw, sh, x, y, sw, sh);
    await this.drawEmotionOverlays(context, name, "bu", modifiers, x - sx, y - sy, missing);
    const hairPath = `img/hair/${name}_bu_髪0.png`;
    const hair = await this.loadImage(hairPath);
    if (hair) context.drawImage(this.recolorHair(hair, hairPath), sx, sy, sw, sh, x, y, sw, sh);
    context.restore();
  }

  async drawEmotionOverlays(context, name, mode, modifiers, baseX, baseY, missing) {
    const data = this.faceData.get(`FSID_${mode.toUpperCase()}_${name}`);
    if (!data || !modifiers) return;
    for (const modifier of [...modifiers]) {
      if (modifier !== "汗" && modifier !== "照") continue;
      const path = `img/face/${name}_${mode}_${modifier}.png`;
      const image = await this.loadImage(path);
      if (!image) { missing.add(path); continue; }
      const offset = modifier === "汗" ? 0x20 : 0x18;
      context.save();
      context.globalCompositeOperation = "multiply";
      context.drawImage(image, baseX + uint16(data, offset), baseY + uint16(data, offset + 2));
      context.restore();
    }
  }

  recolorHair(image, cacheKey) {
    if (this.recolored.has(cacheKey)) return this.recolored.get(cacheKey);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      if (!pixels.data[index + 3]) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const source = HAIR_COLOR[channel] / 255;
        const destination = pixels.data[index + channel] / 255;
        const value = destination < .5 ? 2 * source * destination : 1 - 2 * (1 - source) * (1 - destination);
        pixels.data[index + channel] = Math.max(0, Math.min(255, Math.round(value * 255)));
      }
    }
    context.putImageData(pixels, 0, 0);
    this.recolored.set(cacheKey, canvas);
    return canvas;
  }

  textLength(text) {
    let width = 0;
    for (const character of text) {
      const glyph = this.fontCharacters.get(character.codePointAt(0));
      width += glyph ? Math.max(glyph.width, glyph.cropWidth) : 8;
    }
    return width;
  }

  drawString(context, text, startX, startY, color, missing) {
    let x = startX;
    let y = startY;
    for (const character of text) {
      if (character === "\n") { y += 20; x = startX; continue; }
      const codePoint = character.codePointAt(0);
      const glyph = this.fontCharacters.get(codePoint);
      if (!glyph || !this.atlases[glyph.atlas]) {
        missing.add(`font:U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} ${character}`);
        x += 8;
        continue;
      }
      const colored = this.coloredGlyph(glyph, color);
      context.drawImage(colored, Math.round(x), Math.round(y - glyph.cropHeight));
      x += glyph.cropWidth;
    }
  }

  coloredGlyph(glyph, color) {
    const key = `${glyph.value}:${color}`;
    if (this.glyphs.has(key)) return this.glyphs.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = glyph.width;
    canvas.height = glyph.height;
    const context = canvas.getContext("2d");
    context.drawImage(this.atlases[glyph.atlas], glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, glyph.width, glyph.height);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, glyph.width, glyph.height);
    this.glyphs.set(key, canvas);
    return canvas;
  }
}

export { createState, cloneCharacter };
