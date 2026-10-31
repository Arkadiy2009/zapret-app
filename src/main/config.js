// Переводит настройки приложения в файлы, которые читает winws.
// Формат файлов и значения по умолчанию те же, что в service.bat.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CATALOG } = require('../shared/catalog');

const STUB_IP = '203.0.113.113/32';
const STUB_DOMAIN = 'domain.example.abc';

const activeCatalog = data => CATALOG.filter(c => data.catalog.includes(c.id));
const uniq = list => [...new Set(list)];

function gameVars(game) {
  const tcp = game.mode === 'all' || game.mode === 'tcp' ? game.tcp : '12';
  const udp = game.mode === 'all' || game.mode === 'udp' ? game.udp : '12';
  return { GameFilter: game.mode === 'udp' ? udp : tcp, GameFilterTCP: tcp, GameFilterUDP: udp };
}

function winwsVars(coreDir, data) {
  return { BIN: path.join(coreDir, 'bin') + path.sep, LISTS: path.join(coreDir, 'lists') + path.sep, ...gameVars(data.game) };
}

function ipsetText(coreDir, data) {
  if (data.ipset === 'any') return '';
  const extra = uniq([...data.lists.ipadd, ...activeCatalog(data).flatMap(c => c.ips || [])]);
  if (data.ipset === 'none') return [STUB_IP, ...extra].join('\n') + '\n';
  const full = fs.readFileSync(path.join(coreDir, 'lists', 'ipset-all.txt.backup'), 'utf8').trimEnd();
  return [full, ...extra].join('\n') + '\n';
}

function applyConfig(coreDir, data) {
  const lists = path.join(coreDir, 'lists');
  const write = (name, text) => fs.writeFileSync(path.join(lists, name), text);
  const active = activeCatalog(data);

  const general = uniq([...data.lists.general, ...active.flatMap(c => c.domains)]);
  write('list-general-user.txt', ['# Never leave this file empty', ...(general.length ? general : [STUB_DOMAIN])].join('\n') + '\n');
  write('list-exclude-user.txt', [...(data.lists.exclude.length ? data.lists.exclude : [STUB_DOMAIN])].join('\n') + '\n');
  write('ipset-exclude-user.txt', [...(data.lists.ipskip.length ? data.lists.ipskip : [STUB_IP])].join('\n') + '\n');
  write('ipset-all.txt', ipsetText(coreDir, data));

  // Часть сервисов запрет исключает из обхода. Каталог снимает только свои записи
  const orig = path.join(lists, 'list-exclude.orig.txt');
  if (!fs.existsSync(orig)) fs.copyFileSync(path.join(lists, 'list-exclude.txt'), orig);
  const drop = new Set(active.flatMap(c => c.unexclude || []));
  const kept = fs.readFileSync(orig, 'utf8').split(/(?<=\n)/).filter(l => !drop.has(l.trim()));
  write('list-exclude.txt', kept.join(''));

  const g = data.game;
  const mode = g.mode === 'off' ? 'disabled' : g.mode;
  fs.writeFileSync(path.join(coreDir, 'utils', 'game_filter.enabled'), `mode=${mode}\ntcp=${g.tcp}\nudp=${g.udp}\n`);

  const bin = path.join(coreDir, 'bin');
  if (data.fakes.discord) fs.copyFileSync(path.join(bin, `${data.fakes.discord}.bin`), path.join(bin, 'ACTIVE_DISCORD_UDP.bin'));
  if (data.fakes.game) fs.copyFileSync(path.join(bin, `${data.fakes.game}.bin`), path.join(bin, 'ACTIVE_GAME_UDP.bin'));
}

function listFakes(coreDir) {
  return fs.readdirSync(path.join(coreDir, 'bin'))
    .filter(f => f.endsWith('.bin') && !f.startsWith('ACTIVE_'))
    .map(f => f.slice(0, -4));
}

// Какой пакет сейчас подставлен, узнаём по содержимому, как service.bat
function activeFakes(coreDir) {
  const bin = path.join(coreDir, 'bin');
  const sum = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(bin, f))).digest('hex');
  const byHash = new Map(listFakes(coreDir).map(n => [sum(`${n}.bin`), n]));
  return { discord: byHash.get(sum('ACTIVE_DISCORD_UDP.bin')) || null, game: byHash.get(sum('ACTIVE_GAME_UDP.bin')) || null };
}

function validPorts(text) {
  const value = String(text).replace(/\s/g, '');
  if (!value) return null;
  const ok = value.split(',').every(part => {
    const m = part.match(/^([1-9]\d{0,4})(?:-([1-9]\d{0,4}))?$/);
    return m && +m[1] <= 65535 && +(m[2] || m[1]) <= 65535 && +m[1] <= +(m[2] || m[1]);
  });
  return ok ? value : null;
}

// Цели подбора: группы из targets.txt, игры из каталога и сайты пользователя
function readTargets(coreDir) {
  const groups = { yt: [], dc: [], base: [], pings: [] };
  const text = fs.readFileSync(path.join(coreDir, 'utils', 'targets.txt'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\w+)\s*=\s*"(.+)"\s*$/);
    if (!m) continue;
    if (m[2].startsWith('PING:')) groups.pings.push(m[2].slice(5).trim());
    else if (/^YouTube/i.test(m[1])) groups.yt.push(m[2]);
    else if (/^Discord/i.test(m[1])) groups.dc.push(m[2]);
    else groups.base.push(m[2]);
  }
  return groups;
}

function scanTargets(coreDir, data) {
  const g = readTargets(coreDir);
  const list = [];
  const on = id => data.targets.find(t => t.id === id)?.on;
  if (on('yt')) list.push({ id: 'yt', urls: g.yt });
  if (on('dc')) list.push({ id: 'dc', urls: g.dc });
  for (const c of activeCatalog(data)) if (on(c.id)) list.push({ id: c.id, urls: (c.probe || c.domains.slice(0, 2)).map(d => `https://${d}`) });
  for (const s of data.sites) if (on(s)) list.push({ id: s, urls: [`https://${s}`] });
  return { list, base: g.base, pings: g.pings };
}

module.exports = { applyConfig, winwsVars, gameVars, validPorts, listFakes, activeFakes, readTargets, scanTargets, activeCatalog, STUB_IP, STUB_DOMAIN };
