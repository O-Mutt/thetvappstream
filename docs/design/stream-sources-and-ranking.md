# Stream sources and source ranking

Status: draft, 2026-11-16

## Goal

A Plex or Jellyfin viewer opens a channel and gets a stream that is live and
watchable (720p or better). The channel list stays small: one channel per game
and one per network, never one per source. Backup sources stay inside the
channel as automatic fallbacks.

## Non-goals

- Separate backup channels.
- Fallback-only providers. Every provider is ranked on equal terms.
- A cap on sources per channel. Ranking decides which ones are tried first.

## Current behavior

- **Events:** `Aggregator._dedupeEvents` (`Aggregator.js:93`) already merges a
  game into one channel across providers, keeping the other providers as
  ordered `sources`.
- **Linear channels:** namespaced per provider (`Aggregator.js:179`,
  `${provider}:${ref}`). The same network from two providers gives two channels.
- **Source order:** provider order in `PROVIDERS`, then each provider's own
  order. Quality and recent failures are ignored.
- **Tune:** `_resolveStream` (`Aggregator.js:315`) tries sources in order. Each
  one is resolved and checked with `probeStream` (`hlsProxy.js:109`) before
  it is served.
- **Event filter:** none. Every event a provider lists becomes a channel.

## Requirements

| ID  | Requirement                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Sources within a channel are tried best-first. "Best" combines recent health, video quality and resolve cost.                                                                           |
| R2  | A source that failed recently is tried after sources that have not, and it recovers on its own.                                                                                         |
| R3  | Sources below 720p are served only when no higher-quality source validates.                                                                                                             |
| R4  | When a master playlist lists renditions both at or above 720p and below it, players are only offered the ones at or above 720p.                                                         |
| R5  | One linear channel per network across all providers.                                                                                                                                    |
| R6  | An optional allowlist limits event channels to chosen sports and leagues. The match tolerates labeling variations, so a boxing card is not dropped because a source called it "combat". |
| R7  | Each dropped event is logged with its raw labels.                                                                                                                                       |
| R8  | New providers: StreamFree (plain HTTP) and PPV.ST (headless browser).                                                                                                                   |
| R9  | Ranking and health decisions can be inspected without reading logs.                                                                                                                     |

## Design

### 1. Provider contract additions (`providers/Provider.js`)

All additions are optional, so existing providers keep working unchanged.

- Each event gets `sport`: a canonical sport, one of `american-football`,
  `basketball`, `hockey`, `baseball`, `soccer`, `combat`, `motorsport`,
  `tennis`, `cricket`, `golf`, `rugby`, `darts`, `other`. The provider maps its
  own category to this value, because the same label means different sports
  on different sources: PPV `Football` is soccer, while StreamFree `football`
  is the NFL.
- `streamRef` and the `altStreamRefs` entries may be strings, as today, or
  objects: `{ ref, quality?: { height?: number, label?: string } }`.
- A new getter `resolveCost` returns `'http'` (the default) or `'browser'`.
  `daddylive` and `ppv` return `'browser'`.
- `resolveStream` may also return `quality: { height }` when the provider
  knows it.

### 2. Source ranking and health (`SourceRanker.js`, new)

The aggregator keeps an in-memory health record per source key
(`${provider}:${ref}`) and per provider:

```
{ consecutiveFailures, lastFailureAt, lastSuccessAt, lastHeight }
```

- **Recording results:** `_resolveStream` records a success when a source
  validates, and a failure when it throws, returns nothing, or fails
  validation.
- **Cooldown:** a source is degraded for `min(2 min * 2^(failures-1), 30 min)`
  after its last failure. One success resets it.
- **Provider health:** a provider with 3 or more consecutive failures across
  any channels within 10 minutes is degraded as a whole. This catches a source
  whose CDN is down without waiting for each channel to fail on its own.
- **Ranking:** before a tune, the channel's sources are sorted by these keys,
  in order:
  1. Not degraded, then degraded. Degraded sources are still tried as a last
     resort.
  2. Quality class: `>=1080` > `>=720` > unknown > `<720`. The height comes
     from the master playlist's `RESOLUTION` attribute if one was seen,
     otherwise the provider's hint, otherwise unknown.
  3. Resolve cost: `http` before `browser`.
  4. Provider order in `PROVIDERS`, then the provider's own order.
- **Cached streams:** the existing cache (`_resolved`) is untouched. A stream
  that is playing stays on its source while it keeps validating.
- **Time budget:** the whole tune is capped by `RESOLVE_BUDGET_MS` (default
  45 s) so Plex does not time out while browser sources are tried one after
  another. Sources not reached in time are logged.

### 3. Quality floor (`hlsProxy.js`)

The floor is `MIN_VIDEO_HEIGHT` (default 720).

- **Proxied streams:** when serving a master playlist, drop each
  `#EXT-X-STREAM-INF` variant whose `RESOLUTION` height is below the floor,
  but only if at least one variant at or above it remains. Variants with no
  `RESOLUTION` attribute are kept.
- **Redirected streams:** these need no headers and are served with a `302`
  today. When `probeStream` returns a master playlist that has variants below
  the floor, serve the filtered master instead of redirecting. Its variant
  URIs stay absolute upstream URLs, so segments do not pass through the proxy.
- The highest `RESOLUTION` seen is recorded as the source's `lastHeight` for
  ranking.

### 4. Linear channel dedupe (`Aggregator.listM3uEntries`)

- **Merging:** each linear channel name is normalized to a network key:
  lowercase; emoji and punctuation removed; trailing `hd`, `fhd`, `uhd`, `4k`,
  `usa`, `us` and bracketed text removed. A small alias table covers known
  spellings, for example `nfl network`, `nfl net` and `nflnetwork` map to
  `nfl-network`. Channels with the same key become one entry whose `sources`
  are ranked as in section 2.
- **Channel id:** `live:<network key>`. This changes the `tvg-id` of every
  linear channel. See Open questions.
- **Name and logo:** the display name, logo and EPG come from the
  highest-priority provider that has a guide for the channel.
- **Plain M3U sources:** channels from `M3U_SOURCES` are merged by the same
  key.

### 5. Event allowlist (`EventFilter.js`, new)

`EVENT_FILTER` is a comma-separated list of sports and/or leagues, for example
`american-football,basketball,hockey,baseball,MLS,EPL,Boxing,UFC`. When it is
unset, every event is kept, as today.

- **Matching:** an event is kept when any entry matches its `sport`, its
  `league`, its provider category, or a keyword in its name. Matching is
  case-insensitive and ignores emoji and punctuation.
- **Aliases:** each entry expands through an alias table:

  | Entry    | Also matches                                                                                         |
  | -------- | ---------------------------------------------------------------------------------------------------- |
  | `Boxing` | sport `combat` with `boxing`, `matchroom`, `top rank`, `queensberry` or `dazn` in the name or league |
  | `UFC`    | `ufc`, `ufc fight night`, `mma`, `pfl`                                                               |
  | `NFL`    | `nfl`, `redzone`, `american football`                                                                |
  | `soccer` | sport `soccer`, plus every named competition                                                         |

  The aliases live in code next to the existing league tables in
  `eventLogos.js`, and are extended as labeling gaps show up in the dropped
  list.

- **Dropped events:** each one is recorded with `provider`, `sport`, `league`,
  raw `category` and `name`. The record is logged once per refresh and served
  at `/debug/dropped`.

### 6. StreamFree provider (`providers/streamfree/`)

Probed 2026-11-16. Resolution needs plain HTTP only.

**Mirrors**

- `GET https://strmfree.link/api/domains` returns
  `["strmfree.pk","strmfree.st","streamfree.top"]`.
- If that request fails, `STREAMFREE_URLS` is used (default
  `https://strmfree.st,https://strmfree.pk,https://streamfree.top`).
- Liveness is checked through `MirrorResolver`.

**Listing**

`GET https://{mirror}/api/v1/streams`. No API key is needed. The operator
asks clients to cache this, so it is refreshed no more than every 5 minutes.

```json
{
  "count": 15,
  "streams": [
    {
      "name": "Moldova vs Faroe Islands",
      "category": "soccer",
      "league": "UEFA Nations League",
      "stream_key": "moldova-vs-faroe-islands",
      "match_timestamp": 1794841200,
      "sources": [
        {
          "quality": "FHD",
          "url": "https://strmfree.st/embed/soccer/moldova-vs-faroe-islands1080p",
          "live": false
        }
      ],
      "thumbnail_url": "https://streamfree.top/thumbnails/..."
    }
  ]
}
```

- Categories: `soccer`, `basketball`, `hockey`, `combat`, `baseball`,
  `football` (the NFL), `racing`, `tennis`, `cricket`. They are also listed by
  `GET /api/v1/categories`.
- There are up to 5 sources per stream. The first source's variant id ends in
  the quality (`...1080p`); later ones add a number (`...1080p2`).
- Quality labels map to heights: `SD` is 480, `HD` 720, `FHD` 1080, `4K` 2160.
- `GET /streams` (not under `/api/v1`) also returns `team1.logo` and
  `team2.logo` as ESPN URLs, which are useful for artwork.

**Events and channels**

The listing mixes games with 24/7 channels (RedZone, Sky Sports Tennis, Sky
Sports Cricket, Sky Sports F1, Willow).

- A stream is a **linear channel** when its `match_timestamp` is more than
  24 h old and its `id` is a UUID rather than its `stream_key`. Channels keep
  the date the operator created them as their timestamp, and auto-created
  games reuse the stream key as their id. Requiring both stops a stale game
  that was never removed from turning into a permanent channel. Channels are
  listed even while they have no source, so the channel list stays stable.
  `STREAMFREE_ENABLE_LINEAR=false` drops them.
- Every other stream is an **event** while it is inside the usual window
  (ended no more than 45 min ago, starting within 36 h).
- The start is `match_timestamp`. The end is the start plus a per-category
  default: soccer 2 h 15 min; basketball and hockey 2 h 30 min; baseball and
  football 3 h 30 min; combat and cricket 4 h; anything else 3 h.

Refs carry their kind:

| Ref                         | Used for                           | Resolves to                                                     |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `v:{category}/{variant}`    | each listed source of a game       | that source, with its quality as the ranking hint               |
| `k:{category}/{stream_key}` | channels; games with no source yet | the highest live source from `GET /api/v1/sources/{stream_key}` |

Games are often listed before StreamFree attaches a source. The `k:` ref
means such a game still plays once a source goes live, even if no listing
refresh happens in between.

**Resolving a ref**

1. `GET https://{mirror}/embed/{category}/{variant}` with
   `Referer: https://{mirror}/`. Extract the JSON from
   `const _0x = {...};`. It holds a token set for each quality
   (`1080p`, `720p`, `540p`, `2160p`), each with fields
   `_t, _ta, _e, _n, _s, _sa`. `_e` is the expiry as a unix time, about 8 h
   after the fetch.
2. `GET https://{mirror}/get-stream-key/{stream_key}`, which returns
   `{"stream_key":"...","is_external":false,"server_name":"cdn","server_domain":"https://cdn1.strmfree.st"}`.
   - If `is_external` is true, use `external_url` as the stream.
3. Build the playlist path from `server_name`, then append the query
   `?_t=&_ta=&_e=&_n=&_s=&_sa=`:

   | `server_name`        | Playlist path                            |
   | -------------------- | ---------------------------------------- |
   | `externalcdn`        | `/live-externalcdn/{variant}/index.m3u8` |
   | any other non-origin | `/live-cdn/{variant}/index.m3u8`         |
   | `origin`             | `/live/{variant}/index.m3u8`             |

   In testing, `/live/` answered 403 to a plain client, while `/live-cdn/` and
   `/live-externalcdn/` returned 200 with no headers.

4. Return `{ url, headers: { Referer: 'https://{embed host}/', Origin: 'https://{embed host}' }, quality: { height } }`.
   All requests after the embed go to the mirror that served it, because
   that mirror issued the tokens.
   The headers are required for segments. A segment request with no headers
   returned 403; with them it returned 200 `video/mp2t`.

**Segments**

- Each quality is its own media playlist. There is no master playlist.
- On `cdn` and `origin`, segment URLs end in `.js`, but the content is plain
  MPEG-TS. In testing it was H.264 1920x1080 with AAC audio.
- On `externalcdn` (RedZone on 2026-11-16), each segment line has the form
  `<tiktok url>#sf=<url-encoded own-cdn url>`: a TikTok-hosted copy first,
  StreamFree's own CDN as the fallback. HTTP drops the fragment, so `/hlsseg`
  splits the line itself. It fetches the TikTok copy first and falls back to
  the decoded URL on an error or a non-2xx answer.
- The TikTok copy is a 1x1 PNG with the whole MPEG-TS segment in a private
  `tsDa` chunk. `segmentUnwrap.js` returns that chunk as `video/mp2t`, beside
  the existing dlhd pixel-packed (`TIKTIKPX`) format. Verified 2026-11-16:
  H.264 1920x1080 with AAC.

**Cost:** `http`.

### 7. PPV.ST provider (`providers/ppv/`)

Probed 2026-11-16.

**Listing**

`GET https://api.ppv.st/api/streams` (alternate host: `api.ppv.cx`). It
returned about 170 entries covering a week ahead. The response includes
`"READ_ME": "Interested in using our API? Contact us for more information."`,
so this API is not formally public the way StreamFree's is.

```json
{ "success": true, "timestamp": 1794824230, "streams": [ {
  "category": "Basketball", "id": 1, "always_live": false, "streams": [ {
    "id": 32231, "name": "Orlando Magic vs. Boston Celtics", "tag": "NBA",
    "source_tag": "HD | NBCSN", "uri_name": "nba/2026-11-16/orl-bos",
    "starts_at": 1794873600, "ends_at": 1794884400, "always_live": 0,
    "category_name": "Basketball",
    "iframe": "https://taifood-blog.asia/embed/nba/2026-11-16/orl-bos",
    "substreams": [ ... ] } ] } ] }
```

- `always_live: 1` marks a linear channel (for example NFL Network, NHL
  Network, Willow). Other entries are events with real start and end times.
- `category_name` maps to `sport`: `American Football` is
  `american-football`, `Football` is `soccer`, `Ice Hockey` is `hockey`.
- `tag` is the league.
- Matchups use both `at` and `vs.` as separators. Check that `teamsOf` in
  `canonicalName.js` splits on both.
- `source_tag` with an `HD` prefix is a quality hint of height 720 or more.
- `substreams` are alternate feeds and become `altStreamRefs`. Their fields
  have not been examined yet.
- The `iframe` host rotates. It is read from each refresh and never
  hardcoded.

**Resolving a ref**

- The embed page builds the stream URL in about 268 KB of obfuscated inline
  script, so the URL cannot be extracted with plain HTTP.
- Resolve with `browser.sniffStream(iframe, { referer: 'https://ppv.st/' })`,
  which captures the `.m3u8` request and its headers.
- Whether the manifest and segments require headers is not yet verified.

**Cost:** `browser`.

### 8. Diagnostics

- `GET /debug/sources/:id`: the channel's sources in ranked order, each with
  its health record, quality, cost and rank reasons.
- `GET /debug/dropped`: events removed by `EVENT_FILTER` in the last refresh.

Both are read-only JSON.

## Configuration

| Var                        | Default                                                          | Notes                                                                  |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `MIN_VIDEO_HEIGHT`         | `720`                                                            | Quality floor for ranking and master-playlist filtering. `0` disables. |
| `RESOLVE_BUDGET_MS`        | `45000`                                                          | Total time a tune may spend trying sources.                            |
| `EVENT_FILTER`             | _(unset: keep all)_                                              | Sports and/or leagues to keep. See section 5.                          |
| `STREAMFREE_URLS`          | `https://strmfree.st,https://strmfree.pk,https://streamfree.top` | Used when the mirror directory is unreachable.                         |
| `STREAMFREE_ENABLE_LINEAR` | `true`                                                           | Set `false` to take StreamFree games only, without its 24/7 channels.  |
| `PPV_API_URLS`             | `https://api.ppv.st,https://api.ppv.cx`                          | Listing API hosts, in order.                                           |

`PROVIDERS` gains `streamfree` and `ppv`. Provider order now only breaks ties
in ranking.

## Testing

- **SourceRanker:** ordering for each sort key; cooldown growth and reset;
  provider-wide degradation; a degraded source is still tried last.
- **`_resolveStream`:** health is recorded on each outcome; the time budget
  stops the loop; a cached stream is unaffected by ranking.
- **Quality filter:** drops sub-floor variants only when a higher one
  remains; keeps variants with no `RESOLUTION`; serves the master-only
  rewrite for streams that need no headers.
- **EventFilter:** alias expansion; the boxing-as-`combat` case; PPV
  `Football` treated as soccer while StreamFree `football` is the NFL; dropped
  events are recorded.
- **Linear dedupe:** normalization and aliases; merged sources; a stable
  `live:` id.
- **StreamFree:** listing parse against a fixture of the `/api/v1/streams`
  response, including the game/channel split; `_0x` token extraction from a
  fixture embed page; playlist URL for each `server_name`; required headers
  are present; `k:` refs pick the highest live source; the `#sf=` fallback;
  the `tsDa` unwrap.
- **PPV:** listing parse against a fixture; linear versus event split; sport
  mapping; the `at` separator.

## Rollout

1. Ranking, health, the quality floor and the diagnostics endpoints. These
   help existing providers right away.
2. StreamFree provider.
3. `sport` field and `EVENT_FILTER`.
4. Linear dedupe, which includes the `tvg-id` migration.
5. PPV provider.

Each step is a separate PR.

## Open questions

1. ~~**Linear `tvg-id` migration**~~ Decided 2026-11-16: accept a one-time
   break. Linear channels move to `live:<network>`. The release notes for
   step 4 must tell operators to remap linear channels in Plex and Dispatcharr
   and to re-check any recording rule keyed on a linear channel id.
2. ~~**StreamFree non-matchup entries**~~ Decided 2026-11-16: they are
   linear channels. They stay listed with no source attached (Sky Sports F1
   and Willow had none on 2026-11-16), and their ids are UUIDs with creation
   dates months old. See section 6.
3. **PPV terms:** its API says "contact us". Using it is a policy call.
4. **Failover during playback:** once a proxied stream is playing, a source
   that dies mid-game is only replaced when the player reloads the channel URL.
   Switching sources inside `/hlsseg` is a separate piece of work.
