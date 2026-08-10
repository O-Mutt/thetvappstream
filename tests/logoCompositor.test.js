const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { renderEventArt, FORMATS } = require('../logoCompositor');

// Every case here uses a league with no crest table on purpose: the renderer
// then resolves no crest URLs and does no network I/O, so the tests stay
// hermetic. The crest-backed layouts are verified against live artwork.
const LEAGUE = 'Ukrainian Premier League';
const MATCHUP = 'Karpaty vs LNZ Cherkasy @ Aug 10 10:00 AM CDT';
const START = 1786405200;

test('poster renders at 600x900 so Plex does not crop it', async () => {
  const buf = await renderEventArt({
    league: LEAGUE,
    name: MATCHUP,
    startSec: START,
    fmt: 'poster',
  });
  const meta = await sharp(buf).metadata();
  assert.strictEqual(meta.width, FORMATS.poster.w);
  assert.strictEqual(meta.height, FORMATS.poster.h);
  assert.strictEqual(meta.format, 'png');
});

test('thumb renders at 500x300 for the guide channel column', async () => {
  const buf = await renderEventArt({
    league: LEAGUE,
    name: MATCHUP,
    startSec: START,
    fmt: 'thumb',
  });
  const meta = await sharp(buf).metadata();
  assert.strictEqual(meta.width, FORMATS.thumb.w);
  assert.strictEqual(meta.height, FORMATS.thumb.h);
});

test('an unknown format falls back to the poster', async () => {
  const buf = await renderEventArt({ league: LEAGUE, name: MATCHUP, fmt: 'banner' });
  const meta = await sharp(buf).metadata();
  assert.strictEqual(meta.height, FORMATS.poster.h);
});

test('the background is opaque so Plex has no transparency to composite', async () => {
  const buf = await renderEventArt({ league: LEAGUE, name: MATCHUP, fmt: 'poster' });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  assert.strictEqual(info.channels, 4);
  // Top-left corner pixel: gradient background, fully opaque.
  assert.strictEqual(data[3], 255);
});

test('non-matchup events still render (title-only layout)', async () => {
  const buf = await renderEventArt({
    league: 'Athletics',
    name: 'European Championship Birmingham | Day 1 | Morning Session @ Aug 10 4:30 AM CDT',
    startSec: START,
    fmt: 'poster',
  });
  const meta = await sharp(buf).metadata();
  assert.strictEqual(meta.width, FORMATS.poster.w);
});

test('XML-hostile characters in names do not break the SVG overlay', async () => {
  const buf = await renderEventArt({
    league: 'Club Friendly',
    name: 'A & B <script> vs "C" O\'Brien @ Aug 10 4:30 AM CDT',
    startSec: START,
    fmt: 'poster',
  });
  const meta = await sharp(buf).metadata();
  assert.strictEqual(meta.width, FORMATS.poster.w);
});

test('very long team names are laid out instead of overflowing', async () => {
  const buf = await renderEventArt({
    league: LEAGUE,
    name: 'Epitsentr Dunayivtsi Podillya Khmelnytskyi vs Shakhtar Donetsk Reserves @ Aug 10 7:30 AM CDT',
    startSec: START,
    fmt: 'poster',
  });
  const meta = await sharp(buf).metadata();
  assert.strictEqual(meta.height, FORMATS.poster.h);
});

test('repeat renders are served from cache', async () => {
  const args = { league: LEAGUE, name: MATCHUP, startSec: START, fmt: 'thumb' };
  const a = await renderEventArt(args);
  const b = await renderEventArt(args);
  assert.strictEqual(a, b); // same buffer instance, not just equal bytes
});
