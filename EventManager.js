const cheerio = require('cheerio');
const { parseChannelPage, runWithConcurrency } = require('./ChannelManager');

const SPORT_PATHS = ['/mlb', '/nhl', '/nfl', '/nba', '/ncaaf', '/ncaab', '/soccer', '/ppv'];

const LEAGUE_BY_PATH = {
  '/mlb': 'MLB',
  '/nhl': 'NHL',
  '/nfl': 'NFL',
  '/nba': 'NBA',
  '/ncaaf': 'NCAAF',
  '/ncaab': 'NCAAB',
  '/soccer': 'Soccer',
  '/ppv': 'PPV',
};

const LEAGUE_DURATION_MIN = {
  MLB: 210,
  NFL: 210,
  NCAAF: 210,
  PPV: 180,
  NHL: 150,
  NBA: 150,
  NCAAB: 150,
  Soccer: 135,
};

// Drop events whose end time is more than this many minutes in the past.
const STALE_AFTER_MIN = 30;

function parseSportIndex(html, leaguePath) {
  const league = LEAGUE_BY_PATH[leaguePath] || leaguePath;
  const $ = cheerio.load(html);
  const out = [];
  $('a.list-group-item').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.startsWith('/event/')) return;

    const isoText = $(el).find('span').first().text().trim();
    const startMs = isoText ? Date.parse(isoText) : NaN;
    if (!Number.isFinite(startMs)) return;

    // The visible label is "Team A vs Team B @ Apr 25 3:00 PM <span>ISO</span>".
    // Strip the trailing span content so the name reads cleanly.
    let name = $(el).clone().find('span').remove().end().text();
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return;

    out.push({ href, name, startSec: Math.floor(startMs / 1000), league });
  });
  return out;
}

class EventManager {
  constructor(channelManager) {
    this.channelManager = channelManager;
    this.events = [];
    this.lastRefresh = 0;
    this.refreshing = null;
  }

  async refreshEvents() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      await this.channelManager.ensureSession();
      const nowSec = Math.floor(Date.now() / 1000);

      const allListings = [];
      for (const path of SPORT_PATHS) {
        try {
          const r = await this.channelManager.getWithRetry(path);
          if (r.status !== 200) {
            console.error(`[events] ${path} -> ${r.status}`);
            continue;
          }
          const listings = parseSportIndex(r.data || '', path);
          for (const e of listings) allListings.push(e);
        } catch (e) {
          console.error(`[events] ${path}: ${e.message}`);
        }
      }

      // Dedupe by href — a single event slug only needs one fetch.
      const byHref = new Map();
      for (const e of allListings) {
        if (!byHref.has(e.href)) byHref.set(e.href, e);
      }

      const fresh = [...byHref.values()].filter(e => {
        const durSec = (LEAGUE_DURATION_MIN[e.league] || 180) * 60;
        return e.startSec + durSec >= nowSec - STALE_AFTER_MIN * 60;
      });

      const events = [];
      await runWithConcurrency(fresh, 4, async listing => {
        try {
          const r = await this.channelManager.getWithRetry(listing.href);
          if (r.status !== 200) {
            console.error(`[events] ${listing.href} -> ${r.status}`);
            return;
          }
          const { chid } = parseChannelPage(r.data || '');
          if (!chid) return;
          const durSec = (LEAGUE_DURATION_MIN[listing.league] || 180) * 60;
          events.push({
            name: listing.name,
            chid,
            league: listing.league,
            startSec: listing.startSec,
            endSec: listing.startSec + durSec,
          });
        } catch (e) {
          console.error(`[events] ${listing.href}: ${e.message}`);
        }
      });

      events.sort((a, b) => a.startSec - b.startSec || a.name.localeCompare(b.name));
      this.events = events;
      this.lastRefresh = Date.now();
      console.log(
        `[events] refreshed: ${events.length} events across ${SPORT_PATHS.length} leagues`,
      );
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  listEvents() {
    return this.events;
  }

  // XMLTV fragment for ChannelManager.refreshEpg() to merge in.
  getEpgFragment() {
    const items = [];
    const programmesByChid = {};
    const seenChids = new Set();
    for (const e of this.events) {
      // Multiple events can resolve to the same slot chid throughout the day;
      // keep the soonest-starting one for the EPG so we don't double-list it.
      if (seenChids.has(e.chid)) {
        programmesByChid[e.chid].push({
          title: `${e.league}: ${e.name}`,
          startTime: e.startSec,
          endTime: e.endSec,
        });
        continue;
      }
      seenChids.add(e.chid);
      items.push({ name: `${e.league}: ${e.name}`, chid: e.chid });
      programmesByChid[e.chid] = [
        { title: `${e.league}: ${e.name}`, startTime: e.startSec, endTime: e.endSec },
      ];
    }
    return { items, programmesByChid };
  }
}

module.exports = EventManager;
module.exports.EventManager = EventManager;
module.exports.parseSportIndex = parseSportIndex;
module.exports.SPORT_PATHS = SPORT_PATHS;
module.exports.LEAGUE_BY_PATH = LEAGUE_BY_PATH;
module.exports.LEAGUE_DURATION_MIN = LEAGUE_DURATION_MIN;
