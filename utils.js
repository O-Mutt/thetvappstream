const fs = require('fs').promises;

async function getChannelLogos() {
  const json = await fs.readFile('./channelLogos.json', 'utf8');
  return JSON.parse(json);
}

module.exports = { getChannelLogos };
