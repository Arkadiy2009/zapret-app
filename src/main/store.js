// Настройки и личные данные. Живут отдельно от файлов запрета и переживают обновления.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  firstRun: true,
  core: null, previousCore: null,
  strategy: null, lastGood: [],
  autostart: true, autoheal: true, updates: true, motion: true,
  targets: [{ id: 'yt', on: true }, { id: 'dc', on: true }],
  sites: [], catalog: [],
  lists: { general: [], exclude: [], ipadd: [], ipskip: [] },
  game: { mode: 'off', tcp: '1024-65535', udp: '1024-65535' },
  ipset: 'none', ipsetDate: null, wasConnected: false,
  fakes: { discord: null, game: null },
  results: null, resultsAt: null, lastUpdateCheck: 0, dohEnabled: false,
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* первый запуск */ }
    this.data = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...saved };
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, DEFAULTS };
