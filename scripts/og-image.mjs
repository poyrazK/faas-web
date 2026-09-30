// Rebuild the 1200×630 social card with `npm run og`.
// The frozen glass artwork is generated once; text and the current logo are
// composed here so changes remain crisp, editable, and reproducible.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'node_modules', '.cache', 'og-fonts');
const out = join(root, 'public', 'og.png');

const FONTS = [
  ['Familjen Grotesk', 500],
  ['Familjen Grotesk', 400],
];

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
// Marketing ink and muted text from src/index.css. White matches the glass art.
const PAPER = '#ffffff';
const INK = '#0d1512';
const MUTED = '#55625c';
const MINT = '#00ce91';

// A quiet wind crest echoes the existing wave mark inside the glass horizon.
const WIND_PATHS = [
  'M431 583 C503 599 569 601 625 579 C660 565 671 544 694 542 C710 540 724 547 732 561 C708 551 696 560 696 574 C696 591 710 601 732 600 C761 599 790 587 813 569',
  'M421 603 C504 620 581 618 642 592 C660 584 676 572 687 561',
  'M459 622 C543 631 609 615 665 596 C699 584 724 581 751 584',
];

const [glass, logo, files] = await Promise.all([
  pngDataUrl('scripts/assets/og-glass.png'),
  pngDataUrl('public/logo.png'),
  fontFiles(),
]);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <!-- Lower the glass horizon to preserve the reference's generous white space. -->
  <image href="${glass}" x="0" y="54" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <defs>
    <linearGradient id="wind" gradientUnits="userSpaceOnUse" x1="421" y1="0" x2="813" y2="0">
      <stop offset="0" stop-color="${MINT}" stop-opacity="0"/>
      <stop offset="0.45" stop-color="${MINT}" stop-opacity="0.3"/>
      <stop offset="0.72" stop-color="${MINT}" stop-opacity="0.6"/>
      <stop offset="1" stop-color="${MINT}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="white" stroke-width="4" opacity="0.65">
      ${WIND_PATHS.map((d) => `<path d="${d}"/>`).join('')}
    </g>
    <g stroke="url(#wind)" stroke-width="1.8">
      ${WIND_PATHS.map((d) => `<path d="${d}"/>`).join('')}
    </g>
  </g>
  <image href="${logo}" x="528" y="44" width="144" height="55" preserveAspectRatio="xMidYMid meet"/>

  <g text-anchor="middle" font-family="Familjen Grotesk">
    <text font-weight="500" font-size="62" letter-spacing="-2.4" fill="${INK}">
      <tspan x="600" y="268">Build the API.</tspan>
      <tspan x="600" y="340">We’ll run it.</tspan>
    </text>
    <text x="600" y="392" font-weight="400" font-size="17" letter-spacing="0.1" fill="${MUTED}">Backend hosting · Public beta</text>
  </g>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: W },
  font: { fontFiles: files, loadSystemFonts: false, defaultFontFamily: 'Familjen Grotesk' },
});
const png = resvg.render().asPng();
await writeFile(out, png);
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)`);
