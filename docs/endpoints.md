# Endpoints

## For players and middleware

| Path            | Returns                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/channels.m3u` | The merged playlist. 24/7 channels carry their group (default `Live TV`); games carry their league as `group-title`. Each `tvg-id` matches a `<channel id>` in `/epg.xml`.                                                             |
| `/epg.xml`      | The XMLTV guide: the 24/7 channels' guides plus one programme per game. `503` until the first build finishes, shortly after start-up. Rebuilt every 6 hours and after each game refresh.                                               |
| `/channel/:id`  | The stream. HLS channels get a playlist this server rebuilds on every reload and fails over mid-game ([design](design/playback-failover.md)); segments go straight upstream unless the source needs headers. `404` when nothing plays. |
| `/healthz`      | `200 ok`. Used by the Docker `HEALTHCHECK`.                                                                                                                                                                                            |

## Diagnostics

| Path                 | Returns                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/debug/sources/:id` | A channel's sources in the order the next tune will try them, each with its health, quality and resolve cost; which one is playing; and the playback session, if any.      |
| `/debug/dropped`     | What `EVENT_FILTER` (`dropped`, with each game's sport, league, category and name) and `LINEAR_FILTER` (`linear.dropped`, channel names) removed on the last listing pass. |

Both are read-only JSON. `:id` is the channel's `tvg-id`, URL-encoded
(`/debug/sources/live%3Aespn`).

## Internal

These URLs are written into playlists and artwork fields; nothing needs to
call them directly.

| Path                      | Returns                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/hlsseg/:id/:file?u=...` | Segment and nested-playlist proxy for streams that need headers: fetches `u` with the stream's Referer/Origin. Image-wrapped segments are unwrapped to MPEG-TS. `:file` (`seg.ts`, `index.m3u8`) only satisfies ffmpeg's extension check. |
| `/logo/event`             | Game artwork, PNG. `fmt=thumb` for the channel logo, `fmt=poster` for the programme poster (Plex's 2:3 frame).                                                                                                                            |
| `/logo/split`             | Two team crests side by side, PNG.                                                                                                                                                                                                        |
