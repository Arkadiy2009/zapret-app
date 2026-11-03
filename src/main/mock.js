// Только для разработки: подмена системы, чтобы проверять интерфейс и логику,
// не запуская winws и не трогая службы. В собранное приложение не попадает.
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function createMockEngine({ scenario = {} } = {}) {
  const s = { service: 'none', winws: false, current: null, calls: [], scenario };
  const pick = () => s.current || '';
  const engine = {
    state: s,
    serviceState: async () => s.service,
    winwsRunning: async () => s.winws,
    killWinws: async () => { s.winws = false; s.current = null; await sleep(10); },
    stopService: async () => { await sleep(120); s.winws = false; if (s.service === 'running') s.service = 'stopped'; },
    tcpEnable: async () => false,
    installService: async (exe, args, base, auto) => { await sleep(150); s.calls.push(['install', exe, base, auto, args]); s.service = 'stopped'; s.base = base; },
    startService: async () => { await sleep(150); s.service = 'running'; s.winws = true; },
    setServiceStart: async auto => { s.calls.push(['start-mode', auto]); },
    removeService: async () => { s.service = 'none'; s.winws = false; },
    installedStrategy: async () => s.base || null,
    installedCoreDir: async () => s.coreDir || null,
    serviceImage: async () => (s.service === 'none' ? 'службы нет' : `"C:\\ProgramData\\zapret\\core\\1.10.4\\bin\\winws.exe" ${s.base}`),
    stuckConnections: async () => scenario.stuck || [],
    probeDetail: async (url, proto) => ({ proto, code: scenario.perfect ? 0 : 28, http: scenario.perfect ? '200' : '000', time: 0.12, ip: '203.0.113.10', err: scenario.perfect ? '' : 'Connection timed out' }),
    resolve: async () => ['203.0.113.10'],
    provider: async () => ({ asn: 'AS64500', holder: 'Тестовый провайдер', network: '198.51.100.0/24' }),
    network: async () => ({ adapters: ['Ethernet (Тестовый адаптер)'], dns: ['Ethernet: 192.168.1.1'], proxy: 'выключен', windows: 'Windows 11 Pro 10.0.26300', vpn: [] }),
    startRaw: (exe, args) => { s.current = args.join(' '); s.winws = true; return { kill() {} }; },
    waitWinws: async () => { await sleep(40); return true; },
    probe: async (url, proto) => {
      await sleep(scenario.delay ?? 12);
      if (scenario.dnsHijack && /youtu|google/.test(url)) return 'SSL';
      if (scenario.brokenAfterUpdate && s.service === 'running') return 'ERROR';
      const n = [...`${pick()}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 5;
      if (scenario.perfect) return 'OK';
      return n >= 2 || proto === 'TLS1.2' ? 'OK' : 'ERROR';
    },
    ping: async () => 20 + Math.floor(Math.random() * 30),
    dpiProbe: async () => 'OK',
    hasInternet: async () => true,
    diagnose: async () => { await sleep(900); return { issues: scenario.adguard ? { adguard: 'bad' } : {}, info: { dns: true }, conflict: [], build: 26300 }; },
    removeConflicts: async () => {},
    clearDiscordCache: async () => ['discord'],
    resetNetwork: async () => {},
    flushDns: async () => {},
    enableDoh: async () => { scenario.dnsHijack = false; },
    disableDoh: async () => {},
    addDefenderExclusion: async () => {},
    secureDir: async () => {},
  };
  return engine;
}

function createMockUpdater({ bundledCore, nextVersion = '9.9.9', scenario = {} }) {
  return {
    latestRelease: async () => ({ version: nextVersion, size: 1518649, news: ['Обновлены способы ALT11 и ALT12', 'Свежий список адресов'], url: '', sha256: '' }),
    prepare: async (rel, coreRoot, { onStep }) => {
      await sleep(300); onStep('verified');
      if (scenario.badDownload) throw new Error('Контрольная сумма архива не совпала');
      const target = path.join(coreRoot, rel.version);
      fs.cpSync(bundledCore, target, { recursive: true });
      const svc = path.join(target, 'service.bat');
      fs.writeFileSync(svc, fs.readFileSync(svc, 'utf8').replace(/LOCAL_VERSION=[^"]+/, `LOCAL_VERSION=${rel.version}`));
      await sleep(300);
      return { version: rel.version, dir: target };
    },
    latestApp: async () => (scenario.appUpdate ? { version: '1.2.0', size: 123000000, news: ['Новый экран каталога'], url: '', sha256: '' } : null),
    downloadApp: async (rel, dir, onPct) => {
      for (let p = 20; p < 100; p += 20) { await sleep(120); onPct(p); }
      if (scenario.badInstaller) throw new Error('Контрольная сумма установщика не совпала');
      return path.join(dir, 'zapret-setup.exe');
    },
    installApp: file => { scenario.installed = file; },
    updateIpset: async () => 33048,
    updateHosts: async () => true,
    dpiSuite: async () => [{ host: 'example.test' }],
  };
}

module.exports = { createMockEngine, createMockUpdater };
