# StreamScraper

An Express server that merges live sports and TV sources into one M3U playlist
and one XMLTV guide, for IPTV middleware (Dispatcharr, Threadfin, xTeVe) and
from there Plex Live TV, Jellyfin or VLC.

The aim is a short channel list where every channel plays the best stream
available:

- **One channel per game and one per network**, however many sources carry
  it. Each source becomes a fallback inside that channel, never a channel of
  its own.
- **Best source first.** Sources are ranked by recent health, video quality
  (720p or better first) and how expensive they are to resolve.
- **Failover during playback.** If the source playing dies mid-game, the next
  one is spliced into the same playlist.
- **Filters** keep only the sports, competitions and networks you want.

## Quick start

```bash
docker run -d --name streamscraper --restart unless-stopped \
  -p 5000:5000 \
  -e PUBLIC_BASE_URL=http://192.168.1.10:5000 \
  ghcr.io/tuatha-tech-llc/thetvappstream:latest
```

Then point your middleware at `http://<host>:5000/channels.m3u` (playlist) and
`http://<host>:5000/epg.xml` (guide). See [Deployment](deployment.md).

## Pages

- [Providers](providers.md): the sources, how channels are merged, mirror
  failover, and adding your own M3U feeds.
- [Configuration](configuration.md): every environment variable.
- [Endpoints](endpoints.md): the HTTP API, including the debug endpoints.
- [Deployment](deployment.md): Docker, Plex and Dispatcharr.
- [Upgrading](upgrading.md): changes that need action from operators.
- [Development](development.md): running, testing and adding a provider.
- Design: [Stream sources and ranking](design/stream-sources-and-ranking.md),
  [Playback failover](design/playback-failover.md).

> Not affiliated with any upstream site. Intended for personal use only.
> Respect each upstream site's terms of service.
