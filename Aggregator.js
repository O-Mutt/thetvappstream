const { buildXmltv } = require('./ChannelManager');
const { getChannelLogos } = require('./utils');
const { canonicalKey, canonicalEventId } = require('./canonicalName');
const { pickEventLogo, pickMatchupLogos } = require('./eventLogos');

// Fans the M3U/EPG/stream surface out across N providers:
//   - linear channels are namespaced per provider (id `${provider}:${ref}`)
//   - events are deduped by cross-provider canonical identity, keeping an
//     ordered source list so a dead link at record time falls through to the
//     next provider
//   - EPG folds every provider's linear guide together with synthesized event
//     programmes, all keyed to the same ids the M3U emits
//
// Downstream (Dispatcharr/Plex) never sees provider boundaries: one channel per
// game, league as the group-title, "@ <time>" preserved in the name. That's
// what keeps the recording scheduler provider-agnostic.
class Aggregator {
  constructor(providers) {
    this.providers = providers || [];
    this._providerByName = new Map(this.providers.map(p => [p.name, p]));
    this.streamIndex = new Map(); // publicId -> [{ providerName, ref }]
    this.epgXml = null;
    this.epgLastRefresh = 0;
    this.epgRefreshing = null;
  }

  async ensureReady() {
    await Promise.all(
      this.providers.map(p =>
        p.ensureReady().catch(e => console.error(`[${p.name}] ensureReady: ${e.message}`)),
      ),
    );
  }

  async refreshEvents() {
    await Promise.all(
      this.providers.map(p =>
        p.refreshEvents().catch(e => console.error(`[${p.name}] refreshEvents: ${e.message}`)),
      ),
    );
  }

  // Collect every provider's events and collapse same-game duplicates. Each
  // returned entry carries the ordered fallback `sources`.
  async _dedupeEvents() {
    const byKey = new Map();
    for (const p of this.providers) {
      let events = [];
      try {
        events = await p.listEvents();
      } catch (e) {
        console.error(`[${p.name}] listEvents: ${e.message}`);
      }
      for (const ev of events) {
        if (!ev || !ev.streamRef) continue;
        const key = canonicalKey(ev);
        let bucket = byKey.get(key);
        if (!bucket) {
          const matchup = pickMatchupLogos({ league: ev.league, name: ev.name });
          bucket = {
            id: canonicalEventId(ev),
            name: ev.name,
            league: ev.league,
            logo: ev.logo || (matchup ? matchup.away : null) || pickEventLogo({ league: ev.league, name: ev.name }) || '',
            awayLogo: matchup ? matchup.away : null,
            homeLogo: matchup ? matchup.home : null,
            startSec: ev.startSec,
            endSec: ev.endSec,
            sources: [],
          };
          byKey.set(key, bucket);
        }
        bucket.sources.push({ providerName: p.name, ref: ev.streamRef });
      }
    }
    return [...byKey.values()].sort(
      (a, b) => (a.startSec || 0) - (b.startSec || 0) || a.name.localeCompare(b.name),
    );
  }

  // Build merged M3U rows and (re)populate the stream index that resolveStream
  // reads. Returns { linearEntries, eventEntries } for formatting/tests.
  async listM3uEntries(base = '') {
    const index = new Map();
    const logos = await getChannelLogos().catch(() => ({ channels: [] }));
    const logoByName = new Map(
      (logos.channels || []).filter(c => c?.name && c?.logo).map(c => [c.name, c.logo]),
    );

    const linearEntries = [];
    for (const p of this.providers) {
      let channels = {};
      try {
        channels = await p.listLinearChannels();
      } catch (e) {
        console.error(`[${p.name}] listLinearChannels: ${e.message}`);
      }
      for (const [name, ref] of Object.entries(channels || {})) {
        const streamId = `${p.name}:${ref}`;
        index.set(streamId, [{ providerName: p.name, ref }]);
        linearEntries.push({
          tvgId: streamId,
          name,
          group: 'Live TV',
          logo: logoByName.get(name) || '',
          streamId,
        });
      }
    }

    const eventEntries = (await this._dedupeEvents()).map(ev => {
      let logo = ev.logo;
      if (base && ev.awayLogo && ev.homeLogo) {
        logo = `${base}/logo/split?a=${encodeURIComponent(ev.awayLogo)}&b=${encodeURIComponent(ev.homeLogo)}`;
      }
      index.set(ev.id, ev.sources);
      return {
        tvgId: ev.id,
        name: ev.name,
        group: ev.league,
        logo,
        streamId: ev.id,
        startSec: ev.startSec,
      };
    });

    this.streamIndex = index;
    return { linearEntries, eventEntries };
  }

  async getM3u(base) {
    const { linearEntries, eventEntries } = await this.listM3uEntries(base);
    let chno = 0;
    let m3u = '#EXTM3U';
    for (const e of [...linearEntries, ...eventEntries]) {
      chno++;
      m3u +=
        `\n#EXTINF:-1 tvg-id="${e.tvgId}" tvg-chno="${chno}" tvg-logo="${e.logo}" group-title="${e.group}", ${e.name}` +
        `\n${base}/channel/${encodeURIComponent(e.streamId)}`;
    }
    return m3u;
  }

  async refreshEpg() {
    if (this.epgRefreshing) return this.epgRefreshing;
    this.epgRefreshing = (async () => {
      const allItems = [];
      const allProgrammes = {};

      for (const p of this.providers) {
        let data = { items: [], programmesByChid: {} };
        try {
          data = await p.getEpgData();
        } catch (e) {
          console.error(`[${p.name}] getEpgData: ${e.message}`);
        }
        // Namespace linear guide ids to match the `${provider}:${ref}` tvg-ids
        // listM3uEntries emits, so Plex pairs each channel with its guide.
        for (const it of data.items || []) {
          allItems.push({ ...it, chid: `${p.name}:${it.chid}` });
        }
        for (const [chid, progs] of Object.entries(data.programmesByChid || {})) {
          allProgrammes[`${p.name}:${chid}`] = progs;
        }
      }

      // Synthesize one programme per deduped event, keyed to the same id the
      // M3U emits so Plex pairs the row with its guide entry.
      for (const ev of await this._dedupeEvents()) {
        const title = `${ev.league}: ${ev.name}`;
        allItems.push({ name: title, chid: ev.id, logo: ev.logo || null });
        // Tag as Sports (+ the league) so Plex categorizes these in its Sports
        // hub with the right artwork/metadata.
        const categories = [...new Set(['Sports', ev.league].filter(Boolean))];
        allProgrammes[ev.id] = [{ title, startTime: ev.startSec, endTime: ev.endSec, categories }];
      }

      const { xml, programmeCount } = buildXmltv(allItems, allProgrammes);
      this.epgXml = xml;
      this.epgLastRefresh = Date.now();
      console.log(`[epg] refreshed: ${allItems.length} channels, ${programmeCount} programmes`);
    })();
    try {
      await this.epgRefreshing;
    } finally {
      this.epgRefreshing = null;
    }
  }

  getEpgXml() {
    return this.epgXml;
  }

  async resolveStream(publicId) {
    const sources = this.streamIndex.get(publicId);
    if (!sources || sources.length === 0) throw new Error(`unknown stream id: ${publicId}`);
    let lastErr;
    for (const { providerName, ref } of sources) {
      const provider = this._providerByName.get(providerName);
      if (!provider) continue;
      try {
        const res = await provider.resolveStream(ref);
        if (res && res.url) return res;
      } catch (e) {
        lastErr = e;
        console.error(`[${providerName}] resolveStream(${ref}): ${e.message}`);
      }
    }
    throw lastErr || new Error(`no source resolved for ${publicId}`);
  }
}

module.exports = Aggregator;
