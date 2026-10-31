// Единый источник правды приложения. Окно только показывает состояние и зовёт действия.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Store } = require('./store');
const { loadStrategies, coreVersion, toBinPath } = require('./strategy');
const cfg = require('./config');
const scan = require('./scan');
const { CATALOG, SPECIAL_ANSWERS } = require('../shared/catalog');

const HEALTH_MS = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const BUILT_IN = { yt: { name: 'YouTube', sub: 'Видео и приложение', art: 'yt' }, dc: { name: 'Discord', sub: 'Чаты и голосовые каналы', art: 'dc' } };

class Controller extends EventEmitter {
  constructor({ dataDir, bundledCore, engine, updater, appVersion = '0.0.0', log = () => {} }) {
    super();
    Object.assign(this, { dataDir, bundledCore, engine, updater, appVersion, log });
    this.coreRoot = path.join(dataDir, 'core');
    fs.mkdirSync(this.coreRoot, { recursive: true });
    this.store = new Store(dataDir);
    this.d = this.store.data;
    this.v = {
      conn: 'off', scan: null, startedAt: 0, lastCheck: 0, banner: null, busy: false, dnsBad: false,
      diag: { state: 'idle', issues: {}, info: {}, shown: null, conflict: [] }, update: null, appUpdate: null, hostsOk: false, build: 0, installed: false,
    };
    this.cancelled = false; this.healthFails = 0; this.applyTimer = null; this.timers = [];
  }

  get coreDir() { return path.join(this.coreRoot, this.d.core); }
  get exe() { return path.join(this.coreDir, 'bin', 'winws.exe'); }

  async init() {
    await this.engine.secureDir(this.dataDir).catch(e => this.log(e));
    fs.rmSync(path.join(this.dataDir, 'update'), { recursive: true, force: true });
    this.ensureCore();
    this.reload();
    await this.finishInterruptedDeep();
    const svc = await this.engine.serviceState();
    this.v.installed = svc !== 'none';
    if (svc === 'running') {
      const base = await this.engine.installedStrategy();
      const file = base && `${base}.bat`;
      if (file && this.strategies.some(s => s.file === file)) this.d.strategy = file;
      this.v.conn = this.d.strategy ? 'on' : 'off';
      this.v.startedAt = Date.now();
      if (this.d.firstRun) await this.importExisting().catch(e => this.log(e));
    } else if (await this.engine.winwsRunning()) {
      this.v.banner = { kind: 'warn', text: 'Запущен другой запрет. Нажмите «Подключить», и мы заменим его.' };
    }
    this.timers.push(setInterval(() => this.healthTick().catch(e => this.log(e)), HEALTH_MS));
    this.timers.push(setInterval(() => this.dailyUpdate(), 60 * 60 * 1000));
    this.dailyUpdate();
    this.push();
  }

  // Человек уже пользовался запретом: забираем его строки и настройки. Его папку не меняем
  async importExisting() {
    const dir = await this.engine.installedCoreDir();
    if (!dir || path.resolve(dir).startsWith(path.resolve(this.coreRoot))) return;
    const read = f => { try { return fs.readFileSync(path.join(dir, 'lists', f), 'utf8'); } catch { return ''; } };
    const lines = text => text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const known = new Set(lines(fs.readFileSync(path.join(this.bundledCore, 'lists', 'list-general.txt'), 'utf8')));
    const extra = new Set([...lines(read('list-general.txt')).filter(l => !known.has(l)), ...lines(read('list-general-user.txt'))]);
    extra.delete(cfg.STUB_DOMAIN);
    for (const item of CATALOG) {
      if (!item.domains.every(d => extra.has(d))) continue;
      item.domains.forEach(d => extra.delete(d));
      this.d.catalog.push(item.id);
      this.d.targets.push({ id: item.id, on: true });
    }
    this.d.lists.general = [...extra].filter(d => /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d));
    this.d.lists.exclude = lines(read('list-exclude-user.txt')).filter(d => d !== cfg.STUB_DOMAIN);
    this.d.lists.ipskip = lines(read('ipset-exclude-user.txt')).filter(d => d !== cfg.STUB_IP);
    const ipset = read('ipset-all.txt');
    this.d.ipset = !ipset.trim() ? 'any' : ipset.includes(cfg.STUB_IP) ? 'none' : 'loaded';
    try {
      const g = Object.fromEntries(fs.readFileSync(path.join(dir, 'utils', 'game_filter.enabled'), 'utf8').split(/\r?\n/).map(l => l.split('=')));
      if (['all', 'tcp', 'udp'].includes(g.mode)) this.d.game.mode = g.mode;
      if (cfg.validPorts(g.tcp)) this.d.game.tcp = g.tcp;
      if (cfg.validPorts(g.udp)) this.d.game.udp = g.udp;
    } catch { /* режима для игр не было */ }
    this.v.imported = true;
    this.store.save();
    this.reload();
  }

  dispose() { this.timers.forEach(clearInterval); clearTimeout(this.applyTimer); }

  ensureCore() {
    if (this.d.core && fs.existsSync(path.join(this.coreDir, 'service.bat'))) return;
    const version = coreVersion(this.bundledCore);
    fs.cpSync(this.bundledCore, path.join(this.coreRoot, version), { recursive: true });
    this.d.core = version;
    this.store.save();
  }

  reload() {
    cfg.applyConfig(this.coreDir, this.d);
    this.strategies = loadStrategies(this.coreDir, cfg.winwsVars(this.coreDir, this.d));
    if (this.d.strategy && !this.strategies.some(s => s.file === this.d.strategy)) this.d.strategy = null;
    this.fakeList = cfg.listFakes(this.coreDir);
  }

  // Глубокая проверка временно переключает адреса на «Все». Если приложение упало, вернём как было
  async finishInterruptedDeep() {
    if (!this.d.ipsetRestore) return;
    this.d.ipset = this.d.ipsetRestore;
    delete this.d.ipsetRestore;
    this.store.save();
    this.reload();
  }

  targets() {
    const on = id => !!this.d.targets.find(t => t.id === id)?.on;
    const list = ['yt', 'dc'].map(id => ({ id, ...BUILT_IN[id], on: on(id) }));
    for (const id of this.d.catalog) {
      const c = CATALOG.find(x => x.id === id);
      if (c) list.push({ id, name: c.name, sub: c.kind, art: c.art, on: on(id), custom: true });
    }
    for (const s of this.d.sites) list.push({ id: s, name: s, sub: 'Ваш сайт', art: 'site', on: on(s), custom: true, site: true });
    return list;
  }

  snapshot() {
    const open = u => { if (!u) return null; const { rel, ...rest } = u; return rest; };
    return {
      ...this.v, update: open(this.v.update), appUpdate: open(this.v.appUpdate), appVersion: this.appVersion,
      firstRun: this.d.firstRun, strategy: this.d.strategy, results: this.d.results, zapret: this.d.core,
      strategies: this.strategies.map(({ args, ...s }) => s), targets: this.targets(), catalog: CATALOG, special: SPECIAL_ANSWERS,
      catalogOn: this.d.catalog, lists: this.d.lists, game: this.d.game, ipset: this.d.ipset, ipsetDate: this.d.ipsetDate,
      autostart: this.d.autostart, autoheal: this.d.autoheal, updates: this.d.updates, motion: this.d.motion, fakes: cfg.activeFakes(this.coreDir), fakeList: this.fakeList, dohEnabled: this.d.dohEnabled,
    };
  }

  push() { this.emit('state', this.snapshot()); }
  toast(text) { this.emit('toast', text); }
  save() { this.store.save(); this.push(); }
  chosenIds() { return cfg.scanTargets(this.coreDir, this.d).list.map(t => t.id); }

  // Подключение
  async connectWith(file) {
    const st = this.strategies.find(s => s.file === file);
    if (!st) throw new Error('Способ не найден');
    cfg.applyConfig(this.coreDir, this.d);
    const fresh = this.strategies.find(s => s.file === file);
    const bin = toBinPath(this.exe, fresh.args);
    const state = await this.engine.serviceState();
    if (state === 'none' || this.d.serviceBin !== bin) {
      await this.engine.installService(this.exe, fresh.args, file.replace(/\.bat$/i, ''), this.d.autostart);
      this.d.serviceBin = bin;
    } else {
      await this.engine.setServiceStart(this.d.autostart);
    }
    await this.engine.startService();
    Object.assign(this.d, { strategy: file, wasConnected: true, lastGood: [file, ...this.d.lastGood.filter(f => f !== file)].slice(0, 5) });
    Object.assign(this.v, { conn: 'on', scan: null, startedAt: Date.now(), lastCheck: Date.now(), banner: null, installed: true });
    this.healthFails = 0;
    this.save();
  }

  async primary() {
    if (this.v.conn === 'scan') return this.cancelScan();
    if (this.v.busy) return;
    this.v.busy = true; this.push();
    try {
      if (this.v.conn === 'on') {
        await this.engine.stopService();
        Object.assign(this.v, { conn: 'off', banner: null });
        this.d.wasConnected = false;
        this.toast('Отключено. Служба и драйвер остановлены');
      } else {
        if (!this.chosenIds().length) { this.toast('Отметьте хотя бы одну цель'); return; }
        if (!this.d.strategy) { this.v.busy = false; return await this.startScan({ reason: 'first' }); }
        await this.connectWith(this.d.strategy);
      }
    } finally {
      this.v.busy = false;
      this.save();
    }
  }

  // Подбор
  async startScan({ reason = 'again', full = false, deep = false } = {}) {
    if (this.v.conn === 'scan') return;
    if (!this.chosenIds().length) return this.toast('Отметьте хотя бы одну цель');
    const wasOn = this.v.conn === 'on', prev = this.d.strategy;
    this.cancelled = false;
    Object.assign(this.v, { conn: 'scan', banner: null, dnsBad: false, scan: { i: 0, total: this.strategies.length, reason, deep, file: null, phase: 1 } });
    this.d.results = {};
    this.push();
    let suite = [];
    try {
      await this.engine.stopService();
      if (deep) {
        suite = await this.updater.dpiSuite();
        this.d.ipsetRestore = this.d.ipset; this.d.ipset = 'any';
      }
      cfg.applyConfig(this.coreDir, this.d);
      this.store.save();
      const targets = cfg.scanTargets(this.coreDir, this.d);
      const results = await scan.run({
        engine: this.engine, strategies: this.strategies, exe: this.exe, targets, deep, suite, stopOnPerfect: !full, prefer: [prev, ...this.d.lastGood].filter(Boolean),
        isCancelled: () => this.cancelled,
        onStep: ({ results: r, ...step }) => { Object.assign(this.v.scan, step); this.d.results = r; this.push(); },
      });
      this.d.results = results;
    } catch (e) {
      this.log(e);
      this.v.banner = { kind: 'warn', text: `Подбор прервался: ${e.message}` };
    } finally {
      if (deep && this.d.ipsetRestore) { this.d.ipset = this.d.ipsetRestore; delete this.d.ipsetRestore; cfg.applyConfig(this.coreDir, this.d); }
    }
    if (this.cancelled) {
      this.toast('Поиск остановлен');
      if (wasOn && prev) await this.connectWith(prev).catch(e => this.toast(e.message));
      this.endScan();
      return this.save();
    }
    // Подбор остаётся на экране до самого подключения, чтобы заслон не закрывался на миг
    return this.afterScan(prev, deep).catch(e => { this.log(e); this.toast(e.message); }).finally(() => { this.endScan(); this.save(); });
  }

  endScan() {
    this.v.scan = null;
    if (this.v.conn === 'scan') this.v.conn = 'off';
  }

  async afterScan(prev, deep) {
    const ids = this.chosenIds(), res = this.d.results;
    if (scan.looksLikeDnsHijack(res, ids)) {
      this.v.dnsBad = true;
      this.d.strategy = null;
      this.endScan();
      this.save();
      return this.emit('open', 'dns');
    }
    const best = deep ? this.bestDeep(res) : scan.bestOf(res, ids);
    if (!best) {
      this.v.banner = { kind: 'warn', text: 'Обход не запустился ни одним способом. Откройте «Проверку».' };
      return;
    }
    const works = deep || ids.some(id => res[best].targets?.[id]?.ok > 0);
    if (!works) {
      this.d.strategy = prev;
      this.v.banner = { kind: 'warn', text: 'Ни один способ не открыл ваши цели. Откройте «Проверку».' };
      return;
    }
    await this.connectWith(best);
    const name = this.strategies.find(s => s.file === best).name;
    const perfect = deep || scan.allOk(res[best], ids);
    this.toast(perfect ? `Нашли способ ${name}: подходит под всё, что вы отметили` : `Лучший вариант ${name}, но работает не всё, что вы отметили`);
  }

  bestDeep(res) {
    let best = null, top = -1;
    for (const [file, r] of Object.entries(res)) if (r.dpi && r.dpi.ok > top) { top = r.dpi.ok; best = file; }
    return best;
  }

  cancelScan() { this.cancelled = true; }

  async useStrategy(file) {
    await this.connectWith(file);
    this.toast(`Включён способ ${this.strategies.find(s => s.file === file).name}`);
  }

  // Изменение настроек при включённом обходе требует перезапуска службы
  changed() {
    this.store.save();
    cfg.applyConfig(this.coreDir, this.d);
    this.strategies = loadStrategies(this.coreDir, cfg.winwsVars(this.coreDir, this.d));
    this.push();
    clearTimeout(this.applyTimer);
    if (this.v.conn !== 'on') return;
    this.applyTimer = setTimeout(() => {
      this.connectWith(this.d.strategy).then(() => this.toast('Перезапустили обход с новыми настройками')).catch(e => this.toast(e.message));
    }, 700);
  }

  toggleTarget(id) {
    if (this.v.conn === 'scan') return this.toast('Сначала дождитесь конца подбора');
    const t = this.d.targets.find(x => x.id === id);
    if (t) t.on = !t.on; else this.d.targets.push({ id, on: true });
    if (!this.v.conn || this.v.conn === 'off') this.dropStrategyIfUnfit();
    this.save();
  }

  // Способ подбирался под старые цели: если новую он не проверял, подберём заново
  dropStrategyIfUnfit() {
    const r = this.d.strategy && this.d.results?.[this.d.strategy];
    if (r && this.chosenIds().some(id => !r.targets?.[id] || r.targets[id].ok < r.targets[id].total)) this.d.strategy = null;
  }

  afterTargetAdded() {
    if (this.v.conn === 'on') {
      this.v.banner = { kind: 'warn', text: 'Новая цель ещё не проверена.', action: 'Подобрать заново', act: 'rescan' };
    } else this.dropStrategyIfUnfit();
    this.changed();
  }

  addCatalog(id) {
    const item = CATALOG.find(c => c.id === id);
    if (!item || this.d.catalog.includes(id)) return;
    this.d.catalog.push(id);
    this.d.targets.push({ id, on: true });
    const notes = [];
    if (item.game) {
      if (this.d.game.mode === 'off') { this.d.game.mode = 'all'; notes.push('режим для игр'); }
      if (this.d.ipset === 'none') { this.d.ipset = 'loaded'; notes.push('список адресов'); }
    }
    this.afterTargetAdded();
    this.toast(`${item.name}: добавлено${notes.length ? '. Включили: ' + notes.join(' и ') : ''}`);
  }

  addDomain(raw) {
    const d = String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) return this.toast('Нужен адрес сайта, например example.com');
    if (!this.d.lists.general.includes(d)) this.d.lists.general.push(d);
    if (!this.d.sites.includes(d)) { this.d.sites.push(d); this.d.targets.push({ id: d, on: true }); }
    this.afterTargetAdded();
    this.toast(`${d} добавлен в ваш список`);
  }

  removeTarget(id) {
    const name = this.targets().find(t => t.id === id)?.name || id;
    this.d.catalog = this.d.catalog.filter(x => x !== id);
    this.d.sites = this.d.sites.filter(x => x !== id);
    this.d.lists.general = this.d.lists.general.filter(x => x !== id);
    this.d.targets = this.d.targets.filter(t => t.id !== id);
    this.changed();
    this.toast(`${name} убрали`);
  }

  listAdd(tab, value) {
    const v = String(value).trim().toLowerCase();
    const ok = tab.startsWith('ip') ? /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(v) : /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(v);
    if (!ok) return { error: tab.startsWith('ip') ? 'Нужен IP или подсеть, например 203.0.113.0/24' : 'Нужен адрес сайта, например example.com' };
    if (!this.d.lists[tab].includes(v)) this.d.lists[tab].push(v);
    this.changed();
    return {};
  }

  listRemove(tab, value) {
    this.d.lists[tab] = this.d.lists[tab].filter(i => i !== value);
    this.changed();
  }

  set(key, value) {
    if (key === 'gameMode') {
      this.d.game.mode = value;
      if (value !== 'off' && this.d.ipset === 'none') {
        this.d.ipset = 'loaded';
        this.toast('Включили ещё и список адресов: без него режим для игр не работает');
      }
    } else if (key === 'ipset') this.d.ipset = value;
    this.changed();
  }

  async toggle(key) {
    if (!['autostart', 'autoheal', 'updates', 'motion'].includes(key)) return;
    this.d[key] = !this.d[key];
    if (key === 'autostart' && this.v.installed) {
      await this.engine.setServiceStart(this.d.autostart);
      this.toast(this.d.autostart ? 'Обход будет запускаться вместе с Windows' : 'Убрали обход из автозапуска');
    }
    this.save();
  }

  setPorts(kind, value) {
    const v = cfg.validPorts(value);
    if (!v) return { error: true };
    this.d.game[kind] = v;
    this.changed();
    this.toast('Порты сохранены');
    return {};
  }

  setFake(kind, value) {
    if (!this.fakeList.includes(value)) return;
    this.d.fakes[kind] = value;
    this.changed();
  }

  async finishOnboarding() {
    this.d.firstRun = false;
    this.store.save();
    if (this.v.conn !== 'on') return this.startScan({ reason: 'first' });
    await this.connectWith(this.d.strategy);
    this.toast(this.v.imported ? 'Перенесли ваш способ, списки и настройки' : 'Обход работает');
  }
  async defender() { await this.engine.addDefenderExclusion(this.dataDir); this.toast('Папка добавлена в исключения'); }

  // Проверка компьютера
  async runDiag() {
    this.v.diag = { ...this.v.diag, state: 'running' };
    this.push();
    try {
      const res = await this.engine.diagnose(this.coreDir);
      this.v.build = res.build;
      this.v.diag = { state: 'done', issues: res.issues, info: res.info, conflict: res.conflict };
    } catch (e) {
      this.log(e);
      this.v.diag = { ...this.v.diag, state: 'idle' };
      this.toast('Проверка не удалась, подробности в журнале');
    }
    this.push();
  }

  async fixConflicts() {
    await this.engine.removeConflicts(this.v.diag.conflict);
    this.toast('Мешающие службы удалены');
    return this.runDiag();
  }

  async discordCache() {
    const done = await this.engine.clearDiscordCache();
    this.toast(done.length ? 'Закрыли Discord и очистили кэш. Запустите его снова' : 'Discord на компьютере не найден');
  }

  async netReset() { await this.engine.resetNetwork(); this.toast('Сеть сброшена. Перезагрузите компьютер'); }

  async remove() {
    await this.engine.removeService();
    Object.assign(this.v, { conn: 'off', installed: false, banner: null });
    Object.assign(this.d, { strategy: null, serviceBin: null, wasConnected: false });
    this.toast('Служба и драйверы удалены');
    this.save();
  }

  // DNS
  async enableDns() {
    const retry = this.v.dnsBad;
    const build = this.v.build || (await this.engine.diagnose(this.coreDir)).build;
    if (build < 22000) return { browser: true };
    await this.engine.enableDoh();
    this.d.dohEnabled = true;
    delete this.v.diag.info.dns;
    this.v.dnsBad = false;
    this.toast('Безопасный DNS включён');
    this.save();
    if (retry) this.startScan({ reason: 'first' }).catch(e => this.log(e));
    return {};
  }

  async disableDns() {
    await this.engine.disableDoh();
    this.d.dohEnabled = false;
    this.v.diag.info.dns = true;
    this.toast('Безопасный DNS выключен');
    this.save();
  }

  // Обновления
  dailyUpdate() {
    if (!this.d.updates || Date.now() - this.d.lastUpdateCheck < DAY) return;
    this.checkUpdate(false).catch(e => this.log(e));
  }

  async checkUpdate(manual = true) {
    // Запрет приходит от Flowseal, оболочка из нашего репозитория. Сбой одного не мешает другому
    const [core, ui] = await Promise.allSettled([this.updater.latestRelease(), this.updater.latestApp(this.appVersion)]);
    [core, ui].forEach(r => r.status === 'rejected' && this.log(r.reason));
    if (core.status === 'rejected' && ui.status === 'rejected') {
      if (manual) this.toast('GitHub сейчас недоступен, проверим позже');
      return;
    }
    this.d.lastUpdateCheck = Date.now();
    this.store.save();
    const rel = core.value, next = ui.value;
    if (rel && rel.version !== this.d.core && this.v.update?.state !== 'run') {
      this.v.update = { v: rel.version, news: rel.news, size: rel.size, state: 'ask', rel };
    }
    if (next && this.v.appUpdate?.state !== 'run') {
      this.v.appUpdate = { v: next.version, news: next.news, size: next.size, state: 'ask', rel: next };
    }
    this.push();
    if (!manual) return;
    if (this.v.update?.state === 'ask' || this.v.appUpdate?.state === 'ask') this.emit('open', 'update');
    else this.toast('У вас последняя версия');
  }

  async updateAll() {
    await this.doUpdate();
    await this.doAppUpdate();
  }

  // Служба работает сама по себе, поэтому обход не прерывается
  async doAppUpdate() {
    const a = this.v.appUpdate;
    if (!a || a.state !== 'ask') return;
    Object.assign(a, { state: 'run', pct: 0 });
    this.push();
    try {
      const file = await this.updater.downloadApp(a.rel, path.join(this.dataDir, 'update'), pct => {
        if (pct === a.pct) return;
        a.pct = pct;
        this.push();
      });
      this.updater.installApp(file);
      this.emit('quit');
    } catch (e) {
      this.log(e);
      a.state = 'ask';
      this.toast(`Обновление приложения не удалось: ${e.message}`);
      this.push();
    }
  }

  updateSteps() {
    const on = this.v.conn === 'on', name = this.strategies.find(s => s.file === this.d.strategy)?.name;
    return [['get', 'Скачиваем новую версию'], ['sum', 'Сверяем контрольную сумму с GitHub'], on && ['stop', 'Останавливаем обход на несколько секунд'],
      ['files', 'Заменяем файлы, ваши списки не трогаем'], on && ['service', 'Заново ставим службу'], on && ['check', `Проверяем способ ${name}`]].filter(Boolean);
  }

  stepTo(key) {
    const u = this.v.update;
    u.i = u.steps.findIndex(s => s[0] === key);
    this.push();
  }

  async doUpdate() {
    const u = this.v.update;
    if (!u || u.state !== 'ask') return;
    const wasOn = this.v.conn === 'on', strategy = this.d.strategy, before = this.d.core;
    Object.assign(u, { state: 'run', i: 0, steps: this.updateSteps() });
    this.push();
    let next;
    try {
      next = await this.updater.prepare(u.rel, this.coreRoot, { onStep: () => this.stepTo('sum') });
    } catch (e) {
      this.log(e);
      u.state = 'ask';
      this.toast(`Обновление не удалось: ${e.message}. Всё осталось как было`);
      return this.push();
    }
    try {
      if (wasOn) { this.stepTo('stop'); await this.engine.stopService(); }
      this.stepTo('files');
      Object.assign(this.d, { previousCore: before, core: next.version, serviceBin: null });
      this.reload();
      this.store.save();
      if (wasOn) {
        const keep = this.strategies.some(s => s.file === strategy);
        if (keep) {
          this.stepTo('service');
          await this.connectWith(strategy);
          this.stepTo('check');
        }
        if (!keep || !await this.stillWorks(strategy)) {
          this.v.update = null;
          this.toast('После обновления способ перестал открывать ваши цели. Подбираем новый');
          await this.startScan({ reason: 'heal' });
          if (this.v.conn !== 'on') await this.rollback(before, strategy);
          else this.cleanupCores();
          return;
        }
      }
      this.cleanupCores();
      u.state = 'done';
      this.v.lastUpdatedTo = next.version;
      this.save();
    } catch (e) {
      this.log(e);
      await this.rollback(before, strategy);
    }
  }

  async stillWorks(file) {
    const prev = this.d.results?.[file];
    const targets = cfg.scanTargets(this.coreDir, this.d);
    for (const t of targets.list) {
      const now = await scan.checkUrls(this.engine, t.urls);
      if (now.ok === 0 && (!prev?.targets?.[t.id] || prev.targets[t.id].ok > 0)) return false;
    }
    return true;
  }

  async rollback(version, strategy) {
    Object.assign(this.d, { core: version, serviceBin: null, strategy });
    this.v.update = null;
    this.reload();
    this.toast('Новая версия не заработала, вернули прошлую');
    if (strategy) await this.connectWith(strategy).catch(e => this.toast(e.message));
    this.save();
  }

  cleanupCores() {
    for (const dir of fs.readdirSync(this.coreRoot)) {
      if (dir !== this.d.core && dir !== this.d.previousCore) fs.rmSync(path.join(this.coreRoot, dir), { recursive: true, force: true });
    }
  }

  async ipsetUpdate() {
    const n = await this.updater.updateIpset(this.coreDir);
    this.d.ipsetDate = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    this.changed();
    this.toast(`Список адресов обновлён: ${n.toLocaleString('ru-RU')} записей`);
  }

  async hostsUpdate() {
    const changed = await this.updater.updateHosts();
    await this.engine.flushDns();
    this.v.hostsOk = true;
    this.toast(changed ? 'Файл hosts обновлён, остальные записи не тронули' : 'Файл hosts уже актуальный');
    this.push();
  }

  // Следим за доступом: два провала подряд при живом интернете означают, что способ устарел
  async healthTick() {
    if (this.v.conn !== 'on' || !await this.engine.hasInternet()) return;
    const targets = cfg.scanTargets(this.coreDir, this.d).list;
    const prev = this.d.results?.[this.d.strategy];
    let broken = null;
    for (const t of targets) {
      if (prev?.targets?.[t.id] && !prev.targets[t.id].ok) continue;
      const now = await scan.checkUrls(this.engine, t.urls);
      if (now.ok === 0) { broken = t.id; break; }
    }
    this.v.lastCheck = Date.now();
    this.healthFails = broken ? this.healthFails + 1 : 0;
    if (this.healthFails < 2) return this.push();
    this.healthFails = 0;
    const name = this.targets().find(t => t.id === broken)?.name || 'Цель';
    if (this.d.autoheal) { this.toast(`${name} перестал открываться. Подбираем новый способ`); return this.startScan({ reason: 'heal' }); }
    this.v.banner = { kind: 'warn', text: `${name} перестал открываться.`, action: 'Подобрать новый способ', act: 'heal' };
    this.push();
  }
}

module.exports = { Controller };
