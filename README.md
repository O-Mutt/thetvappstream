# StreamScraper

Merges live sports and TV sources into one M3U playlist and XMLTV guide for
Dispatcharr, Plex Live TV and Jellyfin: one channel per game or network, the
best available stream first, and failover to the next source during playback.

```bash
docker run -d -p 5000:5000 ghcr.io/tuatha-tech-llc/thetvappstream:latest
```

Documentation lives in [`docs/`](docs/index.md):

- [Providers](docs/providers.md)
- [Configuration](docs/configuration.md)
- [Endpoints](docs/endpoints.md)
- [Deployment](docs/deployment.md)
- [Upgrading](docs/upgrading.md)
- [Development](docs/development.md)

> Not affiliated with any upstream site. Intended for personal use only.
> Respect each upstream site's terms of service.
