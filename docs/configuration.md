# Configuration

Everything is set with environment variables (`config.js`). A `.env` file in
the working directory is read too.

## Server

| Variable          | Default   | Notes                                                                                                                                                                                   |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `5000`    | HTTP port.                                                                                                                                                                              |
| `PUBLIC_BASE_URL` | _(unset)_ | Base URL written into the M3U and guide, e.g. `https://streams.example.com`. When unset it is taken from the request's `Host` / `X-Forwarded-*` headers. Set it behind a reverse proxy. |

## Providers

| Variable                   | Default                                                          | Notes                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `PROVIDERS`                | `thetvapp,streamfree`                                            | Providers to enable: `thetvapp`, `streamfree`, `daddylive`. The order only breaks ties in ranking. `none` runs only `M3U_SOURCES`. |
| `M3U_SOURCES`              | _(unset)_                                                        | Extra playlist feeds, one provider each. See [Providers](providers.md#m3u-and-xmltv-sources).                                      |
| `THETVAPP_URLS`            | `https://thetvapp.plus,https://the-tv.app,https://thetvapp.link` | thetvapp mirrors, most preferred first.                                                                                            |
| `ENABLE_EVENT_STREAMS`     | `true`                                                           | thetvapp: list games. thetvapp has no 24/7 channels, so `false` turns it off.                                                      |
| `STREAMFREE_URLS`          | `https://strmfree.st,https://strmfree.pk,https://streamfree.top` | StreamFree mirrors, used after the domains from its mirror directory.                                                              |
| `STREAMFREE_ENABLE_LINEAR` | `true`                                                           | StreamFree: list its 24/7 channels (RedZone, Sky Sports Tennis/Cricket/F1, Willow). `false` for games only.                        |
| `DLHD_URLS`                | `https://dlive.sx,https://dlhd.st,https://dlhd.pk`               | DaddyLive mirrors, most preferred first.                                                                                           |
| `DLHD_ENABLE_EVENTS`       | `true`                                                           | DaddyLive: list games from its schedule.                                                                                           |
| `DLHD_ENABLE_LINEAR`       | `true`                                                           | DaddyLive: list its ~900 24/7 channels. They have no guide; `LINEAR_FILTER` keeps just the ones you want.                          |
| `DLHD_MAX_STALE_DAYS`      | `2`                                                              | Reject a DaddyLive schedule day dated further than this from today (a frozen mirror serves months-old schedules).                  |
| `TV_URL`                   | `https://thetvapp.to`                                            | Legacy; only used when `THETVAPP_URLS` is empty.                                                                                   |

## Channel list

| Variable           | Default             | Notes                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EVENT_FILTER`     | _(unset: keep all)_ | Sports and/or competitions to keep as game channels, e.g. `american-football,basketball,hockey,Boxing,UFC,EPL`. Sports: `american-football`, `basketball`, `hockey`, `baseball`, `soccer`, `combat`, `motorsport`, `tennis`, `cricket`, `golf`, `rugby`, `darts`, `other`. |
| `LINEAR_FILTER`    | _(unset: keep all)_ | 24/7 networks to keep, e.g. `ESPN,ESPNU,ESPNews,FS1,NFL Network,RedZone,NBA TV,Sky Sports`. An entry keeps its family in the home market; `ESPN MX` adds a market; `=ESPN` keeps one network.                                                                              |
| `EVENT_REFRESH_MS` | `1800000` (30 min)  | How often game listings are re-read.                                                                                                                                                                                                                                       |
| `EVENT_DISPLAY_TZ` | `America/Chicago`   | Time zone of the `@ <time>` suffix in game channel names. Dispatcharr's team-recording scheduler parses that time; keep its `source_timezone` the same.                                                                                                                    |

What the filters drop is listed at [`/debug/dropped`](endpoints.md).

## Streams

| Variable            | Default           | Notes                                                                                                                                                             |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_VIDEO_HEIGHT`  | `720`             | Quality floor. Sources below it are tried after every source at or above it, and renditions below it are hidden when a taller one exists. `0` turns this off.     |
| `RESOLVE_BUDGET_MS` | `45000`           | Total time one tune may spend trying sources. Plex gives up on a tune after about a minute.                                                                       |
| `STREAM_CACHE_MS`   | `600000` (10 min) | How long a resolved stream is reused for a channel; it is re-checked on every use. `0` disables.                                                                  |
| `PLAYBACK_FAILOVER` | `true`            | Serve HLS channels as a playlist rebuilt on every reload, switching to the next source when the current one fails, stalls or ends. `false` restores the redirect. |
