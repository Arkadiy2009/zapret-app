// Обновление запрета. Официальный путь: скачать релиз Flowseal, сверить сумму,
// положить новую версию рядом со старой. Старая остаётся для отката.
// Сама оболочка обновляется отдельно, из своего репозитория.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { once } = require('events');
const { finished } = require('stream/promises');
const { ps } = require('./exec');
const { validateCore, coreVersion } = require('./strategy');

const REPO = 'Flowseal/zapret-discord-youtube';
const API = `https://api.github.com/repos/${REPO}/releases`;
const APP_REPO = require('../../package.json').zapretRepo;
const RAW = `https://raw.githubusercontent.com/${REPO}/main/.service`;
const HEADERS = { 'User-Agent': 'zapret-app', 'Cache-Control': 'no-cache' };

async function getJson(url, net) {
  const res = await net(url, { headers: { ...HEADERS, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  return res.json();
}

// Файл релиза с проверенной суммой и адресом: скачивать разрешено только из нужного репозитория
function asset(j, repo, pattern) {
  const file = (j.assets || []).find(a => pattern.test(a.name));
  if (!file) throw new Error('В релизе нет нужного файла');
  const digest = (file.digest || '').replace(/^sha256:/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('GitHub не указал контрольную сумму');
  const url = new URL(file.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${repo}/releases/download/`)) throw new Error('Неожиданный адрес файла');
  return { url: file.browser_download_url, size: file.size, sha256: digest };
}

const coreRelease = j => ({ version: j.tag_name, news: parseNews(j.body), ...asset(j, REPO, /^zapret-discord-youtube-.+\.zip$/) });
const latestRelease = async (net = fetch) => coreRelease(await getJson(`${API}/latest`, net));
const coreByTag = async (tag, net = fetch) => coreRelease(await getJson(`${API}/tags/${encodeURIComponent(tag)}`, net));

function isNewer(next, current) {
  const parts = v => String(v).replace(/^v/, '').split('.').map(Number);
  const [a, b] = [parts(next), parts(current)];
  if (a.length !== 3 || a.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== (b[i] || 0)) return a[i] > (b[i] || 0);
  return false;
}

// Новая версия оболочки из нашего репозитория. null, если обновляться не на что
async function latestApp(current, net = fetch, repo = APP_REPO) {
  const j = await getJson(`https://api.github.com/repos/${repo}/releases/latest`, net);
  if (!isNewer(j.tag_name, current)) return null;
  return { version: j.tag_name.replace(/^v/, ''), news: parseNews(j.body), ...asset(j, repo, /^zapret-setup-[\w.-]+\.exe$/) };
}

// Папка dir закрыта от записи обычным пользователям: установщик запускается от администратора
async function downloadApp(rel, dir, onPct = () => {}, net = fetch) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'zapret-setup.exe');
  const res = await net(rel.url, { headers: HEADERS, signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!res.ok) throw new Error(`Установщик не скачался: ${res.status}`);
  const hash = crypto.createHash('sha256'), out = fs.createWriteStream(file);
  let got = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
      if (rel.size) onPct(Math.min(99, Math.floor(got / rel.size * 100)));
    }
  } finally {
    out.end();
    await finished(out);
  }
  if (hash.digest('hex') !== rel.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error('Контрольная сумма установщика не совпала');
  }
  return file;
}

// --updated сохраняет службу и настройки, --force-run запускает приложение после установки
function installApp(file) {
  spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
}

function parseNews(body = '') {
  return body.split(/\r?\n/)
    .filter(l => /^\s*[*-]\s/.test(l) && !l.includes('Full Changelog'))
    .map(l => l.replace(/^\s*[*-]\s+/, '').replace(/\*\*/g, '').replace(/\s+by @\S+.*$/, '').replace(/`/g, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function download(rel, dest, net = fetch) {
  const res = await net(rel.url, { headers: HEADERS, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Архив не скачался: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  if (sum !== rel.sha256) throw new Error('Контрольная сумма архива не совпала');
  fs.writeFileSync(dest, buf);
}

async function unpack(zip, dest) {
  const q = s => `'${s.replace(/'/g, "''")}'`;
  const r = await ps(`Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dest)} -Force`, { timeout: 120000 });
  if (r.code !== 0) throw new Error('Архив не распаковался');
}

// Готовит новую версию: скачивание, сверка, распаковка, проверка содержимого
async function prepare(rel, coreRoot, { onStep = () => {}, net = fetch, unzip = unpack } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-update-'));
  try {
    const zip = path.join(tmp, 'core.zip');
    await download(rel, zip, net);
    onStep('verified');
    const dir = path.join(tmp, 'x');
    await unzip(zip, dir);
    const top = fs.readdirSync(dir);
    const inner = top.length === 1 && fs.statSync(path.join(dir, top[0])).isDirectory() ? path.join(dir, top[0]) : dir;
    validateCore(inner);
    const version = coreVersion(inner) || rel.version;
    if (!/^[\w.-]+$/.test(version)) throw new Error('Странный номер версии');
    const target = path.join(coreRoot, version);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(inner, target, { recursive: true });
    return { version, dir: target };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function fetchText(url, net = fetch) {
  const res = await net(`${url}?t=${Date.now()}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  return res.text();
}

// Список IP заменяется целиком, поэтому личные адреса хранятся отдельно в настройках
async function updateIpset(coreDir, net = fetch) {
  const text = await fetchText(`${RAW}/ipset-service.txt`, net);
  const lines = text.split(/\r?\n/).filter(l => /^[0-9a-f:.]+\/\d+$/i.test(l.trim()));
  if (lines.length < 1000) throw new Error('Список адресов пришёл неполным');
  fs.writeFileSync(path.join(coreDir, 'lists', 'ipset-all.txt.backup'), lines.join('\n') + '\n');
  return lines.length;
}

const HOSTS_FILE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const MARK_START = '# zapret-app start';
const MARK_END = '# zapret-app end';

function mergeHosts(current, block) {
  const clean = current.replace(new RegExp(`\\r?\\n?${MARK_START}[\\s\\S]*?${MARK_END}\\r?\\n?`, 'g'), '\n').trimEnd();
  return `${clean}\r\n\r\n${MARK_START}\r\n${block.trim().replace(/\r?\n/g, '\r\n')}\r\n${MARK_END}\r\n`;
}

function hostsActual(current, block) {
  const lines = block.trim().split(/\r?\n/);
  return current.includes(lines[0].trim()) && current.includes(lines[lines.length - 1].trim());
}

async function updateHosts({ net = fetch, file = HOSTS_FILE } = {}) {
  const block = await fetchText(`${RAW}/hosts`, net);
  if (!/^\d+\.\d+\.\d+\.\d+\s+\S+/m.test(block)) throw new Error('Файл hosts пришёл пустым');
  const current = fs.readFileSync(file, 'utf8');
  if (hostsActual(current, block)) return false;
  fs.copyFileSync(file, `${file}.zapret-backup`);
  fs.writeFileSync(file, mergeHosts(current, block));
  return true;
}

async function dpiSuite(net = fetch) {
  const res = await net('https://hyperion-cs.github.io/dpi-checkers/ru/tcp-16-20/suite.v2.json', { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Набор глубокой проверки не скачался');
  const list = (await res.json()).filter(s => /^[\w.-]+$/.test(s.host || ''));
  if (!list.length) throw new Error('Набор глубокой проверки пуст');
  return list;
}

module.exports = { dpiSuite, latestRelease, coreByTag, latestApp, isNewer, downloadApp, installApp, parseNews, prepare, updateIpset, updateHosts, mergeHosts, hostsActual, HOSTS_FILE };
