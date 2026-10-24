#!/usr/bin/env node
// Toolbar and store icons: ClauseWatch's blue rounded shield with two eyes, on a
// dark tile. The 128 px icon keeps 16 px of transparent margin (Chrome Web
// Store guidance). Regenerate with:
//   node scripts/make-icons.mjs public/icon docs/store
// The second folder gets store-only art (Edge's 300 px logo), kept out of the manifest.
import { chromium } from "playwright";
const [out, store] = process.argv.slice(2);
// The two eyes: plain bars at 16 px, where the hooks blur; spaced wider at
// 32 px, so thick round ends never touch.
const eyes = (size) => size <= 16
  ? `<path d="M 40 50 L 40 59"/><path d="M 60 50 L 60 59"/>`
  : size <= 32
  ? `<path d="M 38 58 L 38 51 Q 38 47 42 47 L 43 47"/><path d="M 57 58 L 57 51 Q 57 47 61 47 L 62 47"/>`
  : `<path d="M 40 58 L 40 51 Q 40 47 44 47 L 46 47"/><path d="M 54 58 L 54 51 Q 54 47 58 47 L 60 47"/>`;
const svg = (size) => {
  // Thicker lines as the icon shrinks, so the eyes stay readable at 16 px.
  const sw = size <= 16 ? 10 : size <= 32 ? 8 : 7;
  // 128 px: 96 px of art in the middle (a 12.5-unit margin on a 100-unit canvas).
  const view = size === 128 ? "-16.67 -16.67 133.33 133.33" : "0 0 100 100";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${size}" height="${size}">
<rect x="0.5" y="0.5" width="99" height="99" rx="19" fill="#05070a" stroke="#1d232d" stroke-width="${size <= 16 ? 0 : 1.5}"/>
<g fill="none" stroke="#2f80ff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
<path d="M 50 15 C 59 20 67 22 76 23 L 76 47 C 76 64 65 76 50 84 C 35 76 24 64 24 47 L 24 23 C 33 22 41 20 50 15 Z"/>
${eyes(size)}</g></svg>`;
};
const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [16, 32, 48, 128].map((size) => [size, `${out}/${size}.png`]);
if (store) jobs.push([300, `${store}/edge-logo-300.png`]);
for (const [size, path] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  await page.locator("svg").screenshot({ path, omitBackground: true });
}
await browser.close();
