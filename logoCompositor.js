const sharp = require('sharp');
const axios = require('axios');
const { EVENT_DISPLAY_TZ } = require('./config');
const { parseMatchupTeams, pickTeamLogo, pickLeagueLogo } = require('./eventLogos');

// Event artwork for Plex.
//
// Two shapes, because Plex uses two frames and cropping one to fit the other is
// what made the old art unreadable:
//   poster (2:3)  - the programme <icon>; Plex's program detail scales art to
//                   FILL a portrait frame, so a landscape source lost both
//                   crests and half the time text to the crop.
//   thumb (5:3)   - the channel <icon> / tvg-logo, rendered small in the guide's
//                   channel column.
//
// Crests are resolved here from (league, name) rather than being passed in as
// URLs, so an event in a league we have no crest table for still gets legible
// artwork instead of an empty tvg-logo.

const FORMATS = {
  poster: { w: 600, h: 900 },
  thumb: { w: 500, h: 300 },
};
const DEFAULT_FMT = 'poster';

const BG_TOP = '#1b2530';
const BG_BOTTOM = '#080b10';
const FG = '#f2f5f8';
const MUTED = '#9fb0c0';
const FONT = 'Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const OPAQUE_BG = { r: 8, g: 11, b: 16, alpha: 1 };

// A busy day is ~400 events, each with a thumb and a poster, so size the cache
// to hold a full guide rather than thrash through it (~50 KB/entry, ~40 MB at
// the cap). Crest downloads are cached separately and shared across every
// poster/thumb that uses the same team.
const MAX_ART_CACHE = 800;
const MAX_CREST_CACHE = 300;
const artCache = new Map();
const crestCache = new Map();

function cachePut(map, key, value, cap) {
  if (map.size >= cap) map.delete(map.keys().next().value);
  map.set(key, value);
}

async function fetchImageBuffer(url) {
  if (crestCache.has(url)) return crestCache.get(url);
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
  const buf = Buffer.from(res.data);
  cachePut(crestCache, url, buf, MAX_CREST_CACHE);
  return buf;
}

// A crest that won't download must not fail the whole render — the layout falls
// back to the team name as text.
async function tryFetch(url) {
  if (!url) return null;
  try {
    return await fetchImageBuffer(url);
  } catch (e) {
    console.error(`[art] crest ${url}: ${e.message}`);
    return null;
  }
}

function formatTime(startSec) {
  if (!startSec) return '';
  return new Date(startSec * 1000).toLocaleString('en-US', {
    timeZone: EVENT_DISPLAY_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Approximate advance width for bold sans. Only used to choose a font size that
// fits, so over-estimating is harmless (slightly smaller text) while
// under-estimating would overflow the canvas.
const CHAR_W = 0.58;
function textWidth(s, size) {
  return s.length * CHAR_W * size;
}

function wrapAt(text, maxWidth, size) {
  const words = String(text || '')
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function truncate(text, maxWidth, size) {
  let out = String(text || '');
  while (out.length > 1 && textWidth(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trim()}…`;
}

// Largest size (stepping down from max) at which the text wraps into maxLines or
// fewer. Falls back to min with the last line ellipsized.
function layoutText(text, { maxWidth, max, min, maxLines = 2 }) {
  const clean = String(text || '').trim();
  if (!clean) return { lines: [], size: min };
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapAt(clean, maxWidth, size);
    if (lines.length <= maxLines && lines.every(l => textWidth(l, size) <= maxWidth)) {
      return { lines, size };
    }
  }
  const lines = wrapAt(clean, maxWidth, min).slice(0, maxLines);
  const last = lines.length - 1;
  if (last >= 0 && textWidth(lines[last], min) > maxWidth) {
    lines[last] = truncate(lines[last], maxWidth, min);
  }
  return { lines, size: min };
}

function textNode(x, y, size, content, { fill = FG, weight = 'bold', spacing = 0 } = {}) {
  return (
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" ` +
    `fill="${fill}" letter-spacing="${spacing}" text-anchor="middle" ` +
    `dominant-baseline="middle">${esc(content)}</text>`
  );
}

// Centered, wrapped text block. `centerY` is the vertical middle of the block.
function textBlock(centerX, centerY, { lines, size }, opts = {}) {
  const lineHeight = size * 1.2;
  const top = centerY - ((lines.length - 1) * lineHeight) / 2;
  return lines.map((line, i) => textNode(centerX, top + i * lineHeight, size, line, opts)).join('');
}

function background(w, h) {
  return (
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${BG_TOP}"/>` +
    `<stop offset="100%" stop-color="${BG_BOTTOM}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>`
  );
}

async function fitInto(buf, w, h) {
  return sharp(buf).resize(w, h, { fit: 'contain', background: TRANSPARENT }).png().toBuffer();
}

// One side of a matchup: crest if we have one, else the team name as text.
async function planSide(crestBuf, label, box) {
  if (crestBuf) {
    try {
      const image = await fitInto(crestBuf, box.w, box.h);
      return { box, image: { input: image, left: box.left, top: box.top } };
    } catch (e) {
      console.error(`[art] crest resize: ${e.message}`);
    }
  }
  return {
    box,
    image: null,
    layout: layoutText(label, {
      maxWidth: box.w,
      max: Math.round(box.h / 4),
      min: 16,
      maxLines: 3,
    }),
    label,
  };
}

// Plan both sides, then even out the type: two team names fitted independently
// come out at different sizes and read as a mistake.
async function planSides(awayBuf, homeBuf, teams, boxA, boxB) {
  const away = await planSide(awayBuf, teams[0], boxA);
  const home = await planSide(homeBuf, teams[1], boxB);
  if (!away.image && !home.image) {
    const size = Math.min(away.layout.size, home.layout.size);
    away.layout = { lines: wrapAt(away.label, boxA.w, size), size };
    home.layout = { lines: wrapAt(home.label, boxB.w, size), size };
  }
  return [away, home];
}

function sideSvg(side) {
  if (side.image) return '';
  return textBlock(side.box.left + side.box.w / 2, side.box.top + side.box.h / 2, side.layout);
}

async function renderPoster({ leagueLabel, leagueBuf, teams, awayBuf, homeBuf, title, timeStr }) {
  const { w, h } = FORMATS.poster;
  const maxWidth = w - 72;
  const images = [];
  let svg = background(w, h);

  // League band
  if (leagueBuf) {
    try {
      images.push({ input: await fitInto(leagueBuf, 240, 84), left: (w - 240) / 2, top: 40 });
    } catch (e) {
      console.error(`[art] league mark: ${e.message}`);
    }
  }
  if (!images.length && leagueLabel) {
    svg += textBlock(
      w / 2,
      82,
      layoutText(leagueLabel.toUpperCase(), { maxWidth, max: 44, min: 22, maxLines: 2 }),
      { fill: MUTED, spacing: 2 },
    );
  }

  if (teams) {
    const [away, home] = await planSides(
      awayBuf,
      homeBuf,
      teams,
      { left: 170, top: 158, w: 260, h: 260 },
      { left: 170, top: 486, w: 260, h: 260 },
    );
    if (away.image) images.push(away.image);
    if (home.image) images.push(home.image);
    svg += sideSvg(away) + sideSvg(home);
    svg += textNode(w / 2, 452, 46, 'VS', { fill: MUTED, spacing: 4 });

    // The written-out matchup only earns its space when both sides are crests —
    // a side already rendered as text would just be repeating itself.
    if (away.image && home.image) {
      const matchup = layoutText(`${teams[0]} vs ${teams[1]}`, {
        maxWidth,
        max: 40,
        min: 22,
        maxLines: 2,
      });
      svg += textBlock(w / 2, matchup.lines.length > 1 ? 800 : 806, matchup);
      if (timeStr) svg += textNode(w / 2, 858, 30, timeStr, { fill: MUTED, weight: 'normal' });
    } else if (timeStr) {
      svg += textNode(w / 2, 812, 32, timeStr, { fill: MUTED, weight: 'normal' });
    }
  } else {
    // Not a matchup (tournament session, race, card): the title carries the
    // meaning, so give it the middle of the poster.
    svg += textBlock(w / 2, 460, layoutText(title, { maxWidth, max: 54, min: 24, maxLines: 5 }));
    if (timeStr) svg += textNode(w / 2, 800, 32, timeStr, { fill: MUTED, weight: 'normal' });
  }

  return { svg, images };
}

async function renderThumb({ leagueLabel, teams, awayBuf, homeBuf, title, timeStr }) {
  const { w, h } = FORMATS.thumb;
  const maxWidth = w - 40;
  const images = [];
  let svg = background(w, h);

  if (leagueLabel) {
    svg += textNode(w / 2, 36, 24, leagueLabel.toUpperCase(), { fill: MUTED, spacing: 2 });
  }

  if (teams) {
    const [away, home] = await planSides(
      awayBuf,
      homeBuf,
      teams,
      { left: 20, top: 80, w: 190, h: 180 },
      { left: 290, top: 80, w: 190, h: 180 },
    );
    if (away.image) images.push(away.image);
    if (home.image) images.push(home.image);
    svg += sideSvg(away) + sideSvg(home);
    svg += textNode(w / 2, 170, 30, 'vs', { fill: MUTED });
  } else {
    svg += textBlock(w / 2, 165, layoutText(title, { maxWidth, max: 40, min: 18, maxLines: 4 }));
  }

  // No time text: the guide already shows the slot, and it was the first thing
  // to get clipped when Plex cropped the old composite.
  if (timeStr && !teams) {
    // A bare title can leave the bottom empty; the start time fills it usefully.
    svg += textNode(w / 2, 272, 22, timeStr, { fill: MUTED, weight: 'normal' });
  }

  return { svg, images };
}

async function compose(fmt, { svg, images }) {
  const { w, h } = FORMATS[fmt];
  return sharp({ create: { width: w, height: h, channels: 4, background: OPAQUE_BG } })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`,
        ),
        left: 0,
        top: 0,
      },
      ...images,
    ])
    .png()
    .toBuffer();
}

// Main entry point. `league` and `name` are the normalized display strings the
// aggregator already emits, so the same values that appear in the guide drive
// the artwork.
async function renderEventArt({ league, name, startSec, fmt = DEFAULT_FMT } = {}) {
  const format = FORMATS[fmt] ? fmt : DEFAULT_FMT;
  const key = `${format}|${league || ''}|${name || ''}|${startSec ?? ''}`;
  if (artCache.has(key)) return artCache.get(key);

  const teams = parseMatchupTeams(name);
  const timeStr = formatTime(startSec);
  const [awayBuf, homeBuf, leagueBuf] = await Promise.all([
    teams ? tryFetch(pickTeamLogo({ league, team: teams[0] })) : null,
    teams ? tryFetch(pickTeamLogo({ league, team: teams[1] })) : null,
    format === 'poster' ? tryFetch(pickLeagueLogo(league)) : null,
  ]);

  const ctx = {
    leagueLabel: league || '',
    leagueBuf,
    teams,
    awayBuf,
    homeBuf,
    // Drop the "@ <time>" suffix — the time gets its own line.
    title: String(name || '')
      .split('@')[0]
      .trim(),
    timeStr,
  };

  const parts = format === 'poster' ? await renderPoster(ctx) : await renderThumb(ctx);
  const out = await compose(format, parts);
  cachePut(artCache, key, out, MAX_ART_CACHE);
  return out;
}

// Back-compat for /logo/split, whose a=<url>&b=<url> URLs are still stored on
// Dispatcharr channel rows created before the semantic endpoint existed.
async function buildSplitLogo(urlA, urlB, startSec) {
  const key = `split|${urlA}|${urlB}|${startSec ?? ''}`;
  if (artCache.has(key)) return artCache.get(key);

  const [awayBuf, homeBuf] = await Promise.all([tryFetch(urlA), tryFetch(urlB)]);
  const parts = await renderThumb({
    leagueLabel: '',
    teams: ['', ''],
    awayBuf,
    homeBuf,
    title: '',
    timeStr: formatTime(startSec),
  });
  const out = await compose('thumb', parts);
  cachePut(artCache, key, out, MAX_ART_CACHE);
  return out;
}

module.exports = { renderEventArt, buildSplitLogo, FORMATS };
