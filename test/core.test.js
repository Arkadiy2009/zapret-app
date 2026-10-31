const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const st = require('../src/main/strategy');
const cfg = require('../src/main/config');
const scan = require('../src/main/scan');
const up = require('../src/main/update');
const { CATALOG } = require('../src/shared/catalog');
const { Store } = require('../src/main/store');

const CORE = path.join(__dirname, '..', 'resources', 'core');
const VARS = { BIN: 'C:\\ProgramData\\zapret\\core\\1.10.4\\bin\\', LISTS: 'C:\\ProgramData\\zapret\\core\\1.10.4\\lists\\', GameFilter: '12', GameFilterTCP: '12', GameFilterUDP: '12' };
const bat = name => fs.readFileSync(path.join(CORE, name), 'utf8');

function tempCore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcore-'));
  fs.cpSync(CORE, dir, { recursive: true });
  return dir;
}
const data = over => ({ ...new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'zs-'))).data, ...over });

test('разбираются все способы запрета', () => {
  const list = st.loadStrategies(CORE, VARS);
  assert.strictEqual(list.length, 22);
  for (const s of list) {
    assert.ok(s.args.length > 20, s.file);
    assert.ok(s.args.every(a => a.startsWith('--')), `${s.file}: ${s.args.find(a => !a.startsWith('--'))}`);
    assert.ok(!s.args.join(' ').includes('%'), s.file);
    assert.ok(!s.args.join(' ').includes('"'), s.file);
    assert.ok(!s.args.includes('^'), s.file);
  }
});

test('аргументы general.bat совпадают с файлом дословно', () => {
  const args = st.parseBat(bat('general.bat'), VARS);
  assert.strictEqual(args[0], '--wf-tcp=80,443,2053,2083,2087,2096,8443,12');
  assert.strictEqual(args[1], '--wf-udp=443,19294-19344,50000-50100,12');
  assert.strictEqual(args[2], '--filter-udp=443');
  assert.strictEqual(args[3], `--hostlist=${VARS.LISTS}list-general.txt`);
  const raw = bat('general.bat').replace(/\^\r?\n/g, ' ');
  const tail = raw.slice(raw.indexOf('winws.exe"') + 10).trim().replace(/"/g, '').replace(/%BIN%/g, VARS.BIN).replace(/%LISTS%/g, VARS.LISTS).replace(/%GameFilter(TCP|UDP)?%/g, '12');
  assert.strictEqual(args.join(' ').replace(/\s+/g, ' '), tail.replace(/\s+/g, ' '));
});

test('--dpi-desync-fake-tls=^! превращается в !', () => {
  const args = st.parseBat(bat('general (FAKE TLS AUTO).bat'), VARS);
  assert.ok(args.includes('--dpi-desync-fake-tls=!'));
});

test('binPath службы: пути в кавычках, числа и значения без пути без них', () => {
  const bin = st.toBinPath('C:\\z\\bin\\winws.exe', ['--wf-tcp=80,443,12', '--hostlist=C:\\z\\lists\\a.txt', '--new', '--dpi-desync=fake', '--dpi-desync-fake-tls=!', '--dpi-desync-fake-tls=0x00000000']);
  assert.strictEqual(bin, '"C:\\z\\bin\\winws.exe" --wf-tcp=80,443,12 --hostlist="C:\\z\\lists\\a.txt" --new --dpi-desync=fake --dpi-desync-fake-tls=! --dpi-desync-fake-tls=0x00000000');
});

test('binPath доходит до программы одним аргументом с кавычками внутри', () => {
  const bin = st.toBinPath('C:\\z\\bin\\winws.exe', ['--hostlist=C:\\z\\lists\\a.txt']);
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'binPath=', bin], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(r.stdout), ['binPath=', bin]);
});

test('названия способов и файл версии', () => {
  assert.strictEqual(st.strategyName('general.bat'), 'Стандартный');
  assert.strictEqual(st.strategyName('general (ALT11).bat'), 'ALT11');
  assert.strictEqual(st.strategyName('general (FAKE TLS AUTO ALT2).bat'), 'Авто TLS ALT2');
  assert.strictEqual(st.strategyName('general (SIMPLE FAKE).bat'), 'Простой');
  assert.strictEqual(st.coreVersion(CORE), '1.10.4');
  assert.ok(fs.existsSync(path.join(CORE, 'LICENSE.txt')));
});

test('пустые личные списки получают заглушки, как в service.bat', () => {
  const dir = tempCore();
  cfg.applyConfig(dir, data());
  const read = f => fs.readFileSync(path.join(dir, 'lists', f), 'utf8');
  assert.match(read('list-general-user.txt'), /domain\.example\.abc/);
  assert.match(read('ipset-exclude-user.txt'), /203\.0\.113\.113\/32/);
  assert.strictEqual(read('ipset-all.txt').trim(), '203.0.113.113/32');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'utils', 'game_filter.enabled'), 'utf8'), 'mode=disabled\ntcp=1024-65535\nudp=1024-65535\n');
});

test('WARDOGS пишет ровно три строки пользователя и не трогает исключения', () => {
  const dir = tempCore();
  const before = fs.readFileSync(path.join(dir, 'lists', 'list-exclude.txt'), 'utf8');
  cfg.applyConfig(dir, data({ catalog: ['wardogs'] }));
  const text = fs.readFileSync(path.join(dir, 'lists', 'list-general-user.txt'), 'utf8');
  for (const d of ['live.wardogs.bulkhead.pragmaengine.com', 'firstlook.gg', 'api.epicgames.dev']) assert.ok(text.includes(d));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'lists', 'list-exclude.txt'), 'utf8').trim(), before.trim());
});

test('список адресов: режимы, личные IP и IP каталога', () => {
  const dir = tempCore();
  const read = () => fs.readFileSync(path.join(dir, 'lists', 'ipset-all.txt'), 'utf8');
  cfg.applyConfig(dir, data({ ipset: 'any' }));
  assert.strictEqual(read(), '');
  const d = data({ ipset: 'loaded', catalog: ['roblox'] });
  d.lists.ipadd.push('198.51.100.0/24');
  cfg.applyConfig(dir, d);
  const text = read();
  assert.ok(text.split('\n').length > 33000);
  assert.ok(text.includes('128.116.0.0/17') && text.includes('198.51.100.0/24'));
  assert.ok(!text.includes('203.0.113.113/32'));
});

test('повторное применение не накапливает изменения в исключениях', () => {
  const dir = tempCore();
  cfg.applyConfig(dir, data({ catalog: ['steam'] }));
  assert.ok(!/^steampowered\.com$/m.test(fs.readFileSync(path.join(dir, 'lists', 'list-exclude.txt'), 'utf8')));
  cfg.applyConfig(dir, data({ catalog: [] }));
  assert.ok(/^steampowered\.com$/m.test(fs.readFileSync(path.join(dir, 'lists', 'list-exclude.txt'), 'utf8')));
});

test('режим для игр меняет порты в аргументах', () => {
  assert.deepStrictEqual(cfg.gameVars({ mode: 'off', tcp: '1024-65535', udp: '1024-65535' }), { GameFilter: '12', GameFilterTCP: '12', GameFilterUDP: '12' });
  assert.deepStrictEqual(cfg.gameVars({ mode: 'udp', tcp: '1-2', udp: '3-4' }), { GameFilter: '3-4', GameFilterTCP: '12', GameFilterUDP: '3-4' });
  const dir = tempCore();
  const list = st.loadStrategies(dir, cfg.winwsVars(dir, data({ game: { mode: 'all', tcp: '1024-65535', udp: '1024-65535' } })));
  assert.ok(list[0].args[0].endsWith(',1024-65535'));
});

test('проверка портов как в service.bat', () => {
  assert.strictEqual(cfg.validPorts('1024-1934, 1936-65535'), '1024-1934,1936-65535');
  for (const bad of ['', 'abc', '0-5', '70000', '5-1', '1,,2']) assert.strictEqual(cfg.validPorts(bad), null, bad);
});

test('каталог: домены из исключений запрета сняты явно', () => {
  const exclude = fs.readFileSync(path.join(CORE, 'lists', 'list-exclude.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const ids = new Set();
  for (const c of CATALOG) {
    assert.ok(!ids.has(c.id), c.id); ids.add(c.id);
    assert.ok(c.domains.length && c.aliases.length, c.id);
    for (const d of c.domains) assert.match(d, /^([a-z0-9-]+\.)+[a-z]{2,}$/, d);
    if (c.id === 'wardogs') continue;
    for (const d of c.domains) {
      const hit = exclude.find(e => d === e || d.endsWith(`.${e}`));
      if (hit) assert.ok((c.unexclude || []).includes(hit), `${c.id}: ${d} исключён записью ${hit}`);
    }
    for (const e of c.unexclude || []) assert.ok(exclude.includes(e), `${c.id}: ${e} нет в исключениях`);
  }
});

test('цели подбора читаются из targets.txt', () => {
  const t = cfg.readTargets(CORE);
  assert.strictEqual(t.yt.length, 4);
  assert.strictEqual(t.dc.length, 4);
  assert.strictEqual(t.base.length, 4);
  assert.strictEqual(t.pings.length, 4);
});

test('выбор лучшего: цели важнее, затем общая связь, затем пинг', () => {
  const r = {
    a: { targets: { yt: { ok: 12, total: 12 }, dc: { ok: 6, total: 12 } }, base: { ok: 12, total: 12 }, ping: 20 },
    b: { targets: { yt: { ok: 12, total: 12 }, dc: { ok: 12, total: 12 } }, base: { ok: 6, total: 12 }, ping: 90 },
    c: { targets: { yt: { ok: 12, total: 12 }, dc: { ok: 12, total: 12 } }, base: { ok: 6, total: 12 }, ping: 30 },
    d: { failed: true },
  };
  assert.strictEqual(scan.bestOf(r, ['yt', 'dc']), 'c');
});

test('подмена DNS определяется только если все способы дают SSL', () => {
  const bad = { targets: { yt: { ok: 0, total: 12, ssl: 12 } } };
  assert.ok(scan.looksLikeDnsHijack({ a: bad, b: bad }, ['yt']));
  assert.ok(!scan.looksLikeDnsHijack({ a: bad, b: { targets: { yt: { ok: 3, total: 12, ssl: 0 } } } }, ['yt']));
});

test('заметки релиза и hosts', () => {
  assert.deepStrictEqual(up.parseNews('* Изменены **ALT11**\n  * вложено by @a in https://x\n**Full Changelog**: y'), ['Изменены ALT11', 'вложено']);
  const block = '1.1.1.1 a.com\r\n2.2.2.2 b.com';
  const once = up.mergeHosts('127.0.0.1 local\r\n', block);
  assert.ok(up.hostsActual(once, block));
  const twice = up.mergeHosts(once, '3.3.3.3 c.com');
  assert.ok(twice.includes('127.0.0.1 local') && twice.includes('c.com') && !twice.includes('a.com'));
  assert.strictEqual(twice.match(/zapret-app start/g).length, 1);
});

test('релиз: подмена суммы, адреса и битый архив отвергаются', async () => {
  const ok = { assets: [{ name: 'zapret-discord-youtube-1.10.5.zip', digest: `sha256:${'a'.repeat(64)}`, browser_download_url: 'https://github.com/Flowseal/zapret-discord-youtube/releases/download/1.10.5/z.zip', size: 1 }], tag_name: '1.10.5', body: '' };
  const net = j => async () => ({ ok: true, json: async () => j });
  assert.strictEqual((await up.latestRelease(net(ok))).version, '1.10.5');
  await assert.rejects(up.latestRelease(net({ ...ok, assets: [{ ...ok.assets[0], browser_download_url: 'https://evil.example/z.zip' }] })), /Неожиданный адрес/);
  await assert.rejects(up.latestRelease(net({ ...ok, assets: [{ ...ok.assets[0], digest: '' }] })), /контрольную сумму/);
  const file = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('fake') });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-'));
  await assert.rejects(up.prepare({ url: 'x', sha256: 'b'.repeat(64), version: '1' }, root, { net: file }), /Контрольная сумма/);
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

test('архив без winws не принимается', () => {
  const dir = tempCore();
  fs.rmSync(path.join(dir, 'bin', 'winws.exe'));
  assert.throws(() => st.validateCore(dir), /winws\.exe/);
});

test('настоящие команды Windows: кавычки и разбор вывода (только чтение)', { skip: process.platform !== 'win32' }, async () => {
  const e = require('../src/main/engine');
  assert.strictEqual(await e.serviceState('BFE'), 'running');
  assert.strictEqual(await e.serviceState('NoSuchServiceZapretTest'), 'none');
  assert.strictEqual(typeof await e.winwsRunning(), 'boolean');
});

const rel = (tag, name = `zapret-setup-${tag.replace('v', '')}.exe`, repo = 'owner/app', digest = `sha256:${'a'.repeat(64)}`) => ({ ok: true, json: async () => ({ tag_name: tag, body: '- Новое', assets: [{ name, size: 10, digest, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` }] }) });

test('оболочка: сравнение версий и проверка адреса', async () => {
  const update = require('../src/main/update');
  assert.ok(update.isNewer('v1.10.0', '1.9.9'));
  assert.ok(!update.isNewer('v1.0.0', '1.0.0'));
  assert.ok(!update.isNewer('v0.9.0', '1.0.0'));
  assert.ok(!update.isNewer('бета', '1.0.0'));
  assert.strictEqual(await update.latestApp('1.1.0', async () => rel('v1.1.0'), 'owner/app'), null);
  const next = await update.latestApp('1.1.0', async () => rel('v1.2.0'), 'owner/app');
  assert.strictEqual(next.version, '1.2.0');
  await assert.rejects(update.latestApp('1.1.0', async () => rel('v1.2.0', undefined, 'evil/app'), 'owner/app'), /Неожиданный адрес/);
  await assert.rejects(update.latestApp('1.1.0', async () => rel('v1.2.0', undefined, 'owner/app', ''), 'owner/app'), /контрольную сумму/);
});

test('оболочка: подменённый установщик удаляется', async () => {
  const update = require('../src/main/update');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapp-'));
  const body = Buffer.from('installer');
  const net = async () => new Response(body);
  const sum = require('crypto').createHash('sha256').update(body).digest('hex');
  const pcts = [];
  const file = await update.downloadApp({ url: 'x', size: body.length, sha256: sum }, dir, p => pcts.push(p), net);
  assert.deepStrictEqual(fs.readFileSync(file), body);
  assert.ok(pcts.length);
  await assert.rejects(update.downloadApp({ url: 'x', size: body.length, sha256: '0'.repeat(64) }, dir, undefined, net), /не совпала/);
  assert.ok(!fs.existsSync(file));
});
