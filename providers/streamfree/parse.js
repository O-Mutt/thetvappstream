const { formatEventSuffix } = require('../daddylive/parse');

const QUALITY_HEIGHT = { SD: 480, HD: 720, FHD: 1080, '4K': 2160 };

// The listing gives no end time. Per-category defaults, matching the
// LEAGUE_DURATION_MIN values the other providers use for the same sports.
const CATEGORY_DURATION_MIN = {
  soccer: 135,
  basketball: 150,
  hockey: 150,
  baseball: 210,
  football: 210,
  combat: 240,
  racing: 180,
  tennis: 180,
  cricket: 240,
};
const DEFAULT_DURATION_MIN = 180;

// StreamFree's own category ids. "football" is the NFL here, while dlhd and
// PPV use the same word for soccer.
const CATEGORY_SPORT = {
  soccer: 'soccer',
  basketball: 'basketball',
  hockey: 'hockey',
  baseball: 'baseball',
  football: 'american-football',
  combat: 'combat',
  racing: 'motorsport',
  tennis: 'tennis',
  cricket: 'cricket',
};

// Refs carry their own kind so one resolveStream handles both:
//   v:{category}/{variant}     one source, e.g. v:soccer/ghana-vs-england1080p2
//   k:{category}/{stream_key}  whatever source is live for the stream right now
function variantRef(category, variant) {
  return `v:${category}/${variant}`;
}

function keyRef(category, streamKey) {
  return `k:${category}/${streamKey}`;
}

function parseRef(ref) {
  const m = /^([vk]):([^/]+)\/(.+)$/.exec(String(ref || ''));
  if (!m) return null;
  return { kind: m[1] === 'v' ? 'variant' : 'key', category: m[2], id: m[3] };
}

function qualityHeight(label) {
  if (label == null) return null;
  const s = String(label).trim();
  if (QUALITY_HEIGHT[s.toUpperCase()]) return QUALITY_HEIGHT[s.toUpperCase()];
  const m = /^(\d{3,4})p$/i.exec(s);
  return m ? Number(m[1]) : null;
}

// "https://strmfree.st/embed/soccer/ghana-vs-england1080p2" -> { category, variant }
function parseEmbedUrl(url) {
  const m = /\/embed\/([^/?#]+)\/([^/?#]+)/.exec(String(url || ''));
  return m ? { category: m[1], variant: m[2] } : null;
}

function sourceRefs(stream) {
  const out = [];
  for (const src of Array.isArray(stream.sources) ? stream.sources : []) {
    const parsed = parseEmbedUrl(src && src.url);
    if (!parsed) continue;
    const height = qualityHeight(src.quality);
    const ref = variantRef(parsed.category, parsed.variant);
    out.push(height ? { ref, quality: { height } } : ref);
  }
  return out;
}

// 24/7 channels (RedZone, Sky Sports Tennis, Willow) sit in the same listing as
// games. Their match_timestamp is the day the operator created them, months
// back, and their id is a UUID rather than the stream key that auto-created
// games reuse. Requiring both keeps a stale game that was never cleaned up
// from turning into a permanent channel.
function isChannel(stream, nowSec, channelAgeHours) {
  const ts = Number(stream.match_timestamp);
  const old = Number.isFinite(ts) && ts < nowSec - channelAgeHours * 3600;
  return old && stream.id != null && stream.id !== stream.stream_key;
}

// /api/v1/streams -> { events, channels } in the Provider contract shapes.
function parseStreams(
  json,
  {
    nowSec = Math.floor(Date.now() / 1000),
    graceMin = 45,
    maxAheadHours = 36,
    channelAgeHours = 24,
    displayTz,
  } = {},
) {
  const events = [];
  const channels = [];
  const streams = json && Array.isArray(json.streams) ? json.streams : [];
  for (const s of streams) {
    if (!s || !s.stream_key || !s.category || !s.name) continue;

    if (isChannel(s, nowSec, channelAgeHours)) {
      channels.push({ name: s.name, ref: keyRef(s.category, s.stream_key), group: 'Sports' });
      continue;
    }

    const startSec = Number(s.match_timestamp);
    if (!Number.isFinite(startSec) || startSec <= 0) continue;
    const durMin = CATEGORY_DURATION_MIN[s.category] || DEFAULT_DURATION_MIN;
    const endSec = startSec + durMin * 60;
    if (endSec < nowSec - graceMin * 60) continue;
    if (startSec > nowSec + maxAheadHours * 3600) continue;

    // Games are listed before StreamFree attaches a source, often until close
    // to kickoff. The key ref looks up whatever is live at tune time, so the
    // channel works even if no listing refresh lands between then and the game.
    const refs = sourceRefs(s);
    if (refs.length === 0) refs.push(keyRef(s.category, s.stream_key));

    events.push({
      league: s.league || s.category,
      category: s.category,
      sport: CATEGORY_SPORT[s.category] || 'other',
      name: `${s.name} @ ${formatEventSuffix(startSec, displayTz)}`,
      startSec,
      endSec,
      streamRef: refs[0],
      altStreamRefs: refs.slice(1),
    });
  }
  return { events, channels };
}

// The embed page inlines one token set per quality as `const _0x = {...};`.
// Tokens expire (`_e`) about 8 h after the page is served.
const TOKENS_RE = /const\s+_0x\s*=\s*(\{[\s\S]*?\})\s*;/;
const QUALITY_RE = /const\s+QUALITY\s*=\s*['"]([^'"]+)['"]/;
const STREAM_KEY_RE = /\/get-stream-key\/([^'"`?\s)]+)/;

function parseEmbed(html, variant) {
  const text = String(html || '');
  let tokens = null;
  const tm = TOKENS_RE.exec(text);
  if (tm) {
    try {
      tokens = JSON.parse(tm[1]);
    } catch {
      tokens = null;
    }
  }
  const qm = QUALITY_RE.exec(text);
  const fromVariant = /(\d{3,4}p)\d*$/.exec(String(variant || ''));
  const quality = qm ? qm[1] : fromVariant ? fromVariant[1] : null;
  const km = STREAM_KEY_RE.exec(text);
  const streamKey = km
    ? decodeURIComponent(km[1])
    : String(variant || '').replace(/\d{3,4}p\d*$/, '') || null;
  return { tokens, quality, streamKey };
}

// Same mapping as the site's own player (getStreamSource in the embed page).
function playlistPath(serverName, variant) {
  const name = serverName || 'origin';
  if (name === 'externalcdn') return `/live-externalcdn/${variant}/index.m3u8`;
  if (name !== 'origin') return `/live-cdn/${variant}/index.m3u8`;
  return `/live/${variant}/index.m3u8`;
}

function tokenQuery(t) {
  if (!t) return '';
  const v = x => encodeURIComponent(x == null ? '' : String(x));
  return `?_t=${v(t._t)}&_ta=${v(t._ta)}&_e=${v(t._e)}&_n=${v(t._n)}&_s=${v(t._s)}&_sa=${v(t._sa)}`;
}

module.exports = {
  QUALITY_HEIGHT,
  variantRef,
  keyRef,
  parseRef,
  qualityHeight,
  parseEmbedUrl,
  parseStreams,
  parseEmbed,
  playlistPath,
  tokenQuery,
};
