const sharp = require('sharp');
const axios = require('axios');

const SIZE = 200;
const HALF = SIZE / 2;
const MAX_CACHE = 500;
const cache = new Map();

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function fetchImageBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
  return Buffer.from(res.data);
}

async function buildSplitLogo(urlA, urlB) {
  const key = `${urlA}|${urlB}`;
  if (cache.has(key)) return cache.get(key);

  const [bufA, bufB] = await Promise.all([fetchImageBuffer(urlA), fetchImageBuffer(urlB)]);

  const [halfA, halfB] = await Promise.all([
    sharp(bufA).resize(HALF, SIZE, { fit: 'contain', background: TRANSPARENT }).png().toBuffer(),
    sharp(bufB).resize(HALF, SIZE, { fit: 'contain', background: TRANSPARENT }).png().toBuffer(),
  ]);

  const result = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: TRANSPARENT },
  })
    .composite([
      { input: halfA, left: 0, top: 0 },
      { input: halfB, left: HALF, top: 0 },
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
