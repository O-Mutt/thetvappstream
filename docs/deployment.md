# Deployment

## Docker

The image is published to GHCR on every merge to `main`:

```bash
docker run -d \
  --name streamscraper \
  --restart unless-stopped \
  -p 5000:5000 \
  -e PUBLIC_BASE_URL=https://streams.example.com \
  -e PROVIDERS=thetvapp,streamfree,daddylive \
  -e LINEAR_FILTER='ESPN,ESPNU,FS1,NFL Network,RedZone,NBA TV,Sky Sports' \
  ghcr.io/o-mutt/thetvappstream:latest
```

- The image bundles Chromium for DaddyLive. It starts only when a DaddyLive
  stream is resolved, so `thetvapp` and `streamfree` never start it.
- Set `PUBLIC_BASE_URL` to the address your middleware and players use to
  reach this server. Without it, the address is taken from each request,
  which is wrong behind most reverse proxies.
- `--network host` also works and avoids `PUBLIC_BASE_URL` when the host's
  own address is what should appear in the playlist.
- The container's `HEALTHCHECK` calls `/healthz`.

See [Configuration](configuration.md) for every variable.

## Plex Live TV and Dispatcharr

Point the middleware at:

- Playlist: `https://<host>/channels.m3u`
- Guide: `https://<host>/epg.xml`

Each channel's `tvg-id` matches its guide `<channel id>`, so channels pair
with their guide without manual mapping.

- **Game channels** are named `<team> vs <team> @ <time>`. Dispatcharr's
  team-recording scheduler reads that time; keep its `source_timezone` equal to
  `EVENT_DISPLAY_TZ`.
- **24/7 channels** have `tvg-id`s of the form `live:<network>`. If you are
  upgrading from a version with `<provider>:<ref>` ids, see
  [Upgrading](upgrading.md).
- Players reload `/channel/<id>` itself every few seconds while watching,
  which is how a dead source is replaced mid-game. A brief freeze at the
  switch is normal.
