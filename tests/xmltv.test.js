const test = require('node:test');
const assert = require('node:assert');
const { buildXmltv, formatXmltvTime } = require('../ChannelManager');

test('formatXmltvTime emits XMLTV-spec UTC format', () => {
  // 2026-04-25 14:30:47 UTC == unix 1777127447 -- spot check a known value.
  assert.strictEqual(formatXmltvTime(1777127447), '20260425143047 +0000');
});

test('formatXmltvTime zero-pads single-digit fields', () => {
  // 2026-01-02 03:04:05 UTC
  const unix = Date.UTC(2026, 0, 2, 3, 4, 5) / 1000;
  assert.strictEqual(formatXmltvTime(unix), '20260102030405 +0000');
});

test('buildXmltv produces a valid skeleton even with no programmes', () => {
  const channels = [{ chid: 'CNN', name: 'CNN' }];
  const { xml, programmeCount } = buildXmltv(channels, {});
  assert.strictEqual(programmeCount, 0);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<tv generator-info-name="thetvappstream">/);
  assert.match(xml, /<channel id="CNN"><display-name>CNN<\/display-name><\/channel>/);
  assert.match(xml, /<\/tv>\s*$/);
});

test('buildXmltv emits programmes with correct attributes and counts', () => {
  const channels = [{ chid: 'AEEast', name: 'A&E' }];
  const programmes = {
    AEEast: [
      { title: 'Show A', startTime: 1777127447, endTime: 1777131047, episodeTitle: null },
      { title: "Women's Show", startTime: 1777131047, endTime: 1777134647, episodeTitle: 'Pilot' },
    ],
  };
  const { xml, programmeCount } = buildXmltv(channels, programmes);
  assert.strictEqual(programmeCount, 2);
  // ampersand in display-name is escaped
  assert.match(xml, /<display-name>A&amp;E<\/display-name>/);
  // programme attrs render with formatted times
  assert.match(
    xml,
    /<programme channel="AEEast" start="20260425143047 \+0000" stop="20260425153047 \+0000">/,
  );
  // sub-title only appears when episodeTitle is truthy
  assert.match(xml, /<sub-title>Pilot<\/sub-title>/);
  // apostrophe in title is XML-escaped
  assert.match(xml, /<title>Women&apos;s Show<\/title>/);
});

test('buildXmltv skips programmes with missing required fields', () => {
  const channels = [{ chid: 'X', name: 'X' }];
  const programmes = {
    X: [
      { title: '', startTime: 1, endTime: 2 }, // empty title -> skip
      { title: 'No end', startTime: 1 }, // no endTime -> skip
      { title: 'Good', startTime: 100, endTime: 200 }, // keep
      null, // null entry -> skip
    ],
  };
  const { programmeCount } = buildXmltv(channels, programmes);
  assert.strictEqual(programmeCount, 1);
});
