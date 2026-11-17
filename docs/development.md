# Development

```bash
npm install
npm test             # unit tests (node:test)
npm run lint         # ESLint
npm run format       # Prettier (format:check in CI)
node app.js          # http://localhost:5000
```

Chromium is only needed for DaddyLive: `npx playwright install chromium`.

CI runs lint, the format check and the tests on every pull request
(`.github/workflows/lint.yml`). The Docker image is built for pull requests
that touch it and pushed to GHCR on merges to `main`
(`.github/workflows/docker.yml`) as `ghcr.io/o-mutt/thetvappstream`,
tagged `latest` and with the short commit SHA. Both workflows run on
GitHub-hosted runners. Don't move them to self-hosted runners: the repo is
public, so a pull request from a fork could run code on those machines.

## Layout

| Path                                        | What it does                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `app.js`                                    | HTTP routes and start-up.                                                        |
| `Aggregator.js`                             | Merges providers into channels, the M3U and the guide; resolves streams.         |
| `SourceRanker.js`                           | Source health, cooldowns and ranking.                                            |
| `PlaybackSessions.js`, `sessionPlaylist.js` | Per-channel playlists that fail over during playback.                            |
| `hlsProxy.js`, `segmentUnwrap.js`           | Playlist probing and rewriting, the `/hlsseg` proxy, image-wrapped segments.     |
| `networkKey.js`, `linearFilter.js`          | Network names for merging 24/7 channels, and `LINEAR_FILTER`.                    |
| `sports.js`, `EventFilter.js`               | Sport detection and `EVENT_FILTER`.                                              |
| `canonicalName.js`, `displayName.js`        | Game identity for merging, and name cleanup.                                     |
| `MirrorResolver.js`                         | Ordered mirror lists with liveness probes.                                       |
| `providers/`                                | One directory per provider, plus `Provider.js` (the interface) and the registry. |

## Adding a provider

1. Write the spec as a page under `docs/design/` first.
2. Subclass `providers/Provider.js` in `providers/<name>/`. Keep parsing in a
   pure `parse.js` so it can be tested against fixtures with no network.
3. Return games from `listEvents()` with `sport` set when the source's category
   is unambiguous, and 24/7 channels from `listLinearChannels()`. Refs may
   carry a quality hint: `{ ref, quality: { height } }`.
4. Set `resolveCost` to `'browser'` if `resolveStream` needs the headless
   browser.
5. Register it in `providers/index.js`.

Games and channels merge with other providers' automatically; nothing in the
M3U, guide or proxy code changes.

## Documentation

All documentation lives in `docs/` and is built with MkDocs or Zensical from
`mkdocs.yml`. Pages are discovered automatically; there is no `nav` to update.
The README only points here.
