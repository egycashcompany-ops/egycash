// Cut a tall PNG into N parts for looking at (no image library here): load it in chromium, shoot clips.
//   node crop.mjs <png> <parts> <outPrefix>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright-core');
const [file, partsArg, prefix] = process.argv.slice(2);
const parts = Number(partsArg);
const data = readFileSync(file).toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.setContent(`<body style="margin:0"><img id="i" src="data:image/png;base64,${data}"></body>`);
await page.waitForFunction(() => document.getElementById('i').complete);
const { w, h } = await page.evaluate(() => ({ w: document.getElementById('i').naturalWidth, h: document.getElementById('i').naturalHeight }));
await page.setViewportSize({ width: w, height: Math.ceil(h / parts) });
for (let i = 0; i < parts; i += 1) {
  const top = Math.floor((i * h) / parts);
  await page.screenshot({ path: `${prefix}${i}.png`, clip: { x: 0, y: top, width: w, height: Math.ceil(h / parts) }, fullPage: true });
}
console.log(w, h);
await browser.close();
