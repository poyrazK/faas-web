// Rebuild the 1200×630 social card with `npm run og`.
// A cropped wind silhouette, typography, and the current logo are composed here so
// the whole card remains crisp, editable, and reproducible.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'node_modules', '.cache', 'og-fonts');
const out = join(root, 'public', 'og.png');

const FONTS = [['Familjen Grotesk', 400]];

async function fontFiles() {
  await mkdir(cache, { recursive: true });
  const files = [];
  for (const [family, weight] of FONTS) {
    const path = join(cache, `${family.replaceAll(' ', '')}-${weight}.ttf`);
    try {
      await access(path);
    } catch {
      // resvg needs static instances rather than the site's variable fonts.
      const api = `https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@${weight}`;
      const cssRes = await fetch(api, { headers: { 'User-Agent': 'curl/8' } });
      if (!cssRes.ok)
        throw new Error(`font css fetch failed: ${family} ${weight} (${cssRes.status})`);
      const url = (await cssRes.text()).match(/url\((https:[^)]+\.ttf)\)/)?.[1];
      if (!url) throw new Error(`no static ttf offered for ${family} ${weight}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`font fetch failed: ${family} ${weight} (${res.status})`);
      await writeFile(path, Buffer.from(await res.arrayBuffer()));
    }
    files.push(path);
  }
  return files;
}

async function pngDataUrl(path) {
  return `data:image/png;base64,${(await readFile(join(root, path))).toString('base64')}`;
}

const W = 1200;
const H = 630;
// Paper, marketing ink, and mint step 7 from src/index.css.
const PAPER = '#ffffff';
const INK = '#0d1512';
const MINT = '#51deaa';

const [logo, files] = await Promise.all([pngDataUrl('public/logo.png'), fontFiles()]);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <defs>
    <filter id="mint-logo" color-interpolation-filters="sRGB">
      <feFlood flood-color="${MINT}"/>
      <feComposite in2="SourceAlpha" operator="in"/>
    </filter>
  </defs>
  <!-- Two solid contours form one oversized crest, separated by clean white space. -->
  <g fill="${MINT}">
    <path d="M48 630 C154 470 365 350 550 351 C658 351 754 386 838 430 C760 417 690 426 627 459 C561 493 503 559 477 630 Z"/>
    <path d="M559 624 C579 526 673 451 786 450 C919 447 992 472 1151 430 C1097 535 1012 590 906 606 C781 627 696 548 559 624 Z"/>
  </g>
  <image href="${logo}" x="496" y="39" width="208" height="78" preserveAspectRatio="xMidYMid meet" filter="url(#mint-logo)"/>

  <g text-anchor="middle" font-family="Familjen Grotesk">
    <text font-weight="400" font-size="70" letter-spacing="-2.1" fill="${INK}">
      <tspan x="600" y="223">Build the API.</tspan>
      <tspan x="600" y="290">We’ll run it.</tspan>
    </text>
  </g>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: W },
  font: { fontFiles: files, loadSystemFonts: false, defaultFontFamily: 'Familjen Grotesk' },
});
const png = resvg.render().asPng();
await writeFile(out, png);
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)`);
