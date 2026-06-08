const test = require('node:test');
const assert = require('node:assert');
const Aggregator = require('../Aggregator');

// In-memory provider so the aggregator can be exercised without network or the
// thetvapp.to scrapers.
class FakeProvider {
  constructor(
    name,
    { linear = {}, events = [], epg = { items: [], programmesByChid: {} }, failRefs = [] } = {},
  ) {
    this._name = name;
    this.linear = linear;
    this.events = events;
    this.epg = epg;
    this.failRefs = new Set(failRefs);
    this.resolved = [];
  }
  get name() {
    return this._name;
  }
  async ensureReady() {}
  async refreshEvents() {}
  async listLinearChannels() {
    return this.linear;
  }
  async listEvents() {
    return this.events;
  }
  async getEpgData() {
    return this.epg;
  }
  async resolveStream(ref) {
    this.resolved.push(ref);
    if (this.failRefs.has(ref)) throw new Error(`fail ${ref}`);
    return { url: `http://stream/${this._name}/${ref}` };
  }
}

const START = Date.parse('2026-05-22T23:10:00Z') / 1000;
const END = START + 3 * 3600;

function gameEvent(name, streamRef) {
  return { league: 'MLB', name, startSec: START, endSec: END, streamRef };
}

test('getM3u emits linear + event rows with provider-scoped stream urls', async () => {
  const p = new FakeProvider('thetvapp', {
    linear: { CNN: '101', ESPN: '102' },
    events: [gameEvent('Minnesota Twins vs Boston Red Sox @ May 22 7:10 PM', 'slot9')],
  });
  const agg = new Aggregator([p]);
  const m3u = await agg.getM3u('https://proxy.example.com');

  assert.match(m3u, /^#EXTM3U/);
  assert.match(m3u, /group-title="Live TV", CNN/);
  assert.match(m3u, /https:\/\/proxy\.example\.com\/channel\/thetvapp%3A101/);
  assert.match(m3u, /group-title="MLB", Minnesota Twins vs Boston Red Sox @ May 22 7:10 PM/);
});

test('linear stream ids resolve back to the owning provider', async () => {
  const p = new FakeProvider('thetvapp', { linear: { CNN: '101' } });
  const agg = new Aggregator([p]);
  await agg.listM3uEntries();
  const { url } = await agg.resolveStream('thetvapp:101');
  assert.strictEqual(url, 'http://stream/thetvapp/101');
});

test('same game from two providers dedupes to one entry with ordered fallback', async () => {
  const a = new FakeProvider('thetvapp', {
    events: [gameEvent('Minnesota Twins vs Boston Red Sox @ May 22 7:10 PM', 'tva')],
  });
  const b = new FakeProvider('streameast', {
    events: [gameEvent('Boston Red Sox vs Minnesota Twins @ May 22 7:10 PM', 'sea')],
  });
  const agg = new Aggregator([a, b]);

  const { eventEntries } = await agg.listM3uEntries();
  assert.strictEqual(eventEntries.length, 1);

  const sources = agg.streamIndex.get(eventEntries[0].streamId);
  assert.deepStrictEqual(
    sources.map(s => s.providerName),
    ['thetvapp', 'streameast'],
  );
});

test('resolveStream falls through to the next source when the first fails', async () => {
  const a = new FakeProvider('thetvapp', {
    events: [gameEvent('Minnesota Twins vs Boston Red Sox @ May 22 7:10 PM', 'tva')],
    failRefs: ['tva'],
  });
  const b = new FakeProvider('streameast', {
    events: [gameEvent('Boston Red Sox vs Minnesota Twins @ May 22 7:10 PM', 'sea')],
  });
  const agg = new Aggregator([a, b]);
  const { eventEntries } = await agg.listM3uEntries();

  const { url } = await agg.resolveStream(eventEntries[0].streamId);
  assert.strictEqual(url, 'http://stream/streameast/sea');
  assert.deepStrictEqual(a.resolved, ['tva']); // first source was attempted
});

test('resolveStream throws for an unknown id', async () => {
  const agg = new Aggregator([new FakeProvider('thetvapp')]);
  await agg.listM3uEntries();
  await assert.rejects(() => agg.resolveStream('nope'), /unknown stream id/);
});

test('refreshEpg merges linear guides and synthesizes event programmes', async () => {
  const p = new FakeProvider('thetvapp', {
    events: [gameEvent('Twins vs Red Sox @ May 22 7:10 PM', 'slot9')],
    epg: {
      items: [{ name: 'CNN', chid: '101', logo: null }],
      programmesByChid: { 101: [{ title: 'News', startTime: START, endTime: END }] },
    },
  });
  const agg = new Aggregator([p]);
  await agg.refreshEpg();
  const xml = agg.getEpgXml();

  assert.match(xml, /<channel id="101"><display-name>CNN<\/display-name>/);
  assert.match(xml, /<title>News<\/title>/);
  // event folded in under its canonical id with "<league>: <name>" title
  assert.match(xml, /<title>MLB: Twins vs Red Sox @ May 22 7:10 PM<\/title>/);
});

test('an empty provider set yields a bare playlist and no epg', async () => {
  const agg = new Aggregator([]);
  assert.strictEqual(await agg.getM3u('https://x'), '#EXTM3U');
  await agg.refreshEpg();
  assert.match(agg.getEpgXml(), /<tv generator-info-name="thetvappstream">/);
});
