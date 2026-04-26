# TheTvApp StreamScraper

An Express server that scrapes thetvapp.to and serves an M3U playlist plus an XMLTV electronic program guide. Designed to plug straight into IPTV middleware (Dispatcharr, Threadfin, xTeVe, etc.) and from there into Plex Live TV / Jellyfin / VLC.

## Endpoints

| Path             | What it returns                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/channels.m3u`  | M3U playlist of all available channels and (when enabled) per-game event streams. Each entry has `tvg-id` set to the chid so it pairs automatically with the EPG. Linear channels carry `group-title="Live TV"`; events carry the league name (e.g. `MLB`, `NHL`, `NFL`, `NBA`, `NCAAF`, `NCAAB`, `Soccer`, `PPV`). |
| `/epg.xml`       | XMLTV programme guide (~118 channels, ~10k+ programmes, refreshed every 6h). When event streams are enabled, today's games are folded in as `<programme>` entries with synthesized end times. Returns `503` for the brief window between startup and the first build.                                               |
| `/channel/:chid` | Resolves to the current signed HLS m3u8 URL and `302` redirects to it. Each call gets a fresh token, so URLs in the playlist never go stale.                                                                                                                                                                        |
| `/healthz`       | Liveness probe (`200 ok`). The Docker image's HEALTHCHECK uses this.                                                                                                                                                                                                                                                |

## Configuration (env vars)

| Var                    | Default               | Notes                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `5000`                | HTTP port the server binds to.                                                                                                                                                                                                                                                |
| `TV_URL`               | `https://thetvapp.to` | Upstream site root.                                                                                                                                                                                                                                                           |
| `PUBLIC_BASE_URL`      | _(unset)_             | Base URL emitted in the M3U (e.g. `https://thetvapp-proxy.example.com`). When unset, derived from the request's `Host`/`X-Forwarded-*` headers — works as long as the M3U is fetched at a URL downstream players can also reach. Strongly recommended behind a reverse proxy. |
| `ENABLE_EVENT_STREAMS` | `true`                | When `true`, scrape `/mlb`, `/nhl`, `/nfl`, `/nba`, `/ncaaf`, `/ncaab`, `/soccer`, and `/ppv` for per-game event streams and merge them into the M3U + EPG. Set to `false` to serve only the linear TV channel list.                                                          |
| `EVENT_REFRESH_MS`     | `1800000` (30 min)    | How often to re-scrape the per-sport listing pages. Event chids are slot IDs that get reassigned as games rotate through the day, so frequent refresh matters more here than for the linear channel cache.                                                                    |

## Running with Docker

```bash
docker run -d \
  --name thetvappstream \
  --restart unless-stopped \
  -p 5000:5000 \
  -e PUBLIC_BASE_URL=https://thetvapp-proxy.example.com \
  ghcr.io/o-mutt/thetvappstream:latest
```

`--network host` also works and avoids the need for `PUBLIC_BASE_URL` if the host's IP is what you want in the playlist URLs.

## Wiring into Plex Live TV

Both endpoints are independent — most middleware wants both as separate sources:

- M3U source: `https://your-host/channels.m3u`
- XMLTV source: `https://your-host/epg.xml`

`tvg-id` in the M3U matches `<channel id>` in the XMLTV by construction, so middleware should auto-pair channels to programmes with no manual mapping.

## Development

```bash
npm install
npm test           # unit tests (node:test)
npm run lint       # ESLint
npm run format     # Prettier
node app.js
```

CI runs lint + format + tests on every PR (`.github/workflows/lint.yml`); the Docker image is built and pushed to GHCR on merges to `main` (`.github/workflows/docker.yml`).

## Caveat: per-game event streams

Per-game streams are backed by upstream "slot" IDs (`mlb01`, `nhl02`, etc.) — the same slot is reused as one game ends and the next begins. To keep Plex/dispatcharr happy with a 1:1 mapping between playlist entries and EPG channels, every event row gets its own synthetic id (`evt-<url-slug>`) used in `tvg-id` and `<channel id>`, while the actual stream URL still points at the upstream slot. Practical implication: tuning into a stale playlist entry resolves to whichever game is currently in that slot, not necessarily the one named in the entry. The container refreshes the event list every `EVENT_REFRESH_MS` to keep this drift small. Disable with `ENABLE_EVENT_STREAMS=false` if this isn't the behavior you want.

## Disclaimer

> Not affiliated with `thetvapp.to`. Intended for personal use only — respect the upstream site's terms of service.
