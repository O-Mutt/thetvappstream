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
- **Linear channels:** before step 4, namespaced per provider
  (`${provider}:${ref}`), so the same network from two providers gave two
  channels.
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
| R8  | New providers: StreamFree (plain HTTP). PPV.ST was shelved; see section 7.                                                                                                              |
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

### 4. Linear channel dedupe (`networkKey.js`, `Aggregator._linearChannels`)

- **Network key** (`networkKey(name)`):
  1. Lowercase, strip accents and emoji, turn `+` into `plus` and other
     punctuation into spaces.
  2. Split digits off a name of three or more letters, so `ESPN2` and
     `ESPN 2` agree. Shorter prefixes stay joined (`F1`, `FS1`).
  3. Drop trailing decoration: `hd`, `fhd`, `uhd`, `4k`, `sd`, `hevc`, any
     `720p`-style height, `us`, `usa`. Drop a leading `us`/`usa` market
     prefix (`US: ESPN`). US is this app's audience, so a bare name is the US
     feed; other markets keep their suffix (`ESPN 2 NL`, `TNT Sports 1 UK`).
  4. Sky Sports is a UK brand that appears both with and without `UK`, so a
     trailing `uk` is dropped for `sky sports ...` only. `Sky Sports F1 DE`
     stays separate.
  5. An alias table joins known spellings: `nfl net` and `nflnetwork` to
     `nfl network`; `redzone` to `nfl redzone`; `fs1` to `fox sports 1`;
     `cbssn` to `cbs sports network`; `willow cricket` to `willow`.
  6. Words are joined with `-`.

  Bracketed text is kept as words, not removed, because it often names the
  feed: dlhd lists twenty `18+ (Player-NN)` channels that removing it would
  merge into one. On dlhd's 899 channels plus StreamFree's five, the only
  merges were the intended ones: RedZone, Sky Sports Tennis, Sky Sports F1,
  Sky Sports Cricket and Willow.

- **Merging:** channels with the same key become one entry whose `sources`
  are in `PROVIDERS` order and ranked at tune time as in section 2. This
  includes `M3U_SOURCES` channels and duplicates within one provider (an
  IPTV list's `News One (720p)` and `News One SD`).
- **Channel id:** `live:<network key>`, for example `live:espn`. This changed
  the `tvg-id` of every linear channel; see `docs/upgrading.md`. A name that
  is all decoration falls back to a key built from the provider and ref.
- **Name, group and logo:** name and group come from the first provider in
  `PROVIDERS` order that lists the network; the logo from the first that has
  one. A stable name keeps Plex and Dispatcharr from seeing renames.
- **Guide:** one `<channel>` per merged channel. Programmes come from the
  first source, in source order, whose provider has programmes for it, so a
  guide-less copy (dlhd) never blanks a copy with a guide. Provider guide
  rows for channels the provider no longer lists are not emitted.

#### Linear allowlist (`linearFilter.js`, #47)

`LINEAR_FILTER` is a comma-separated list of networks to keep, for example
`ESPN,ESPNU,ESPNews,Fox Sports,FS1,NFL Network,RedZone,NBA TV,Sky Sports`.
Unset keeps every linear channel. It applies after merging, to the M3U and
the guide alike.

- Entries are matched by network key, so any spelling of a network works
  (`ESPN USA`, `espn`).
- An entry keeps its **family**: networks whose key starts with the entry's
  words, as whole words. `ESPN` keeps ESPN, ESPN 2 and ESPN Deportes. ESPNU
  and ESPNews are single words, so they are listed separately.
- A family match leaves out **regional editions** (a key with a market word
  such as `nl`, `mx`, `au`, `de`, `italy`, `brasil`, `argentina`) unless the
  entry names that market. `ESPN MX` adds the Mexican feeds; `Sky Sports`
  keeps the UK channels but not `Sky Sports F1 DE`.
- `=ESPN` keeps exactly one network.
- Dropped channel names are listed under `linear` at `/debug/dropped`, and
  the kept/total count is logged when it changes.

On dlhd's 899 channels plus StreamFree's five (2026-11-16), the example list
above, with `MLB Network, NHL Network, CBS Sports Network, TNT, TBS, Golf
Channel, Willow` added, kept 30 networks: the US sports channels and Sky's UK
sports channels.

### 5. Event allowlist (`EventFilter.js`, `sports.js`)

`EVENT_FILTER` is a comma-separated list of sports and/or competitions, for
example `american-football,basketball,hockey,baseball,MLS,EPL,Boxing,UFC`.
When it is unset, every event is kept, as today. Linear channels are never
filtered.

**Sport.** Every event gets a canonical `sport` (section 1). A provider sets it
when its own category says which sport: StreamFree maps its category ids, and
dlhd reads its category with `Football` overridden to soccer. Otherwise
`sports.inferSport` reads the category, then the league, then the name, through
a whole-word term table (`sports.SPORT_TERMS`). Narrow sports are checked
first, so "Premier League Darts" is darts and "Indian Premier League" is
cricket. `PPV` maps to `combat`, because pay-per-view cards on these sites are
fights. Anything unrecognized is `other`.

**Entries.** Matching is case-insensitive, ignores emoji and punctuation, and
works on whole words, so `NBA` does not match "WNBA".

- A **sport entry** (`basketball`, `american-football`, `ice hockey`,
  `motorsports`, ...) keeps every event of that sport.
- A **competition entry** keeps an event when:
  1. one of its terms appears in the event's league, category or name, or
  2. it and the event's league resolve to the same `canonicalLeague`, or
  3. the event is in the entry's sport but its league and category name only
     the sport ("Soccer", "Fight", "PPV", "combat", empty), and its name does
     not contain a term of another competition of that sport.

  Rule 3 is what keeps a boxing card that a source filed as `combat` with no
  league, while "UFC 320" under the same labels is still dropped by `Boxing`.
  The cost is that a source that labels every game only "Soccer" (the-tv.app)
  has all its soccer kept under `EPL`.

- **Aliases** expand an entry's terms. They live in `EventFilter.ALIASES`:

  | Entry              | Terms                                                                                     |
  | ------------------ | ----------------------------------------------------------------------------------------- |
  | `Boxing`           | boxing, matchroom, top rank, queensberry, dazn, golden boy, pbc, premier boxing champions |
  | `UFC`, `MMA`       | ufc, ufc fight night, mma, pfl, bellator, one championship                                |
  | `Wrestling`, `WWE` | wrestling, wwe, aew, raw, smackdown, nxt, tna                                             |
  | `NFL`              | nfl, redzone, red zone, american football                                                 |
  | `NCAAF`            | ncaaf, college football, ncaa football, cfb                                               |
  | `NCAAB`            | ncaab, college basketball, ncaa basketball, march madness                                 |
  | `EPL`              | epl, premier league, english premier league                                               |
  | `MLS`              | mls, major league soccer                                                                  |
  | `UCL`              | ucl, champions league                                                                     |
  | `F1`               | f1, formula 1, formula one                                                                |

  `NBA`, `WNBA`, `NHL`, `MLB` and `NASCAR` match their own name. Any other
  entry matches its own words ("UEFA Nations League"). Extend the table when
  `/debug/dropped` shows a labeling gap.

**Dropped events.** Each one is recorded with `provider`, `sport`, `league`,
raw `category` and `name`, served at `/debug/dropped`, and logged once when it
first drops out (the listing is rebuilt on every M3U fetch, so logging every
pass would repeat each line).

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

### 7. PPV.ST provider (shelved)

Status: shelved 2026-11-16 (#36 closed). Recorded so it can be picked up
again.

**Listing (works over plain HTTP).** `GET https://api.ppv.st/api/streams`
(alternate host: `api.ppv.cx`) returned 195 entries for the week ahead on
2026-11-16. The response says
`"READ_ME": "Interested in using our API? Contact us for more information."`,
so the API is not formally public the way StreamFree's is.

```json
{
  "success": true,
  "timestamp": 1794824230,
  "streams": [
    {
      "category": "Basketball",
      "id": 1,
      "always_live": false,
      "streams": [
        {
          "id": 32231,
          "name": "Orlando Magic vs. Boston Celtics",
          "tag": "NBA",
          "source_tag": "HD | NBCSN",
          "uri_name": "nba/2026-11-16/orl-bos",
          "starts_at": 1794873600,
          "ends_at": 1794884400,
          "always_live": 0,
          "category_name": "Basketball",
          "iframe": "https://taifood-blog.asia/embed/nba/2026-11-16/orl-bos",
          "substreams": [
            {
              "uri_name": "nba/2026-11-16/orl-bos_540p",
              "source_tag": "SD | NBCSN",
              "iframe": "..."
            }
          ]
        }
      ]
    }
  ]
}
```

- 16 entries have `always_live: 1` (category `24/7 Streams` or a sport):
  NFL Network, NHL Network, Willow, Sky Sports Golf, Sky Sports Racing, Fox
  Footy/Cricket/League, CNN, Fox News, and cartoon loops.
- `category_name` would map to `sport`: `American Football` is
  `american-football`, `Football` is `soccer`, `Ice Hockey` is `hockey`.
- `tag` is the league. `source_tag` is `HD | <broadcaster>` or
  `SD | <broadcaster>`; `substreams` hold the SD (540p) copy.
- The `iframe` host rotates and must be read from each refresh.

**Playback (does not work with our browser).** The embed page loads
`bundle-jw.js` and a WebAssembly module (`gasm.wasm`), POSTs to `/fetch`,
receives an encrypted `application/octet-stream` body, then fails to load a
script and never requests a playlist:

- Opened top-level, the page shows "Remove sandbox attributes on the iframe
  tag".
- Inside ppv.st's own watch page (`https://ppv.st/live/<uri_name>`), the
  page loads its stream record from `api.ppv.st/api/streams/<uri_name>` and
  frames the embed, but the embed again stops after `/fetch`.

Our Playwright launch is easy to identify as automated: its user agent says
Chrome 124 while its client hints say `HeadlessChrome 148`, and
`navigator.webdriver` is set. Making playback work would mean disguising the
browser to get past the site's bot detection. We decided not to do that, given
the API's "contact us" notice, and to look for another plain-HTTP source
instead.

A PPV provider must not ship with a resolver that fails. Its events would
merge into existing game channels as extra sources, and each failed attempt
holds a browser session for about 40 s of the 45 s tune budget.

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
- **EventFilter:** alias expansion; the boxing-as-`combat` case; a UFC card
  under generic labels dropped by `Boxing`; dlhd `Football` treated as soccer
  while StreamFree `football` is the NFL; whole-word matching; dropped events
  are recorded and logged once.
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
5. ~~PPV provider~~ Shelved (section 7). Another plain-HTTP source is being
   evaluated in its place.

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
3. ~~**PPV terms**~~ Decided 2026-11-16: PPV is shelved. Playback needs a
   browser disguised to get past bot detection, and its API says "contact
   us". See section 7.
4. ~~**Failover during playback**~~ Addressed 2026-11-16 (#45): HLS
   channels are served as a session playlist that switches to the next ranked
   source when the current one fails, stalls or ends. See
   [playback-failover.md](playback-failover.md).
