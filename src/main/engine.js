// Всё, что трогает систему: служба, winws, curl, сеть.
// Логика повторяет service.bat и utils/test zapret.ps1 версии 1.10.4.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { run, cmd437, ps } = require('./exec');
const { toBinPath } = require('./strategy');
const { stuckConnections } = require('./insight');

const SERVICE = 'zapret';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function serviceState(name = SERVICE) {
  const r = await cmd437(`sc query "${name}"`);
  if (r.code === 1060 || /1060/.test(r.stdout)) return 'none';
  const m = r.stdout.match(/STATE\s*:\s*(\d)/);
  if (!m) return 'none';
  return { 1: 'stopped', 2: 'pending', 3: 'pending', 4: 'running' }[m[1]] || 'pending';
}

async function winwsRunning() {
  const r = await cmd437('tasklist /FI "IMAGENAME eq winws.exe" /NH');
  return /winws\.exe/i.test(r.stdout);
}

const killWinws = () => run('taskkill.exe', ['/IM', 'winws.exe', '/F']);

async function waitState(name, wanted, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (wanted.includes(await serviceState(name))) return true;
    await sleep(250);
  }
  return false;
}

async function stopService() {
  if (await serviceState() === 'running') {
    await run('sc.exe', ['stop', SERVICE]);
    await waitState(SERVICE, ['stopped', 'none']);
  }
  if (await winwsRunning()) await killWinws();
  await run('sc.exe', ['stop', 'WinDivert']);
}

async function tcpEnable() {
  const r = await cmd437('netsh interface tcp show global');
  if (/timestamps.*enabled/i.test(r.stdout)) return false;
  await cmd437('netsh interface tcp set global timestamps=enabled');
  return true;
}

// Способ записан прямо в службу, поэтому при его смене служба создаётся заново
async function installService(exe, args, strategyBase, auto) {
  await stopService();
  if (await serviceState() !== 'none') {
    await run('sc.exe', ['delete', SERVICE]);
    await waitState(SERVICE, ['none']);
  }
  await tcpEnable();
  const res = await run('sc.exe', ['create', SERVICE, 'binPath=', toBinPath(exe, args), 'DisplayName=', 'zapret', 'start=', auto ? 'auto' : 'demand']);
  if (res.code !== 0) throw new Error(`Не удалось создать службу: ${res.stdout.trim() || res.stderr.trim()}`);
  await run('sc.exe', ['description', SERVICE, 'Zapret DPI bypass software']);
  await run('reg.exe', ['add', 'HKLM\\System\\CurrentControlSet\\Services\\zapret', '/v', 'zapret-discord-youtube', '/t', 'REG_SZ', '/d', strategyBase, '/f']);
}

async function startService() {
  const r = await run('sc.exe', ['start', SERVICE]);
  if (r.code !== 0 && r.code !== 1056) throw new Error(`Служба не запустилась: ${r.stdout.trim()}`);
  if (!await waitState(SERVICE, ['running'], 6000)) throw new Error('Служба не перешла в рабочее состояние');
}

const setServiceStart = auto => run('sc.exe', ['config', SERVICE, 'start=', auto ? 'auto' : 'demand']);

async function removeService() {
  await stopService();
  if (await serviceState() !== 'none') await run('sc.exe', ['delete', SERVICE]);
  if (await serviceState('WinDivert') !== 'none') await run('sc.exe', ['delete', 'WinDivert']);
  await run('sc.exe', ['stop', 'WinDivert14']);
  await run('sc.exe', ['delete', 'WinDivert14']);
}

async function installedStrategy() {
  const r = await cmd437('reg query "HKLM\\System\\CurrentControlSet\\Services\\zapret" /v zapret-discord-youtube');
  const m = r.stdout.match(/zapret-discord-youtube\s+REG_SZ\s+(.+)/);
  return m ? m[1].trim() : null;
}

// Папка уже установленного запрета: строка службы начинается с пути к winws.exe
async function installedCoreDir() {
  const r = await cmd437('reg query "HKLM\\System\\CurrentControlSet\\Services\\zapret" /v ImagePath');
  const m = r.stdout.match(/ImagePath\s+REG_EXPAND_SZ\s+"?(.+?)bin\\winws\.exe/i);
  return m ? m[1] : null;
}

// Точная команда, с которой работает служба
async function serviceImage() {
  const r = await cmd437('reg query "HKLM\\System\\CurrentControlSet\\Services\\zapret" /v ImagePath');
  const m = r.stdout.match(/ImagePath\s+REG_EXPAND_SZ\s+(.+)/);
  return m ? m[1].trim() : 'службы нет';
}

// Запуск способа напрямую, без службы: так работает подбор
function startRaw(exe, args, onExit) {
  const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
  child.on('exit', code => onExit && onExit(code));
  child.on('error', () => onExit && onExit(-1));
  return child;
}

async function waitWinws(ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await winwsRunning()) { await sleep(300); return true; }
    await sleep(200);
  }
  return false;
}

const PROTOS = { HTTP: ['--http1.1'], 'TLS1.2': ['--tlsv1.2', '--tls-max', '1.2'], 'TLS1.3': ['--tlsv1.3', '--tls-max', '1.3'] };

async function probe(url, proto, timeoutSec = 4) {
  const r = await run('curl.exe', ['-I', '-s', '-m', String(timeoutSec), '--connect-timeout', String(Math.min(2, timeoutSec)), '-o', 'NUL', '-w', '%{http_code}', '--show-error', ...PROTOS[proto], url], { timeout: (timeoutSec + 2) * 1000 });
  const err = r.stderr;
  if (/Could not resolve host|certificate|SSL certificate problem|self[- ]?signed|certificate verify failed|unable to get local issuer certificate/i.test(err)) return 'SSL';
  if (r.code === 35 || /does not support|not supported|unsupported protocol|Unrecognized option|Unknown option|unsupported option|unsupported feature|schannel/i.test(err)) return 'UNSUP';
  return r.code === 0 ? 'OK' : 'ERROR';
}

async function ping(host) {
  const r = await run('ping.exe', ['-n', '1', '-w', '1000', host], { encoding: 'latin1', timeout: 3000 });
  const m = r.stdout.match(/[=<](\d+)\s*\S{0,3}\s+TTL/i);
  return m ? +m[1] : null;
}

// Проверка на обрыв 16-20 КБ из tcp-16-20 suite
async function dpiProbe(host, proto, payloadFile, timeoutSec = 5, rangeBytes = 65536) {
  const r = await run('curl.exe', ['--range', `0-${rangeBytes - 1}`, '-m', String(timeoutSec), '--connect-timeout', String(Math.min(3, timeoutSec)), '-w', '%{http_code} %{size_upload} %{size_download} %{time_total}', '-o', 'NUL', '-X', 'POST', '--data-binary', `@${payloadFile}`, '-s', ...PROTOS[proto], `https://${host}`], { timeout: (timeoutSec + 2) * 1000 });
  const m = r.stdout.trim().match(/^(\d{3})\s+(\d+)\s+(\d+)\s+([\d.]+)$/);
  if (r.code === 35) return 'UNSUP';
  if (m && +m[2] > 0 && +m[3] === 0 && +m[4] >= timeoutSec && r.code !== 0) return 'BLOCKED';
  return r.code === 0 && m ? 'OK' : 'FAIL';
}

async function hasInternet() {
  const tcp = (host, port) => new Promise(resolve => {
    const s = net.connect({ host, port, timeout: 2500 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
  return (await Promise.all([tcp('8.8.8.8', 53), tcp('1.1.1.1', 53), tcp('77.88.8.8', 53)])).some(Boolean);
}

// Все 16 проверок из Run Diagnostics
const DIAG_SCRIPT = `
$r=@{}
$svc=Get-Service
$names=($svc|ForEach-Object{$_.Name+' '+$_.DisplayName}) -join [char]10
$r.bfe=(Get-Service BFE).Status -eq 'Running'
$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
$r.proxy=[bool]($p.ProxyEnable -eq 1)
$r.proxyServer=[string]$p.ProxyServer
$r.adguard=[bool](Get-Process AdguardSvc -ErrorAction SilentlyContinue)
$r.killer=$names -match 'Killer'
$r.intel=[bool]($svc|Where-Object{($_.Name+' '+$_.DisplayName) -match 'Intel' -and ($_.Name+' '+$_.DisplayName) -match 'Connectivity' -and ($_.Name+' '+$_.DisplayName) -match 'Network'})
$r.checkpoint=$names -match 'TracSrvWrapper|EPWD'
$r.smartbyte=$names -match 'SmartByte'
$vpn=@($svc|Where-Object{$_.Status -eq 'Running' -and ($_.Name+' '+$_.DisplayName) -match 'VPN|HappService'}|ForEach-Object{$_.DisplayName})
$r.vpn=$vpn
$r.doh=@(Get-ChildItem -Recurse -Path 'HKLM:System\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\' -ErrorAction SilentlyContinue|Get-ItemProperty -ErrorAction SilentlyContinue|Where-Object{$_.DohFlags -gt 0}).Count -gt 0
$h=Get-Content "$env:SystemRoot\\System32\\drivers\\etc\\hosts" -Raw -ErrorAction SilentlyContinue
$r.hostsYt=[bool]($h -match 'youtube\\.com|youtu\\.be')
$r.conflict=@('GoodbyeDPI','discordfix_zapret','winws1','winws2'|Where-Object{Get-Service $_ -ErrorAction SilentlyContinue})
$r.build=[int](Get-CimInstance Win32_OperatingSystem).BuildNumber
$r|ConvertTo-Json -Compress`;

async function diagnose(coreDir) {
  const res = await ps(DIAG_SCRIPT);
  const d = JSON.parse(res.stdout.trim());
  const timestampsFixed = await tcpEnable();
  const winws = await winwsRunning();
  const wd = await serviceState('WinDivert');
  let staleFixed = false;
  if (!winws && (wd === 'running' || wd === 'pending')) {
    await run('sc.exe', ['stop', 'WinDivert']);
    await run('sc.exe', ['delete', 'WinDivert']);
    staleFixed = true;
  }
  const dirs = coreDir;
  const issues = {}, info = {};
  if (!d.bfe) issues.bfe = 'bad';
  if (!fs.existsSync(path.join(dirs, 'bin', 'WinDivert64.sys'))) issues.driver = 'bad';
  if (timestampsFixed) info.tcp = true;
  if (/[а-яё]/i.test(dirs)) issues.cyrillic = 'warn';
  if (process.env.OneDrive && dirs.toLowerCase().startsWith(process.env.OneDrive.toLowerCase())) issues.onedrive = 'bad';
  if (d.adguard) issues.adguard = 'bad';
  if (d.killer) issues.killer = 'bad';
  if (d.intel) issues.intel = 'bad';
  if (d.checkpoint) issues.checkpoint = 'bad';
  if (d.smartbyte) issues.smartbyte = 'bad';
  if ([].concat(d.vpn || []).length) issues.vpn = 'warn';
  if ([].concat(d.conflict || []).length) issues.conflict = 'bad';
  if (staleFixed) info.windivert = true;
  if (d.proxy) issues.proxy = 'warn';
  if (!d.doh) info.dns = true;
  if (d.hostsYt) issues.hosts = 'warn';
  return { issues, info, conflict: [].concat(d.conflict || []), build: d.build };
}

async function removeConflicts(list) {
  for (const s of list) {
    if (!/^(GoodbyeDPI|discordfix_zapret|winws1|winws2)$/.test(s)) continue;
    await run('sc.exe', ['stop', s]);
    await run('sc.exe', ['delete', s]);
  }
  await run('sc.exe', ['stop', 'WinDivert']);
  await run('sc.exe', ['delete', 'WinDivert']);
  await run('sc.exe', ['stop', 'WinDivert14']);
  await run('sc.exe', ['delete', 'WinDivert14']);
}

async function clearDiscordCache() {
  const base = process.env.APPDATA, out = [];
  const apps = [['Discord.exe', 'discord'], ['DiscordPTB.exe', 'discordptb'], ['DiscordCanary.exe', 'discordcanary'], ['DiscordDevelopment.exe', 'discorddevelopment']];
  for (const [proc, dir] of apps) {
    const root = path.join(base, dir);
    if (!fs.existsSync(root)) continue;
    await run('taskkill.exe', ['/IM', proc, '/F']);
    await sleep(400);
    for (const sub of ['Cache', 'Code Cache', 'GPUCache']) fs.rmSync(path.join(root, sub), { recursive: true, force: true, maxRetries: 3 });
    out.push(dir);
  }
  return out;
}

async function resetNetwork() {
  await run('netsh.exe', ['winsock', 'reset']);
  await run('netsh.exe', ['int', 'ip', 'reset', 'all']);
  await run('netsh.exe', ['winhttp', 'reset', 'proxy']);
  await run('ipconfig.exe', ['/flushdns']);
}

const flushDns = () => run('ipconfig.exe', ['/flushdns']);

// Файлы службы работают от SYSTEM: обычный пользователь не должен иметь права подложить в папку свой файл
async function secureDir(dir) {
  const r = await run('icacls.exe', [dir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX']);
  if (r.code !== 0) throw new Error(`Не удалось защитить папку: ${r.stdout.trim()}`);
}

// Безопасный DNS в Windows 11: Google через DoH на активных адаптерах
async function enableDoh() {
  const r = await ps(`
$a=Get-NetAdapter|Where-Object Status -eq 'Up'
foreach($n in $a){
  Set-DnsClientServerAddress -InterfaceIndex $n.ifIndex -ServerAddresses ('8.8.8.8','8.8.4.4')
  $b="HKLM:\\System\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\$($n.InterfaceGuid)\\DohInterfaceSettings\\Doh"
  foreach($ip in '8.8.8.8','8.8.4.4'){
    New-Item -Path "$b\\$ip" -Force|Out-Null
    New-ItemProperty -Path "$b\\$ip" -Name DohFlags -PropertyType QWord -Value 1 -Force|Out-Null
  }
}
Clear-DnsClientCache`);
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'Windows не дала изменить DNS');
}

async function disableDoh() {
  const r = await ps(`
$a=Get-NetAdapter|Where-Object Status -eq 'Up'
foreach($n in $a){
  Set-DnsClientServerAddress -InterfaceIndex $n.ifIndex -ResetServerAddresses
  $b="HKLM:\\System\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\$($n.InterfaceGuid)\\DohInterfaceSettings\\Doh"
  Remove-Item -Path $b -Recurse -Force -ErrorAction SilentlyContinue
}
Clear-DnsClientCache`);
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'Windows не дала изменить DNS');
}

async function addDefenderExclusion(dir) {
  const r = await ps(`Add-MpPreference -ExclusionPath '${dir.replace(/'/g, "''")}'`);
  if (r.code !== 0) throw new Error('Защитник Windows не принял исключение');
}

module.exports = {
  DIAG_SCRIPT, serviceState, winwsRunning, killWinws, stopService, tcpEnable, installService, startService, setServiceStart, removeService, installedStrategy, installedCoreDir, serviceImage, stuckConnections,
  secureDir, startRaw, waitWinws, probe, ping, dpiProbe, hasInternet, diagnose, removeConflicts, clearDiscordCache, resetNetwork, flushDns, enableDoh, disableDoh, addDefenderExclusion,
};
