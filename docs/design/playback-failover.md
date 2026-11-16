# Playback failover

Status: draft, 2026-11-16. Issue #45. Answers open question 4 of
[stream-sources-and-ranking.md](stream-sources-and-ranking.md).

## Goal

When the source a viewer is watching dies mid-game, the channel keeps playing
from the next ranked source without the viewer re-tuning. The switch costs a
short skip, not a dropped stream.

## Non-goals

- Failover for non-HLS streams (continuous MPEG-TS relayed by
  `hls.passthrough`). There are no playlist reloads to hook into.
- Failover inside a single segment request. A failed segment is retried by
  the player; a dead source is detected on the next playlist reload.
- Adaptive bitrate. Plex and Dispatcharr pull one rendition and transcode or
  remux it themselves.

## Current behavior

`GET /channel/:id` resolves a source once (`Aggregator.resolveStream`), then:

- **Stream needs no headers:** `302` to the upstream URL. If the master lists
  renditions below `MIN_VIDEO_HEIGHT`, the filtered master is served instead,
  with absolute upstream URIs (`serveFilteredMaster`). Either way, the player
  then reloads the upstream directly.
- **Stream needs headers:** the manifest is rewritten so every URI goes
  through `/hlsseg/:id?u=<upstream>`. The player reloads the variant playlist
  through `/hlsseg`, which only relays it.

In both cases the player's reloads never come back to `/channel/:id`. When
the source stops, reloads fail or stall, and playback ends.

## Requirements

| ID  | Requirement                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | A playlist reload that finds the source failed, stalled or ended switches to the next ranked source within that reload.                |
| F2  | The player sees one continuous live playlist: media sequence numbers never go backwards, and each switch is marked as a discontinuity. |
| F3  | The failed source is recorded with the ranker, so it is tried last until its cooldown passes.                                          |
| F4  | Segments of streams that need no headers still go straight from the upstream to the player.                                            |
| F5  | Streams that cannot be served as one media playlist keep today's behavior.                                                             |
| F6  | `PLAYBACK_FAILOVER=false` restores today's behavior entirely.                                                                          |

## Design

### 1. Session playlist

For an HLS stream, `/channel/:id` returns a **media playlist built by this
server**, not a redirect and not a master playlist. A live media playlist is
reloaded at the URL the player fetched it from, so every reload comes back to
`/channel/:id`, where the source can be checked and replaced.

- **Rendition:** when the source returns a master playlist, one rendition is
  chosen: the tallest at or below 1080 lines, else the tallest; ties go to the
  higher `BANDWIDTH`. Renditions below `MIN_VIDEO_HEIGHT` are never chosen
  while a taller one exists.
- **Segment URIs:** absolute upstream URLs when the stream needs no headers
  (F4); `/hlsseg/:id?u=...` when it does, as today. `#sf=` fallbacks and
  pixel-packed segments keep working because they are handled in `/hlsseg`.
- **Fallback (F5):** a master whose chosen rendition names an `AUDIO` group
  with its own URI (separate audio) cannot be flattened to one playlist
  without losing the audio. Such streams are served as today, without
  failover. Non-HLS streams are relayed as today.

### 2. Sessions (`PlaybackSessions.js`, new)

One session per channel id, shared by every client watching that channel:

```js
{
  upstream: { url, headers, needsHeaders }, // the media playlist in use
  offset,          // our sequence number = upstream sequence + offset
  lastSeq,         // highest sequence number served
  upstreamLastSeq, // upstream's last segment number at the previous check
  advancedAt,      // when upstream's last segment number last changed
  discontinuities, // our sequence numbers that carry EXT-X-DISCONTINUITY
  discontinuitySeq,// discontinuities that have slid out of the window
  servedAt, text,  // last playlist served, reused for up to 1 s
  touchedAt,       // last reload; sessions idle for 2 min are dropped
}
```

Each reload:

1. With no session, or a session idle for over 2 minutes: resolve the
   channel as today and start a session with `offset = 0`.
2. Otherwise, fetch the session's upstream media playlist. Concurrent reloads
   share one fetch, and a playlist built under 1 s ago is reused.
3. The source has **failed** when the fetch errors or returns non-2xx, the
   body is not a media playlist with segments, it carries `#EXT-X-ENDLIST`, or
   its last segment number has not advanced for
   `max(4 × EXT-X-TARGETDURATION, 20 s)` (**stalled**).
4. On failure: `Aggregator.reportFailure(id, reason)` records the failure
   against the source in use and drops the cached resolution (F3). Then the
   channel is resolved again; ranking now puts the failed source last. The
   new source's media playlist is **spliced** in (section 3). If the new
   resolution is the same playlist URL, nothing is spliced. If nothing
   resolves, the reload answers `502`, the session is dropped, and the player's
   retry starts a fresh one.
5. The playlist is rendered (section 3) and served.

For a stream that needs headers, the session updates the headers `/hlsseg`
replays, so segments of the new source are fetched with the right ones.

### 3. Splicing and rendering (`sessionPlaylist.js`, new)

The upstream media playlist is parsed into header tags and segments. Each
segment keeps the tags written before it (`#EXTINF`, `#EXT-X-BYTERANGE`,
`#EXT-X-KEY`, `#EXT-X-MAP`, `#EXT-X-PROGRAM-DATE-TIME`,
`#EXT-X-DISCONTINUITY`), so keys and init segments stay attached to the
segments they apply to.

- **Numbering (F2):** our sequence number is the upstream number plus
  `offset`. On a splice, `offset` is set so the new source's first segment is
  `lastSeq + 1`, and that number is added to `discontinuities`.
- **Discontinuities:** every segment whose number is in `discontinuities`, or
  that the upstream itself marks, gets `#EXT-X-DISCONTINUITY`.
  `#EXT-X-DISCONTINUITY-SEQUENCE` counts the marked segments that have slid
  out of the window, as RFC 8216 requires.
- **Output:** `#EXTM3U`, the upstream's `#EXT-X-VERSION`,
  `#EXT-X-TARGETDURATION` (at least the longest segment served),
  `#EXT-X-MEDIA-SEQUENCE` (first number served),
  `#EXT-X-DISCONTINUITY-SEQUENCE`, `#EXT-X-INDEPENDENT-SEGMENTS` when the
  upstream has it, then the segments.
- Segments of the failed source are not served after a splice; the window
  restarts with the new source. Players treat the jump forward as a gap and
  the discontinuity as a timestamp reset.

### 4. Aggregator

- `reportFailure(publicId, reason)`: records a failure for the cached source
  of `publicId` with the ranker and drops the cached resolution. Returns the
  failed source, or null when nothing was cached.
- The doc comment for `explainSources`, separated from it by an earlier
  change, is moved back.

### 5. Diagnostics

`GET /debug/sources/:id` gains `session`: the upstream URL host, sequence
offset, number of splices and when the upstream last advanced.

## Configuration

| Var                 | Default | Notes                                                      |
| ------------------- | ------- | ---------------------------------------------------------- |
| `PLAYBACK_FAILOVER` | `true`  | `false` restores the redirect / rewritten-master behavior. |

## Risks

- **Tokens bound to the fetching IP.** This server now fetches every playlist
  reload while the player fetches segments directly. The same split already
  exists for `serveFilteredMaster`. It holds when both are on the same network;
  `PLAYBACK_FAILOVER=false` is the escape hatch.
- **Player handling of discontinuities.** ffmpeg (Dispatcharr) and Plex's
  transcoder both read MPEG-TS across timestamp resets; a switch can still show
  as a brief freeze or audio blip.
- **Load.** One small playlist fetch per reload per channel being watched,
  deduplicated across clients.

## Testing

- **sessionPlaylist:** parse and render round trip; offset numbering; a
  splice adds a discontinuity at `lastSeq + 1`; the discontinuity sequence
  counts tags that slid out; upstream discontinuities, keys and maps are kept
  with their segments; rendition choice (1080 cap, floor, bandwidth tie,
  separate audio declined).
- **PlaybackSessions:** a healthy reload re-serves the upstream window; an
  upstream `403` or `ENDLIST` fails over and records the failure; a stall
  fails over only after the stall limit; nothing resolving answers an error
  and drops the session; the same URL is not spliced; concurrent reloads
  share one fetch; an idle session restarts; header-locked switches update
  the `/hlsseg` headers.
- **Live run:** a channel served as a session across several reloads, its
  segments decoded; `PLAYBACK_FAILOVER=false` serves the old rewritten
  manifest. `app.js` starts a server when loaded, so these paths are checked
  live rather than in the unit suite.
