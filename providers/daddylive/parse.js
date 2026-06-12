const cheerio = require('cheerio');
const { EVENT_DISPLAY_TZ } = require('../../config');

// Pure parsing for DaddyLive (dlhd) inputs: the 24-7 channel index and the
// schedule JSON. No network or browser here so it stays deterministic and
// unit-testable; the provider wires these to a fetcher.

// DaddyLive schedule categories -> the league label our M3U group-title uses.
// The per-event "LEAGUE : matchup" prefix wins when present (more specific);
// this is the fallback when an event has no prefix.
const CATEGORY_LEAGUE = {
  soccer: 'Soccer',
  football: 'Soccer', // DaddyLive "Football" means association football
  'american football': 'NFL',
  basketball: 'NBA',
  baseball: 'MLB',
  'ice hockey': 'NHL',
  hockey: 'NHL',
  tennis: 'Tennis',
  cricket: 'Cricket',
  golf: 'Golf',
  motorsport: 'Motorsport',
  wrestling: 'Wrestling',
  boxing: 'Boxing',
  mma: 'MMA',
  fight: 'Fight',
  rugby: 'Rugby',
  'rugby league': 'Rugby',
  'rugby union': 'Rugby',
  'aussie rules': 'AFL',
  darts: 'Darts',
  snooker: 'Snooker',
};

// Rough broadcast windows (minutes) for synthesizing event end times.
const LEAGUE_DURATION_MIN = {
  MLB: 210,
  NFL: 210,
  NCAAF: 210,
  NBA: 150,
  NHL: 150,
  NCAAB: 150,
  Soccer: 135,
  Tennis: 180,
  Cricket: 240,
  Golf: 240,
  Motorsport: 180,
  Boxing: 180,
  MMA: 240,
  PPV: 240,
};
const DEFAULT_DURATION_MIN = 180;

function cleanLabel(s) {
  // Schedule keys arrive as "Soccer</span>" with escaped slashes.
  return String(s || '')
    .replace(/<\\?\/?span>/gi, '')
    .replace(/\\\//g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

// "<a href="/watch.php?id=51">CNN USA</a>" -> { "CNN USA": "51" }
function parseChannels(html) {
  const $ = cheerio.load(html || '');
  const out = {};
  $('a[href*="watch.php?id="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = /watch\.php\?id=(\d+)/.exec(href);
    if (!m) return;
    // dlhd renders the id into the link text ("ABC USA ID: 51"); drop it.
    const name = $(el)
      .text()
      .replace(/\s+/g, ' ')
      .replace(/\s*ID:\s*\d+\s*$/i, '')
      .trim();
    if (!name) return;
    // First occurrence wins; dlhd lists the same channel once.
    if (!out[name]) out[name] = m[1];
  });
  return out;
}

// Offset (ms) of `timeZone` from UTC at a given instant.
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = dtf.formatToParts(new Date(utcMs)).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUtc - utcMs;
}

// The UTC instant (seconds) for a wall-clock Y-M-D HH:MM in `timeZone`.
function zonedToUtcSec(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffsetMs(guess, timeZone);
  return Math.floor((guess - offset) / 1000);
}

function ymdInZone(utcSec, timeZone) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date(utcSec * 1000))
    .reduce((a, x) => ((a[x.type] = x.value), a), {});
  return { y: +p.year, m: +p.month, d: +p.day };
}

// Display time for the "@ <time>" suffix the Dispatcharr scheduler parses, e.g.
// "Jun 8 7:10 PM CDT". The trailing tz abbreviation is DST-accurate (CDT/CST)
// and sits past the AM/PM the scheduler's regex stops at, so it's label-only.
function formatEventSuffix(utcSec, timeZone = EVENT_DISPLAY_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(new Date(utcSec * 1000));
  const get = t => (parts.find(p => p.type === t) || {}).value || '';
  const tz = get('timeZoneName');
  return `${get('month')} ${get('day')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}${
    tz ? ' ' + tz : ''
  }`;
}

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

// Pull a calendar date out of a dlhd schedule day key, e.g.
// "Thursday 20th March 2025 - Schedule Time UK GMT" -> { y: 2025, m: 3, d: 20 }.
// Returns null when the key has no parseable date (some mirrors use bare labels
// like "Day" or a localized string we don't recognize).
function parseScheduleHeaderDate(dayKey) {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})/.exec(String(dayKey || ''));
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const d = Number(m[1]);
  const y = Number(m[3]);
  if (d < 1 || d > 31) return null;
  return { y, m: month, d };
}

// Whole-day signed drift (b - a) between two {y,m,d} dates, ignoring time.
function dayDrift(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

function leagueAndMatchup(eventStr, categoryLabel) {
  const str = String(eventStr || '').trim();
  const idx = str.indexOf(' : ');
  if (idx > 0) {
    return { league: str.slice(0, idx).trim(), matchup: str.slice(idx + 3).trim() };
  }
  const league = CATEGORY_LEAGUE[categoryLabel.toLowerCase()] || categoryLabel;
  return { league, matchup: str };
}

// Parse the schedule JSON into normalized events. Event times carry no date, so
// they're interpreted as TODAY in the schedule's timezone and anything outside
// the relevance window is dropped.
//
// Freshness gate: a frozen mirror (dlhd has served a March-2025 schedule for
// months) would otherwise have its year-old fixtures relabeled as live "today".
// When a day key carries a parseable date that drifts more than `maxStaleDays`
// from today, that whole day is rejected and `onStaleDay` is notified — the
// provider then contributes nothing rather than faking a guide full of phantom
// games. Unparseable headers fall through to the relabel-to-today path, since
// some mirrors genuinely mislabel an otherwise-current schedule.
//
// opts: { nowSec, scheduleTz='Europe/London', graceMin=45, maxAheadHours=36,
//         maxStaleDays=2, skipCategories=[/tv shows/i], onStaleDay=null }
function parseSchedule(scheduleJson, opts = {}) {
  const {
    nowSec = Math.floor(Date.now() / 1000),
    scheduleTz = 'Europe/London',
    graceMin = 45,
    maxAheadHours = 36,
    maxStaleDays = 2,
    skipCategories = [/tv shows/i, /tv channels/i],
    onStaleDay = null,
    displayTz = EVENT_DISPLAY_TZ,
  } = opts;

  const today = ymdInZone(nowSec, scheduleTz);
  const events = [];

  for (const dayKey of Object.keys(scheduleJson || {})) {
    const headerDate = parseScheduleHeaderDate(dayKey);
    if (headerDate) {
      const driftDays = dayDrift(today, headerDate);
      if (Math.abs(driftDays) > maxStaleDays) {
        if (onStaleDay) onStaleDay({ dayKey, headerDate, today, driftDays });
        continue;
      }
    }

    const categories = scheduleJson[dayKey] || {};
    for (const catKey of Object.keys(categories)) {
      const category = cleanLabel(catKey);
      if (skipCategories.some(re => re.test(category))) continue;

      const list = Array.isArray(categories[catKey]) ? categories[catKey] : [];
      for (const ev of list) {
        const hhmm = /^(\d{1,2}):(\d{2})$/.exec(String(ev.time || '').trim());
        if (!hhmm) continue;
        const startSec = zonedToUtcSec(today.y, today.m, today.d, +hhmm[1], +hhmm[2], scheduleTz);

        const { league, matchup } = leagueAndMatchup(ev.event, category);
        if (!matchup) continue;

        const durMin = LEAGUE_DURATION_MIN[league] || DEFAULT_DURATION_MIN;
        const endSec = startSec + durMin * 60;

        // Relevance window: not long over, not absurdly far out.
        if (endSec < nowSec - graceMin * 60) continue;
        if (startSec > nowSec + maxAheadHours * 3600) continue;

        const channels = [...(ev.channels || []), ...(ev.channels2 || [])]
          .map(c => c && c.channel_id != null && String(c.channel_id))
          .filter(Boolean);
        if (channels.length === 0) continue;

        events.push({
          league,
          name: `${matchup} @ ${formatEventSuffix(startSec, displayTz)}`,
          startSec,
          endSec,
          streamRef: channels[0], // primary feed; extra feeds are fallback-eligible
          channelIds: channels,
        });
      }
    }
  }

  events.sort((a, b) => a.startSec - b.startSec || a.name.localeCompare(b.name));
  return events;
}

module.exports = {
  parseChannels,
  parseSchedule,
  parseScheduleHeaderDate,
  leagueAndMatchup,
  cleanLabel,
  zonedToUtcSec,
  formatEventSuffix,
  CATEGORY_LEAGUE,
  LEAGUE_DURATION_MIN,
};
