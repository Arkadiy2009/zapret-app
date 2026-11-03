// Данные для журнала разработчика: куда компьютер не может достучаться, что отвечают цели прямо сейчас,
// чей это провайдер и как настроена сеть. Всё собирается только на этом компьютере и уходит
// разработчику, только если человек сам отправит файл.
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const { run, ps } = require('./exec');

const HOUR = 60 * 60 * 1000;
const PROTOS = { HTTP: ['--http1.1'], 'TLS1.2': ['--tlsv1.2', '--tls-max', '1.2'], 'TLS1.3': ['--tlsv1.3', '--tls-max', '1.3'] };

// Внутренние адреса не интересны: они не идут через провайдера
function isPublic(ip) {
  if (/^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (/^(::1?$|fe80:|fc|fd)/i.test(ip)) return false;
  return true;
}

// Соединения, которые повисли на первом шаге: компьютер постучался, а ответа нет
function parseNetstat(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+\s+(\S+)\s+SYN_SENT\s+(\d+)\s*$/i);
    if (!m) continue;
    const at = m[1].lastIndexOf(':');
    const ip = m[1].slice(0, at).replace(/^\[|\]$/g, ''), port = m[1].slice(at + 1);
    if (isPublic(ip)) out.push({ ip, port, pid: +m[2] });
  }
  return out;
}

function parseTasklist(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m) map[m[2]] = m[1];
  }
  return map;
}

async function stuckConnections() {
  const r = await run('netstat.exe', ['-ano', '-p', 'TCP'], { timeout: 15000 });
  const r6 = await run('netstat.exe', ['-ano', '-p', 'TCPv6'], { timeout: 15000 });
  const list = parseNetstat(r.stdout + '\n' + r6.stdout);
  if (!list.length) return [];
  const names = parseTasklist((await run('tasklist.exe', ['/fo', 'csv', '/nh'], { timeout: 15000 })).stdout);
  return list.map(c => ({ ...c, proc: names[c.pid] || `pid ${c.pid}` }));
}

// История за последний час: результаты проверок целей и повисшие соединения
class History {
  constructor(dir) {
    this.file = path.join(dir, 'history.json');
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
    this.data.checks = this.data.checks || [];
    this.data.stuck = this.data.stuck || [];
  }
  prune(now = Date.now()) {
    for (const k of ['checks', 'stuck']) this.data[k] = this.data[k].filter(x => now - x.t < HOUR);
  }
  save() {
    this.prune();
    try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch { /* история не критична */ }
  }
  check(entry) { this.data.checks.push({ t: Date.now(), ...entry }); this.save(); }
  stuck(list) {
    const t = Date.now();
    for (const c of list) this.data.stuck.push({ t, proc: c.proc, ip: c.ip, port: c.port });
    this.save();
  }
  // Повисшие соединения сводим по программе и адресу, чтобы было видно, что повторяется
  summary() {
    this.prune();
    const groups = {};
    for (const s of this.data.stuck) {
      const k = `${s.proc} → ${s.ip}:${s.port}`;
      groups[k] = groups[k] || { n: 0, last: 0 };
      groups[k].n++;
      groups[k].last = Math.max(groups[k].last, s.t);
    }
    return {
      checks: this.data.checks,
      stuck: Object.entries(groups).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ key: k, ...v })),
    };
  }
}

// Подробная проверка адреса: код ошибки curl, HTTP-ответ, время и IP, к которому подключились
async function probeDetail(url, proto, timeoutSec = 6) {
  const r = await run('curl.exe', ['-I', '-s', '--show-error', '-m', String(timeoutSec), '--connect-timeout', '4', '-o', 'NUL', '-w', '%{http_code} %{time_total} %{remote_ip}', ...PROTOS[proto], url], { timeout: (timeoutSec + 3) * 1000 });
  const [http, time, ip] = r.stdout.trim().split(' ');
  // Текст от Windows приходит в другой кодировке, оставляем только английскую часть с кодом ошибки
  const err = (r.stderr.trim().split(/\r?\n/)[0] || '').replace(/^curl: \(\d+\)\s*/, '').split(' - ')[0].replace(/[^\x20-\x7e]/g, '').trim();
  return { proto, code: r.code, http, time: +(+time).toFixed(2), ip: ip || '', err };
}

async function resolve(host) {
  try {
    return (await dns.lookup(host, { all: true })).map(a => a.address);
  } catch (e) {
    return [`ошибка: ${e.code}`];
  }
}

// Провайдер по данным RIPE NCC. Полный IP не записываем, только подсеть /24
async function provider(net = fetch) {
  const once = async u => (await (await net(u, { headers: { 'User-Agent': 'zapret-app' }, signal: AbortSignal.timeout(10000) })).json()).data;
  const get = u => once(u).catch(() => once(u));
  const ip = (await get('https://stat.ripe.net/data/whats-my-ip/data.json')).ip;
  const info = await get(`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`);
  const asn = info.asns?.[0];
  const holder = asn ? (await get(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`)).holder : 'неизвестно';
  const masked = ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + '::/48' : ip.split('.').slice(0, 3).join('.') + '.0/24';
  return { asn: asn ? `AS${asn}` : 'неизвестно', holder, network: masked };
}

const NET_SCRIPT = `
$o=[ordered]@{}
$o.adapters=@(Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { $_.Name + ' (' + $_.InterfaceDescription + ')' })
$o.dns=@(Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count } | ForEach-Object { $_.InterfaceAlias + ': ' + ($_.ServerAddresses -join ', ') })
$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue
$o.proxy=if($p.ProxyEnable -eq 1){[string]$p.ProxyServer}else{'выключен'}
$o.windows=(Get-CimInstance Win32_OperatingSystem | ForEach-Object { $_.Caption + ' ' + $_.Version })
$o.vpn=@(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'TAP|TUN|Wintun|WireGuard|VPN|Amnezia|OpenVPN|Outline|Hiddify|Clash|sing-box' } | ForEach-Object Name)
$o | ConvertTo-Json -Compress`;

async function network() {
  const r = await ps(`$ErrorActionPreference='Continue';${NET_SCRIPT}`, { timeout: 30000 });
  try { return JSON.parse(r.stdout.trim()); } catch { return { error: (r.stderr || r.stdout).trim().slice(0, 300) }; }
}

module.exports = { History, parseNetstat, parseTasklist, isPublic, stuckConnections, probeDetail, resolve, provider, network, HOUR };
