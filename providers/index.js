const { PROVIDERS, ENABLE_EVENT_STREAMS } = require('../config');
const Aggregator = require('../Aggregator');
const TheTvAppProvider = require('./thetvapp');
const DaddyLiveProvider = require('./daddylive');

// Provider registry. Each entry is a lazy factory so only the providers named
// in the PROVIDERS env var get constructed. Add new sources here — nothing else
// in the app needs to change.
const REGISTRY = {
  thetvapp: () => new TheTvAppProvider({ enableEvents: ENABLE_EVENT_STREAMS }),
  daddylive: () => new DaddyLiveProvider(),
  // streameast: () => new StreamEastProvider({ ... }),
  // methstreams: () => new MethStreamsProvider({ ... }),
};

function createProviders(names = PROVIDERS) {
  const providers = [];
  for (const name of names) {
    const factory = REGISTRY[name];
    if (!factory) {
      console.error(`[providers] unknown provider '${name}', skipping`);
      continue;
    }
    providers.push(factory());
  }
  if (providers.length === 0) {
    console.error('[providers] no providers configured (check PROVIDERS env var)');
  }
  return providers;
}

function createAggregator(names = PROVIDERS) {
  return new Aggregator(createProviders(names));
}

module.exports = { REGISTRY, createProviders, createAggregator };
