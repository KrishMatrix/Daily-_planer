// Renders the app icon SVG into the PNG sizes required by the web manifest and iOS.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const icon = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="url(#g)"/>
  <g transform="translate(256 262) scale(${pad ? 0.62 : 0.78}) translate(-256 -256)" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
    <rect x="96" y="112" width="320" height="300" rx="56"/>
    <path d="M96 196h320M184 72v76M328 72v76"/>
    <path d="m186 300 46 46 96-96"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon.svg", icon(false));
const jobs = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(icon(pad))).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log("wrote", name);
}
await sharp(Buffer.from(icon(false))).resize(48, 48).png().toFile("src/app/icon.png");
