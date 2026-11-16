const zlib = require('zlib');
const sharp = require('sharp');

// Some dlhd CDNs host HLS segments on image CDNs (TikTok's) by packing them into
// the pixel data of a valid PNG: the raw RGB bytes are "TIKTIKPX", a big-endian
// uint32 length, then a gzip stream whose payload is the MPEG-TS segment. The
// browser player unwraps this in JS; ffmpeg/Dispatcharr just see an image.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PIXEL_MAGIC = Buffer.from('TIKTIKPX');
const HEADER_BYTES = PIXEL_MAGIC.length + 4;

function isPng(buf) {
  return buf.length >= PNG_SIGNATURE.length && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

// StreamFree's TikTok copies use a second wrapper: a 1x1 PNG whose private
// "tsDa" chunk holds the MPEG-TS segment verbatim. Returns that chunk, or null.
function extractTsChunk(buf) {
  let o = PNG_SIGNATURE.length;
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const start = o + 8;
    if (start + len > buf.length) return null;
    if (type === 'tsDa') return buf.subarray(start, start + len);
    if (type === 'IEND') return null;
    o = start + len + 4;
  }
  return null;
}

// Returns the MPEG-TS payload of a pixel-packed PNG segment, or null when `buf`
// is not one (a real image, or some other wrapper), so the caller relays it as-is.
async function unwrapPixelSegment(buf) {
  if (!isPng(buf)) return null;
  const chunk = extractTsChunk(buf);
  if (chunk) return chunk;
  const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  if (data.length < HEADER_BYTES || !data.subarray(0, 8).equals(PIXEL_MAGIC)) return null;
  const len = data.readUInt32BE(PIXEL_MAGIC.length);
  if (HEADER_BYTES + len > data.length) {
    throw new Error(
      `pixel segment declares ${len} bytes, image holds ${data.length - HEADER_BYTES}`,
    );
  }
  return zlib.gunzipSync(data.subarray(HEADER_BYTES, HEADER_BYTES + len));
}

module.exports = { unwrapPixelSegment, extractTsChunk, isPng, PIXEL_MAGIC };
