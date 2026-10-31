// Сценарии приложения на заглушке системы: winws и службы здесь не запускаются
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Controller } = require('../src/main/controller');
const { createMockEngine, createMockUpdater } = require('../src/main/mock');

const CORE = path.join(__dirname, '..', 'resources', 'core');

async function make(scenario = {}, updaterScenario = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-'));
  const engine = createMockEngine({ scenario: { delay: 0, ...scenario } });
  const updater = createMockUpdater({ bundledCore: CORE, nextVersion: '1.10.5', scenario: updaterScenario });
  const c = new Controller({ dataDir, bundledCore: CORE, engine, updater });
  const toasts = [], opened = [];
  c.on('toast', t => toasts.push(t));
  c.on('open', t => opened.push(t));
  await c.init();
  c.dispose();
  return { c, engine, toasts, opened, dataDir };
}

test('первое подключение: подбор, служба, остановка на первом идеальном способе', async () => {
  const { c, engine, toasts } = await make({ perfect: true });
  await c.finishOnboarding();
  assert.strictEqual(c.v.conn, 'on');
  assert.strictEqual(engine.state.service, 'running');
  assert.strictEqual(c.d.strategy, c.strategies[0].file);
  assert.strictEqual(Object.keys(c.d.results).length, 1);
  assert.match(toasts.at(-1), /подходит под всё/);
  assert.ok(engine.state.calls.some(x => x[0] === 'install' && x[3] === true));
});

test('полная проверка проходит все 22', async () => {
  const { c } = await make({ perfect: true });
  await c.startScan({ full: true });
  assert.strictEqual(Object.keys(c.d.results).length, 22);
});

test('отключение и быстрое включение без новой установки службы', async () => {
  const { c, engine } = await make({ perfect: true });
  await c.startScan({});
  await c.primary();
  assert.strictEqual(c.v.conn, 'off');
  const before = engine.state.calls.filter(x => x[0] === 'install').length;
  await c.primary();
  assert.strictEqual(c.v.conn, 'on');
  assert.strictEqual(engine.state.calls.filter(x => x[0] === 'install').length, before);
});

test('игра из каталога включает игровой режим, и служба ставится с новыми портами', async () => {
  const { c, engine } = await make({ perfect: true });
  await c.startScan({});
  c.addCatalog('roblox');
  assert.strictEqual(c.d.game.mode, 'all');
  assert.strictEqual(c.d.ipset, 'loaded');
  assert.strictEqual(c.v.banner.act, 'rescan');
  await c.connectWith(c.d.strategy);
  const last = engine.state.calls.filter(x => x[0] === 'install').at(-1);
  assert.ok(last[4][0].endsWith(',1024-65535'));
  c.removeTarget('roblox');
  assert.ok(!c.d.catalog.includes('roblox'));
  c.dispose();
});

test('подмена DNS: окно вместо подключения, после исправления подбор успешен', async () => {
  const { c, engine, opened } = await make({ dnsHijack: true });
  await c.startScan({ reason: 'first' });
  assert.strictEqual(c.v.conn, 'off');
  assert.ok(c.v.dnsBad);
  assert.deepStrictEqual(opened, ['dns']);
  engine.state.scenario.perfect = true;
  await c.enableDns();
  await new Promise(r => setTimeout(r, 300));
  while (c.v.conn === 'scan') await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(c.v.conn, 'on');
  assert.ok(c.d.dohEnabled);
});

test('отмена подбора возвращает прошлый способ', async () => {
  const { c } = await make({ perfect: true });
  await c.startScan({});
  const was = c.d.strategy;
  const p = c.startScan({ full: true });
  await new Promise(r => setTimeout(r, 30));
  c.cancelScan();
  await p;
  assert.strictEqual(c.v.conn, 'on');
  assert.strictEqual(c.d.strategy, was);
});

test('глубокая проверка возвращает режим адресов', async () => {
  const { c } = await make({ perfect: true });
  c.d.ipset = 'loaded';
  await c.startScan({ full: true, deep: true });
  assert.strictEqual(c.d.ipset, 'loaded');
  assert.strictEqual(c.d.ipsetRestore, undefined);
  assert.notStrictEqual(fs.readFileSync(path.join(c.coreDir, 'lists', 'ipset-all.txt'), 'utf8').length, 0);
});

test('обновление: списки на месте, служба заново, старая версия оставлена для отката', async () => {
  const { c, engine } = await make({ perfect: true });
  await c.startScan({});
  c.addDomain('example.org');
  c.d.lists.ipadd.push('198.51.100.0/24');
  await c.checkUpdate(true);
  assert.strictEqual(c.v.update.v, '1.10.5');
  await c.doUpdate();
  assert.strictEqual(c.v.update.state, 'done');
  assert.strictEqual(c.d.core, '1.10.5');
  assert.strictEqual(c.d.previousCore, '1.10.4');
  assert.ok(fs.existsSync(path.join(c.coreRoot, '1.10.4')));
  assert.strictEqual(c.v.conn, 'on');
  assert.ok(engine.state.calls.filter(x => x[0] === 'install').at(-1)[1].includes('1.10.5'));
  assert.ok(fs.readFileSync(path.join(c.coreDir, 'lists', 'list-general-user.txt'), 'utf8').includes('example.org'));
  assert.ok(fs.readFileSync(path.join(c.coreDir, 'lists', 'ipset-all.txt'), 'utf8').includes('198.51.100.0/24'));
});

test('битая загрузка ничего не меняет', async () => {
  const { c, engine, toasts } = await make({ perfect: true }, { badDownload: true });
  await c.startScan({});
  await c.checkUpdate(true);
  await c.doUpdate();
  assert.strictEqual(c.d.core, '1.10.4');
  assert.strictEqual(engine.state.service, 'running');
  assert.strictEqual(c.v.update.state, 'ask');
  assert.match(toasts.at(-1), /Всё осталось как было/);
});

test('ничего не работает после обновления: откат на прошлую версию', async () => {
  const { c, engine, toasts } = await make({ perfect: true });
  await c.startScan({});
  await c.checkUpdate(true);
  engine.state.scenario.perfect = false;
  engine.state.scenario.brokenAll = true;
  engine.probe = async () => 'ERROR';
  await c.doUpdate();
  assert.strictEqual(c.d.core, '1.10.4');
  assert.match(toasts.join(' '), /вернули прошлую/);
});

test('удаление убирает службу и сбрасывает способ, списки остаются', async () => {
  const { c, engine } = await make({ perfect: true });
  await c.startScan({});
  c.addDomain('example.org');
  await c.remove();
  assert.strictEqual(engine.state.service, 'none');
  assert.strictEqual(c.d.strategy, null);
  assert.ok(c.d.lists.general.includes('example.org'));
  c.dispose();
});

test('уже работающая служба запрета подхватывается при запуске', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-'));
  const engine = createMockEngine({ scenario: {} });
  Object.assign(engine.state, { service: 'running', base: 'general (ALT5)' });
  const c = new Controller({ dataDir, bundledCore: CORE, engine, updater: createMockUpdater({ bundledCore: CORE }) });
  await c.init();
  c.dispose();
  assert.strictEqual(c.v.conn, 'on');
  assert.strictEqual(c.d.strategy, 'general (ALT5).bat');
});

test('автоподбор срабатывает только после двух провалов', async () => {
  const { c, engine } = await make({ perfect: true });
  await c.startScan({});
  c.d.autoheal = false;
  engine.probe = async () => 'ERROR';
  await c.healthTick();
  assert.strictEqual(c.v.banner, null);
  await c.healthTick();
  assert.match(c.v.banner.text, /перестал открываться/);
});

test('перенос установленного запрета: способ, строки WARDOGS, игры и адреса', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-'));
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'zold-')) + path.sep;
  fs.cpSync(CORE, old, { recursive: true });
  fs.appendFileSync(path.join(old, 'lists', 'list-general.txt'), '\r\nlive.wardogs.bulkhead.pragmaengine.com\r\nfirstlook.gg\r\napi.epicgames.dev\r\nmy-site.example.org\r\n');
  fs.writeFileSync(path.join(old, 'lists', 'list-general-user.txt'), '# Never leave this file empty\r\ndomain.example.abc\r\n');
  fs.copyFileSync(path.join(old, 'lists', 'ipset-all.txt.backup'), path.join(old, 'lists', 'ipset-all.txt'));
  fs.writeFileSync(path.join(old, 'utils', 'game_filter.enabled'), 'mode=all\r\ntcp=1024-65535\r\nudp=1024-65535\r\n');
  const before = fs.readFileSync(path.join(old, 'lists', 'list-general.txt'), 'utf8');
  const engine = createMockEngine({ scenario: {} });
  Object.assign(engine.state, { service: 'running', base: 'general (ALT)', coreDir: old });
  const c = new Controller({ dataDir, bundledCore: CORE, engine, updater: createMockUpdater({ bundledCore: CORE }) });
  await c.init();
  c.dispose();
  assert.deepStrictEqual(c.d.catalog, ['wardogs']);
  assert.deepStrictEqual(c.d.lists.general, ['my-site.example.org']);
  assert.strictEqual(c.d.game.mode, 'all');
  assert.strictEqual(c.d.ipset, 'loaded');
  assert.strictEqual(c.d.strategy, 'general (ALT).bat');
  await c.finishOnboarding();
  assert.strictEqual(c.v.conn, 'on');
  const last = engine.state.calls.filter(x => x[0] === 'install').at(-1);
  assert.ok(last[1].startsWith(dataDir));
  assert.ok(last[4][0].endsWith(',1024-65535'));
  assert.ok(fs.readFileSync(path.join(c.coreDir, 'lists', 'list-general-user.txt'), 'utf8').includes('firstlook.gg'));
  assert.strictEqual(fs.readFileSync(path.join(old, 'lists', 'list-general.txt'), 'utf8'), before);
});

test('обновление приложения: скачать, запустить установщик, выйти. Служба не трогается', async () => {
  const { c, engine } = await make({ perfect: true, appUpdate: true }, { appUpdate: true });
  await c.startScan({});
  const quit = [];
  c.on('quit', () => quit.push(1));
  const calls = engine.state.calls.length;
  await c.checkUpdate(true);
  assert.strictEqual(c.v.appUpdate.v, '1.2.0');
  assert.strictEqual(c.snapshot().appUpdate.rel, undefined);
  await c.doAppUpdate();
  assert.deepStrictEqual(quit, [1]);
  assert.strictEqual(engine.state.service, 'running');
  assert.strictEqual(engine.state.calls.length, calls);
});

test('запрет и приложение обновляются одной кнопкой, битый установщик ничего не ломает', async () => {
  const { c, toasts } = await make({ perfect: true }, { appUpdate: true, badInstaller: true });
  await c.startScan({});
  const quit = [];
  c.on('quit', () => quit.push(1));
  await c.checkUpdate(true);
  await c.updateAll();
  assert.strictEqual(c.d.core, '1.10.5');
  assert.strictEqual(c.v.appUpdate.state, 'ask');
  assert.deepStrictEqual(quit, []);
  assert.match(toasts.at(-1), /Контрольная сумма/);
});

test('сбой GitHub у оболочки не мешает обновить запрет', async () => {
  const { c } = await make({ perfect: true });
  c.updater.latestApp = async () => { throw new Error('нет сети'); };
  await c.checkUpdate(false);
  assert.strictEqual(c.v.update.v, '1.10.5');
});

test('способ, который подключили, запоминается и проверяется первым', async () => {
  const { c } = await make({ perfect: true });
  await c.useStrategy(c.strategies[7].file);
  await c.startScan({});
  assert.strictEqual(c.d.strategy, c.strategies[7].file);
  assert.deepStrictEqual(Object.keys(c.d.results), [c.strategies[7].file]);
});
