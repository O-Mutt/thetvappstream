# TheTvApp StreamScraper

An Express server that scrapes thetvapp.to and serves an M3U playlist plus an XMLTV electronic program guide. Designed to plug straight into IPTV middleware (Dispatcharr, Threadfin, xTeVe, etc.) and from there into Plex Live TV / Jellyfin / VLC.

## Endpoints

| Path             | What it returns                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/channels.m3u`  | M3U playlist of all available channels. Each entry has `tvg-id` set to the channel ID so it pairs automatically with the EPG.                        |
| `/epg.xml`       | XMLTV programme guide (~118 channels, ~10k+ programmes, refreshed every 6h). Returns `503` for the brief window between startup and the first build. |
| `/channel/:chid` | Resolves to the current signed HLS m3u8 URL and `302` redirects to it. Each call gets a fresh token, so URLs in the playlist never go stale.         |
| `/healthz`       | Liveness probe (`200 ok`). The Docker image's HEALTHCHECK uses this.                                                                                 |

## Configuration (env vars)

| Var               | Default               | Notes                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `5000`                | HTTP port the server binds to.                                                                                                                                                                                                                                                |
| `TV_URL`          | `https://thetvapp.to` | Upstream site root.                                                                                                                                                                                                                                                           |
| `PUBLIC_BASE_URL` | _(unset)_             | Base URL emitted in the M3U (e.g. `https://thetvapp-proxy.example.com`). When unset, derived from the request's `Host`/`X-Forwarded-*` headers — works as long as the M3U is fetched at a URL downstream players can also reach. Strongly recommended behind a reverse proxy. |

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

## Disclaimer

> Not affiliated with `thetvapp.to`. Intended for personal use only — respect the upstream site's terms of service.
