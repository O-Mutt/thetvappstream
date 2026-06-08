const Provider = require('./Provider');
const ChannelManager = require('../ChannelManager');
const EventManager = require('../EventManager');
const { THETVAPP_URLS } = require('../config');

// TheTVApp adapter. All thetvapp.to-specific scraping (session cookies, HTML
// selectors, signed-token resolution) stays in ChannelManager/EventManager;
// this class just exposes them through the Provider contract.
class TheTvAppProvider extends Provider {
  constructor({ enableEvents = true, urls = THETVAPP_URLS } = {}) {
    super();
    this.channelManager = new ChannelManager({ urls });
    this.eventManager = enableEvents ? new EventManager(this.channelManager) : null;
    if (this.eventManager) this.channelManager.setEventManager(this.eventManager);
  }

  get name() {
    return 'thetvapp';
  }

  async ensureReady() {
    await this.channelManager.ensureSession();
    await this.channelManager.listChannels();
    if (this.eventManager) await this.eventManager.refreshEvents();
  }

  async refreshEvents() {
    if (this.eventManager) await this.eventManager.refreshEvents();
  }

  async listLinearChannels() {
    // ChannelManager already returns { name: chid }.
    return this.channelManager.listChannels();
  }

  async listEvents() {
    if (!this.eventManager) return [];
    return this.eventManager.listEvents().map(e => ({
      league: e.league,
      name: e.name,
      startSec: e.startSec,
      endSec: e.endSec,
      streamRef: e.chid, // upstream slot id, resolved at play time
      logo: e.logo,
    }));
  }

  async getEpgData() {
    return this.channelManager.collectEpgData();
  }

  async resolveStream(streamRef) {
    const url = await this.channelManager.getStream(streamRef);
    return { url };
  }
}

module.exports = TheTvAppProvider;
