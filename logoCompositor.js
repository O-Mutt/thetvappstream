const sharp = require('sharp');
const axios = require('axios');

const W = 300;
const H = 150;
const LOGO_W = 120;
const LOGO_H = 110;
const RIGHT_X = W - LOGO_W; // 180 — left edge of home logo
const VS_X = W / 2; // 150 — center of gap between logos
const VS_Y = LOGO_H / 2; // 55 — vertically centered in logo band
const TIME_Y = LOGO_H + (H - LOGO_H) / 2 + 7; // ~127 — center of time band

const MAX_CACHE = 500;
const cache = new Map();
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function fetchImageBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
  return Buffer.from(res.data);
}

function formatTime(startSec) {
  if (!startSec) return '';
  return new Date(startSec * 1000).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function textNode(x, y, size, content) {
  return `<text
    x="${x}" y="${y}"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${size}"
    font-weight="bold"
    fill="white"
    stroke="rgba(0,0,0,0.75)"
    stroke-width="2"
    paint-order="stroke"
    text-anchor="middle"
    dominant-baseline="middle">${content}</text>`;
}

async function buildSplitLogo(urlA, urlB, startSec) {
  const key = `${urlA}|${urlB}|${startSec ?? ''}`;
  if (cache.has(key)) return cache.get(key);

  const [bufA, bufB] = await Promise.all([fetchImageBuffer(urlA), fetchImageBuffer(urlB)]);

  const [logoA, logoB] = await Promise.all([
    sharp(bufA)
      .resize(LOGO_W, LOGO_H, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toBuffer(),
    sharp(bufB)
      .resize(LOGO_W, LOGO_H, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toBuffer(),
  ]);

  const timeStr = formatTime(startSec);
  const svgOverlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      ${textNode(VS_X, VS_Y, 20, 'vs')}
      ${timeStr ? textNode(W / 2, TIME_Y, 21, timeStr) : ''}
    </svg>`,
  );

  const result = await sharp({
    create: { width: W, height: H, channels: 4, background: TRANSPARENT },
  })
    .composite([
      { input: logoA, left: 0, top: 0 },
      { input: logoB, left: RIGHT_X, top: 0 },
      { input: svgOverlay, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  if (cache.size >= MAX_CACHE) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, result);
  return result;
}

module.exports = { buildSplitLogo };
