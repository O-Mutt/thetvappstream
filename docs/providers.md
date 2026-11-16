# Providers

A provider is one upstream source behind a small interface
(`providers/Provider.js`). The M3U and guide assembly, ranking, failover and
the stream proxy are shared, so adding a source is one adapter.

| Provider     | 24/7 channels | Games | Resolves with    | Notes                                                               |
| ------------ | ------------- | ----- | ---------------- | ------------------------------------------------------------------- |
| `thetvapp`   | no            | yes   | HTTP             | US leagues (NFL, NBA, MLB, NHL, NCAA, soccer, fights) with a guide. |
| `streamfree` | yes (5)       | yes   | HTTP             | 1080p. RedZone, Sky Sports Tennis/Cricket/F1, Willow.               |
| `daddylive`  | yes (~900)    | yes   | headless browser | Broadest coverage; slower to tune. Trim with `LINEAR_FILTER`.       |
| M3U sources  | yes           | no    | as listed        | Any playlist plus optional XMLTV guide (`M3U_SOURCES`).             |

`PROVIDERS` lists the providers to enable; the default is
`thetvapp,streamfree`. `PROVIDERS=none` runs only `M3U_SOURCES` feeds.

## How channels are merged

**Games.** The same game from several providers is one channel. Games are
matched on league, teams and date, then on a looser same-game test (team
nickname or suffix variants, starts within 2.5 hours), so "Detroit Tigers"
and "Tigers" land on one channel. Every provider's feed for the game, and any
backup feeds a provider lists, become sources of that channel.

**24/7 channels.** The same network from several providers is one channel,
with the `tvg-id` `live:<network>` (for example `live:espn`). Names are
normalized so "ESPN USA", "ESPN HD" and "US: ESPN" match, while regional
editions ("ESPN 2 NL") stay separate. See
[design section 4](design/stream-sources-and-ranking.md).

**Choosing a source.** When a channel is tuned, its sources are tried best
first:

1. sources that have not failed recently,
2. then 1080p, 720p, unknown quality, and below 720p, in that order,
3. then plain-HTTP sources before browser-based ones,
4. then the order of `PROVIDERS`.

Each candidate's playlist is fetched and checked before it is served, so a
dead or empty feed falls through to the next source instead of a black
channel. A failed source cools down (2 minutes, doubling to 30) and recovers
on its own. `/debug/sources/<id>` shows the order and the reasons.

**During playback**, the channel's playlist is rebuilt on every reload. If the
source fails, stalls or ends, the next one is spliced in. See
[Playback failover](design/playback-failover.md).

## Filters

- `EVENT_FILTER` keeps only the listed sports and competitions, for example
  `american-football,basketball,Boxing,UFC,EPL`. It errs towards keeping: a
  boxing card a source filed only as "combat" is kept under `Boxing`.
- `LINEAR_FILTER` keeps only the listed networks, for example
  `ESPN,ESPNU,NFL Network,RedZone,Sky Sports`. An entry keeps its family in
  the home market (`ESPN` keeps ESPN 2); `ESPN MX` adds a market; `=ESPN`
  keeps one network.

Both list what they dropped at `/debug/dropped`. Details are in
[Configuration](configuration.md) and the
[design doc](design/stream-sources-and-ranking.md), sections 4 and 5.

## M3U and XMLTV sources

Any feed that publishes a playlist, and optionally an XMLTV guide, can be
merged in: free ad-supported services (Pluto TV, Samsung TV Plus, Plex, Roku,
Tubi, Xumo), public broadcasters, or an IPTV subscription.

```bash
# compact form: name=<m3u>|<xmltv>, ';' between sources (the guide is optional)
M3U_SOURCES="pluto=https://example.com/pluto/us.m3u8|https://example.com/pluto/us.xml.gz;news=https://example.com/news.m3u"

# JSON form, e.g. to force one group-title for a whole source
M3U_SOURCES='[{"name":"locals","m3u":"https://example.com/locals.m3u","epg":"https://example.com/locals.xml","group":"Locals"}]'
```

- Each source becomes a provider named after it. Names must be letters,
  digits, `-` or `_`, and can't reuse a built-in provider name.
- Its channels merge with other providers' copies of the same network.
- `tvg-logo` and `group-title` come through from the playlist (`group` in the
  JSON form overrides the group). Rows with no group land in `Live TV`.
- Guide programmes are matched by `tvg-id`, falling back to the XMLTV
  `display-name`. `.gz` guides are fine. Six hours back to three days ahead
  is kept.
- Request headers from `#EXTVLCOPT:http-referrer` / `http-user-agent` /
  `http-origin` and Kodi-style `url|Referer=...&User-Agent=...` are honored;
  those streams go through the proxy.
- HLS and continuous MPEG-TS streams both work.
- The playlist is re-read hourly and the guide every 3 hours. If a refresh
  fails, the last good copy is kept.

## Mirror failover

Upstream sites move domains often, so each provider has an ordered mirror
list and uses the first live one.

**thetvapp** (`THETVAPP_URLS`, default
`https://thetvapp.plus,https://the-tv.app,https://thetvapp.link`). A mirror is
live when one of its league pages lists games.

- Each event refresh re-checks from the top of the list, so a recovered
  preferred domain is picked back up.
- During a refresh, a connection error or a blocking status (403, 429, 5xx)
  moves to the next live mirror and retries. A 404 on one page does not.
- A mirror that answers but lists no games at all (a parked domain, or a block
  page served as 200) is skipped, and the refresh is retried once on the next
  mirror.
- When a game is tuned and its page can't be reached on the active mirror, the
  other mirrors are tried in order.

**StreamFree** reads the operator's mirror directory (`strmfree.link`) at
startup and puts those domains ahead of `STREAMFREE_URLS`.

**DaddyLive** (`DLHD_URLS`) switches mirrors on connection errors, and when a
mirror answers but lists no current games. A frozen mirror serving an old
schedule, a redesign, or a block page all pass the liveness check, so each
refresh tries the next live mirror (each at most once) until one lists a
current game. Schedule days dated more than `DLHD_MAX_STALE_DAYS` from today
are rejected. If no mirror lists games, the last good event list is kept,
minus games that have ended.

## Event channel ids

Upstream game pages are often slots reused as one game ends and the next
begins. Every game therefore gets its own canonical id (`evt-<league>-<teams>-<date>`),
used as its `tvg-id` and guide `<channel id>`, while the stream resolves to the
game's current source. The event list refreshes every `EVENT_REFRESH_MS`.
