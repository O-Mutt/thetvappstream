// Pure HLS playlist work for playback sessions: read an upstream media
// playlist, pick one rendition from a master, and render the playlist this
// server serves, numbered so a switch to another source reads as one
// continuous live stream. See docs/design/playback-failover.md, section 3.

// Header tags describe the whole playlist; anything else written before a
// segment URI belongs to that segment.
const HEADER_TAG_RE =
  /^#(EXTM3U|EXT-X-VERSION|EXT-X-TARGETDURATION|EXT-X-MEDIA-SEQUENCE|EXT-X-DISCONTINUITY-SEQUENCE|EXT-X-PLAYLIST-TYPE|EXT-X-INDEPENDENT-SEGMENTS|EXT-X-START|EXT-X-ALLOW-CACHE|EXT-X-ENDLIST)\b/i;

function tagValue(lines, name) {
  const prefix = `#${name}:`;
  const line = lines.find(l => l.toUpperCase().startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

// Media playlist -> { version, targetDuration, mediaSequence, independent,
// endList, segments: [{ uri, tags, duration, discontinuity }] }, or null when
// the text is not a media playlist.
function parseMediaPlaylist(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length || !/^\uFEFF?#EXTM3U/.test(lines[0])) return null;
  if (lines.some(l => /^#EXT-X-STREAM-INF:/i.test(l))) return null;

  const header = lines.filter(l => HEADER_TAG_RE.test(l));
  const segments = [];
  let tags = [];
  let discontinuity = false;
  for (const line of lines) {
    if (HEADER_TAG_RE.test(line)) continue;
    if (/^#EXT-X-DISCONTINUITY$/i.test(line)) {
      discontinuity = true;
      continue;
    }
    if (line.startsWith('#')) {
      tags.push(line);
      continue;
    }
    const inf = tags.find(t => /^#EXTINF:/i.test(t));
    const duration = inf ? parseFloat(inf.slice(8)) || 0 : 0;
    segments.push({ uri: line, tags, duration, discontinuity });
    tags = [];
    discontinuity = false;
  }
  return {
    version: Number(tagValue(header, 'EXT-X-VERSION')) || null,
    targetDuration: Number(tagValue(header, 'EXT-X-TARGETDURATION')) || 0,
    mediaSequence: Number(tagValue(header, 'EXT-X-MEDIA-SEQUENCE')) || 0,
    independent: header.some(l => /^#EXT-X-INDEPENDENT-SEGMENTS/i.test(l)),
    endList: header.some(l => /^#EXT-X-ENDLIST/i.test(l)),
    segments,
  };
}

function attrs(line) {
  const out = {};
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/gi;
  let m;
  while ((m = re.exec(line))) out[m[1].toUpperCase()] = m[3] !== undefined ? m[3] : m[2];
  return out;
}

// Tallest rendition at or below this is preferred: Plex and Dispatcharr pull
// one rendition, and 4K costs bandwidth they mostly downscale anyway.
const PREFERRED_MAX_HEIGHT = 1080;

// Master playlist -> { url, height } for the rendition to serve,
// { separateAudio: true } when every usable rendition takes its audio from a
// separate playlist (which one flattened playlist cannot carry), or null when
// `text` is not a master.
function chooseRendition(text, masterUrl, minHeight = 0) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim());
  if (!lines.some(l => /^#EXT-X-STREAM-INF:/i.test(l))) return null;

  const audioWithUri = new Set(
    lines
      .filter(l => /^#EXT-X-MEDIA:/i.test(l))
      .map(attrs)
      .filter(a => /^AUDIO$/i.test(a.TYPE || '') && a.URI)
      .map(a => a['GROUP-ID']),
  );
  const all = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^#EXT-X-STREAM-INF:/i.test(lines[i])) continue;
    const uri = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
    if (!uri) continue;
    const a = attrs(lines[i]);
    const res = /^\d+x(\d+)$/i.exec(a.RESOLUTION || '');
    all.push({
      url: new URL(uri, masterUrl).href,
      height: res ? Number(res[1]) : null,
      bandwidth: Number(a.BANDWIDTH) || 0,
      separateAudio: !!(a.AUDIO && audioWithUri.has(a.AUDIO)),
    });
  }
  const usable = all.filter(c => !c.separateAudio);
  if (!usable.length) return all.length ? { separateAudio: true } : null;

  // Same order as source ranking: at or above the floor, then unstated
  // height, then known to be below the floor.
  let pool = usable;
  if (minHeight) {
    const tiers = [
      pool.filter(c => c.height && c.height >= minHeight),
      pool.filter(c => !c.height),
    ];
    pool = tiers.find(t => t.length) || pool;
  }
  const known = pool.filter(c => c.height);
  const capped = known.filter(c => c.height <= PREFERRED_MAX_HEIGHT);
  if (capped.length) pool = capped;
  else if (known.length) pool = known;
  pool.sort((a, b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth);
  return { url: pool[0].url, height: pool[0].height };
}

// Rewrite a segment's URI and any URI="..." in its tags (keys, init maps).
function mapSegmentUris(segment, mapUri) {
  return {
    ...segment,
    uri: mapUri(segment.uri),
    tags: segment.tags.map(t => t.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${mapUri(u)}"`)),
  };
}

// Render the served playlist from the upstream playlist and the session's
// numbering state. Mutates `state` ({ offset, lastSeq, discontinuities,
// discontinuitySeq }) as segments are numbered and slide out of the window.
function renderSession(playlist, state, mapUri) {
  const numbered = playlist.segments.map((s, i) => ({
    ...mapSegmentUris(s, mapUri),
    seq: playlist.mediaSequence + i + state.offset,
  }));
  for (const s of numbered) {
    if (s.discontinuity) state.discontinuities.add(s.seq);
  }
  const first = numbered.length ? numbered[0].seq : state.lastSeq + 1;
  for (const d of [...state.discontinuities]) {
    if (d < first) {
      state.discontinuities.delete(d);
      state.discontinuitySeq++;
    }
  }
  if (numbered.length) state.lastSeq = Math.max(state.lastSeq, numbered[numbered.length - 1].seq);

  const target = Math.max(
    playlist.targetDuration || 0,
    ...numbered.map(s => Math.ceil(s.duration || 0)),
    1,
  );
  const out = ['#EXTM3U'];
  if (playlist.version) out.push(`#EXT-X-VERSION:${playlist.version}`);
  out.push(`#EXT-X-TARGETDURATION:${target}`);
  out.push(`#EXT-X-MEDIA-SEQUENCE:${first}`);
  out.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${state.discontinuitySeq}`);
  if (playlist.independent) out.push('#EXT-X-INDEPENDENT-SEGMENTS');
  for (const s of numbered) {
    if (state.discontinuities.has(s.seq)) out.push('#EXT-X-DISCONTINUITY');
    out.push(...s.tags, s.uri);
  }
  return `${out.join('\n')}\n`;
}

// Number a new source's window so its first segment follows the last one
// served, and mark the join as a discontinuity.
function spliceOffset(playlist, state) {
  const firstNew = state.lastSeq + 1;
  state.offset = firstNew - playlist.mediaSequence;
  state.discontinuities.add(firstNew);
}

function lastUpstreamSeq(playlist) {
  return playlist.mediaSequence + playlist.segments.length - 1;
}

module.exports = {
  parseMediaPlaylist,
  chooseRendition,
  renderSession,
  spliceOffset,
  lastUpstreamSeq,
  PREFERRED_MAX_HEIGHT,
};
