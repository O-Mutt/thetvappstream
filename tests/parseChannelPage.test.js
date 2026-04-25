const test = require('node:test');
const assert = require('node:assert');
const { parseChannelPage } = require('../ChannelManager');

test('parseChannelPage extracts chid and guideId from a typical channel page', () => {
  const html = `
    <!doctype html><html><body>
      <div id="stream_name" name="CNNUS"></div>
      <script>
        $(document).ready(function () {
          const jsonUrl = "https://thetvapp.to/json/9233008130.json";
        });
      </script>
    </body></html>`;
  assert.deepStrictEqual(parseChannelPage(html), { chid: 'CNNUS', guideId: '9233008130' });
});

test('parseChannelPage returns null fields when neither marker is present', () => {
  assert.deepStrictEqual(parseChannelPage('<html><body>nothing here</body></html>'), {
    chid: null,
    guideId: null,
  });
});

test('parseChannelPage handles chid without a guide URL (event/blocked pages)', () => {
  const html = '<div id="stream_name" name="ESPNU"></div>';
  assert.deepStrictEqual(parseChannelPage(html), { chid: 'ESPNU', guideId: null });
});

test('parseChannelPage handles guide URL without a chid', () => {
  const html = 'see https://thetvapp.to/json/9999.json for guide';
  assert.deepStrictEqual(parseChannelPage(html), { chid: null, guideId: '9999' });
});

test('parseChannelPage tolerates extra whitespace between div attributes', () => {
  const html = '<div id="stream_name"   name="AEEast"  class="hidden"></div>';
  assert.strictEqual(parseChannelPage(html).chid, 'AEEast');
});
