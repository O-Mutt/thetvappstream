const { MIN_VIDEO_HEIGHT } = require('./config');

const QUALITY_FHD = 0;
const QUALITY_HD = 1;
const QUALITY_UNKNOWN = 2;
const QUALITY_LOW = 3;
const QUALITY_NAMES = ['fhd', 'hd', 'unknown', 'low'];

const COST_RANK = { http: 0, browser: 1 };

function sourceKey(s) {
  return `${s.providerName}:${s.ref}`;
}

// Orders a channel's sources best-first and remembers how each one has been
// doing. Health is in-memory on purpose: a restart is a fresh look at every
// source, and none of this is worth persisting across deploys.
class SourceRanker {
  constructor({
    now = Date.now,
    minHeight = MIN_VIDEO_HEIGHT,
    baseCooldownMs = 2 * 60 * 1000,
    maxCooldownMs = 30 * 60 * 1000,
    providerFailureThreshold = 3,
    providerWindowMs = 10 * 60 * 1000,
  } = {}) {
    this.now = now;
    this.minHeight = minHeight;
    this.baseCooldownMs = baseCooldownMs;
    this.maxCooldownMs = maxCooldownMs;
    this.providerFailureThreshold = providerFailureThreshold;
    this.providerWindowMs = providerWindowMs;
    this.sources = new Map();
    this.providers = new Map();
  }

  _record(map, key) {
    let h = map.get(key);
    if (!h) {
      h = { consecutiveFailures: 0, lastFailureAt: 0, lastSuccessAt: 0, lastError: null };
      map.set(key, h);
    }
    return h;
  }

  recordSuccess(source, { height } = {}) {
    const t = this.now();
    for (const h of [
      this._record(this.sources, sourceKey(source)),
      this._record(this.providers, source.providerName),
    ]) {
      h.consecutiveFailures = 0;
      h.lastSuccessAt = t;
      h.lastError = null;
    }
    if (Number.isFinite(height) && height > 0) {
      this._record(this.sources, sourceKey(source)).lastHeight = height;
    }
  }

  recordFailure(source, reason) {
    const t = this.now();
    for (const h of [
      this._record(this.sources, sourceKey(source)),
      this._record(this.providers, source.providerName),
    ]) {
      h.consecutiveFailures++;
      h.lastFailureAt = t;
      h.lastError = reason ? String(reason) : null;
    }
  }

  _cooldownMs(failures) {
    return Math.min(this.baseCooldownMs * 2 ** (failures - 1), this.maxCooldownMs);
  }

  sourceDegraded(source) {
    const h = this.sources.get(sourceKey(source));
    if (!h || h.consecutiveFailures === 0) return false;
    return this.now() - h.lastFailureAt < this._cooldownMs(h.consecutiveFailures);
  }

  // A source whose CDN is down fails on every channel at once; demoting the
  // whole provider catches that after a few tunes instead of one per channel.
  providerDegraded(providerName) {
    const h = this.providers.get(providerName);
    if (!h || h.consecutiveFailures < this.providerFailureThreshold) return false;
    return this.now() - h.lastFailureAt < this.providerWindowMs;
  }

  // A height measured from the source's own master playlist beats the
  // provider's label, which is only what the site claims.
  heightOf(source) {
    const h = this.sources.get(sourceKey(source));
    if (h && h.lastHeight) return h.lastHeight;
    const hinted = source.quality && source.quality.height;
    return Number.isFinite(hinted) && hinted > 0 ? hinted : null;
  }

  qualityClass(source) {
    const height = this.heightOf(source);
    if (!height) return QUALITY_UNKNOWN;
    if (this.minHeight > 0 && height < this.minHeight) return QUALITY_LOW;
    return height >= 1080 ? QUALITY_FHD : QUALITY_HD;
  }

  // `providerOrder` maps provider name -> position in PROVIDERS; `costOf` maps
  // provider name -> 'http' | 'browser'. Returns a new array; degraded sources
  // stay in the list, last, because a stale failure beats no stream at all.
  rank(sources, { providerOrder = new Map(), costOf = () => 'http' } = {}) {
    return sources
      .map((s, i) => ({ s, i, key: this._sortKey(s, i, providerOrder, costOf) }))
      .sort((a, b) => {
        for (let k = 0; k < a.key.length; k++) {
          if (a.key[k] !== b.key[k]) return a.key[k] - b.key[k];
        }
        return 0;
      })
      .map(x => x.s);
  }

  _sortKey(s, index, providerOrder, costOf) {
    const degraded = this.sourceDegraded(s) || this.providerDegraded(s.providerName) ? 1 : 0;
    const cost = COST_RANK[costOf(s.providerName)] ?? COST_RANK.http;
    const order = providerOrder.has(s.providerName)
      ? providerOrder.get(s.providerName)
      : Number.MAX_SAFE_INTEGER;
    return [degraded, this.qualityClass(s), cost, order, index];
  }

  // Same order as rank(), with the reasons spelled out for /debug/sources.
  explain(sources, opts = {}) {
    const costOf = opts.costOf || (() => 'http');
    return this.rank(sources, opts).map(s => {
      const h = this.sources.get(sourceKey(s));
      return {
        provider: s.providerName,
        ref: s.ref,
        quality: QUALITY_NAMES[this.qualityClass(s)],
        height: this.heightOf(s),
        cost: costOf(s.providerName),
        degraded: this.sourceDegraded(s),
        providerDegraded: this.providerDegraded(s.providerName),
        consecutiveFailures: h ? h.consecutiveFailures : 0,
        lastFailureAt: h && h.lastFailureAt ? new Date(h.lastFailureAt).toISOString() : null,
        lastSuccessAt: h && h.lastSuccessAt ? new Date(h.lastSuccessAt).toISOString() : null,
        lastError: h ? h.lastError : null,
      };
    });
  }
}

module.exports = { SourceRanker, sourceKey };
