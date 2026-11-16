# Upgrading

Changes that need action from operators, newest first.

## Linear channels merged by network (#35)

**Breaking:** every linear (24/7) channel has a new `tvg-id`.

Linear channels used to be one per provider, with the id
`<provider>:<ref>`, for example `daddylive:44` or `fast:News1.us`. The same
network from two providers showed up as two channels.

They are now merged by network. Each merged channel has the id
`live:<network>`, for example `live:espn` or `live:nfl-redzone`, and every
provider that carries the network is one of its sources. When a source fails
or is below 720p, the next one plays automatically. Event channels are
unchanged.

### What to do

1. **Plex:** in Live TV & DVR, rescan the tuner's channels and re-map the
   guide. Channels mapped by the old ids lose their guide until re-mapped.
2. **Dispatcharr:** refresh the M3U account and the EPG source. Re-check any
   channel you mapped by hand to an EPG id, and remove the old
   `<provider>:<ref>` channels once the `live:` ones show up.
3. **Recordings and rules:** re-check any recording or series rule that points
   at a linear channel, and any Dispatcharr team rule keyed on a linear
   channel id. Rules keyed on event channels need no change.
4. **Bookmarks:** `/channel/<provider>:<ref>` stream URLs no longer exist. Use
   the URLs from the new `/channels.m3u`.

### Checking a channel

`GET /debug/sources/live:<network>` lists the sources merged into a channel,
in the order the next tune will try them.

If two different channels were merged, or one network was split, the key
rules and alias table are in `networkKey.js`, with the design in
`docs/design/stream-sources-and-ranking.md`, section 4.
