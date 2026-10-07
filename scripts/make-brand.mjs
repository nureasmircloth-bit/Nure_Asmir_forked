// Builds every logo file the website uses from ONE master picture of the wordmark (white letters on a dark background).
//
//   node scripts/make-brand.mjs path/to/master-logo.jpg
//
// Writes: public/brand/wordmark-v2.png (dark letters, for light pages), public/brand/wordmark-light-v2.png (white letters, for dark areas),
// public/logo-icon.png + apple-touch-icon.png + logo.ico (the "N" on a dark square), public/logo.png and public/og.jpg (wordmark on dark).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source || !fs.existsSync(source)) {
  console.error("Give the path of the master logo picture, e.g. node scripts/make-brand.mjs logo.jpg");
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..");
const out = (...parts) => path.join(root, "public", ...parts);
const BG = { r: 34, g: 31, b: 32 }; // the dark of the master picture
const INK = { r: 27, g: 23, b: 20 }; // the shop's ink colour

// 1) turn "white on dark" into letters with a soft see-through edge
const { data, info } = await sharp(source).greyscale().raw().toBuffer({ resolveWithObject: true });
const floor = 40;
const alpha = Buffer.alloc(info.width * info.height);
for (let i = 0; i < alpha.length; i += 1) alpha[i] = Math.max(0, Math.min(255, Math.round(((data[i] - floor) / (255 - floor)) * 255)));

// 2) the box around the letters, and the box around the first letter (the "N")
let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
const columnInk = new Array(info.width).fill(0);
for (let y = 0; y < info.height; y += 1)
  for (let x = 0; x < info.width; x += 1)
    if (alpha[y * info.width + x] > 40) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      columnInk[x] += 1;
    }
let nEnd = minX;
while (nEnd < maxX && (columnInk[nEnd] > 0 || nEnd - minX < 20)) nEnd += 1; // first run of inked columns = the "N"

async function letters(color, box) {
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < alpha.length; i += 1) {
    rgba[i * 4] = color.r; rgba[i * 4 + 1] = color.g; rgba[i * 4 + 2] = color.b; rgba[i * 4 + 3] = alpha[i];
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).extract(box).png().toBuffer();
}

const pad = Math.round((maxY - minY) * 0.06);
const word = { left: minX - pad, top: minY - pad, width: maxX - minX + 1 + pad * 2, height: maxY - minY + 1 + pad * 2 };
const wordBox = {
  left: Math.max(0, word.left), top: Math.max(0, word.top),
  width: Math.min(info.width - Math.max(0, word.left), word.width), height: Math.min(info.height - Math.max(0, word.top), word.height),
};
const nBox = { left: Math.max(0, minX - pad), top: wordBox.top, width: nEnd - minX + pad * 2, height: wordBox.height };

fs.mkdirSync(out("brand"), { recursive: true });
const dark = await letters(INK, wordBox);
const light = await letters({ r: 255, g: 255, b: 255 }, wordBox);
fs.writeFileSync(out("brand", "wordmark-v2.png"), dark);
fs.writeFileSync(out("brand", "wordmark-light-v2.png"), light);
const meta = await sharp(dark).metadata();
console.log(`wordmark ${meta.width} × ${meta.height}`);

// 3) the square icon: the "N" in white on the dark square
async function square(size) {
  const n = await letters({ r: 255, g: 255, b: 255 }, nBox);
  const inner = Math.round(size * 0.62);
  const letter = await sharp(n).resize({ width: inner, height: inner, fit: "inside" }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: BG } }).composite([{ input: letter, gravity: "center" }]).png().toBuffer();
}
fs.writeFileSync(out("logo-icon.png"), await square(512));
fs.writeFileSync(out("apple-touch-icon.png"), await square(180));
const ico = await square(48);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header[6] = 48; header[7] = 48; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(ico.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(out("logo.ico"), Buffer.concat([header, ico]));

// 4) wide pictures: the wordmark on the dark background (share picture + logo for search engines)
async function wide(width, height, scale) {
  const w = Math.round(width * scale);
  const mark = await sharp(light).resize({ width: w }).toBuffer();
  return sharp({ create: { width, height, channels: 3, background: BG } }).composite([{ input: mark, gravity: "center" }]);
}
fs.writeFileSync(out("og.jpg"), await (await wide(1200, 630, 0.74)).jpeg({ quality: 90 }).toBuffer());
fs.writeFileSync(out("logo.png"), await (await wide(1200, 630, 0.74)).png().toBuffer());
console.log("brand files written");
