// Журнал для разработчика: все настройки и конфиг, проверка целей прямо сейчас, история за час,
// провайдер и сеть, хвост журнала. Паролей и истории посещённых сайтов в нём нет.
const fs = require('fs');
const os = require('os');
const path = require('path');

const yes = v => (v ? 'да' : 'нет');
const list = items => (items && items.length ? items.join(', ') : 'пусто');
const time = t => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
// Заглушки, которые запрет требует в пустых файлах, человеку не интересны
const STUBS = new Set(['domain.example.abc', '203.0.113.113/32']);
const lines = text => (text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !STUBS.has(l));

// Файлы запрета в том виде, в каком их читает winws
function coreFiles(coreDir) {
  const lists = path.join(coreDir, 'lists');
  const backup = new Set(lines(read(path.join(lists, 'ipset-all.txt.backup'))));
  const ipset = lines(read(path.join(lists, 'ipset-all.txt')));
  const orig = lines(read(path.join(lists, 'list-exclude.orig.txt')));
  const now = new Set(lines(read(path.join(lists, 'list-exclude.txt'))));
  return {
    'list-general-user.txt': lines(read(path.join(lists, 'list-general-user.txt'))).filter(l => !l.startsWith('#')),
    'list-exclude-user.txt': lines(read(path.join(lists, 'list-exclude-user.txt'))),
    'ipset-exclude-user.txt': lines(read(path.join(lists, 'ipset-exclude-user.txt'))),
    'game_filter.enabled': lines(read(path.join(coreDir, 'utils', 'game_filter.enabled'))),
    ipsetCount: ipset.length,
    ipsetExtra: ipset.filter(l => !backup.has(l)),
    unexcluded: orig.filter(l => !now.has(l) && !l.startsWith('#')),
  };
}

// Всё, что нужно для отчёта. deps подменяются в тестах и на заглушке
async function collect({ ctrl, deps, logText }) {
  const snap = ctrl.snapshot();
  const safe = (p, fallback) => Promise.resolve().then(p).catch(e => fallback ?? { error: e.message });
  const targets = ctrl.chosenTargets();
  const hosts = [...new Set(targets.flatMap(t => t.urls.map(u => new URL(u).hostname)))];
  const [service, image, winws, net, isp, stuckNow, dnsMap, live] = await Promise.all([
    safe(() => ctrl.engine.serviceState(), 'неизвестно'),
    safe(() => deps.serviceImage(), 'неизвестно'),
    safe(() => ctrl.engine.winwsRunning(), 'неизвестно'),
    safe(() => deps.network()),
    safe(() => deps.provider()),
    safe(() => deps.stuck(), []),
    safe(async () => Object.fromEntries(await Promise.all(hosts.map(async h => [h, await deps.resolve(h)])))),
    safe(async () => {
      const out = [];
      for (const t of targets) {
        for (const url of t.urls) out.push({ id: t.id, url, res: await Promise.all(['HTTP', 'TLS1.2', 'TLS1.3'].map(p => deps.probeDetail(url, p))) });
      }
      return out;
    }, []),
  ]);
  if (Array.isArray(stuckNow) && stuckNow.length) ctrl.history.stuck(stuckNow);
  return {
    snap, settings: ctrl.d, service, image, winws, net, isp, dnsMap, live, files: coreFiles(ctrl.coreDir),
    history: ctrl.history.summary(), logText,
  };
}

function buildReport(f, now = new Date()) {
  const { snap } = f;
  const out = [];
  const h = title => out.push('', `=== ${title} ===`);
  const vpn = f.net?.vpn?.length ? f.net.vpn : [];

  out.push('Журнал zapret для разработчика', `Создан: ${now.toLocaleString('ru-RU')}`);
  h('Коротко');
  out.push(
    `Приложение ${snap.appVersion}, запрет ${snap.zapret}, ${f.net?.windows || `Windows ${os.release()}`}`,
    `Обход: ${snap.conn}, способ: ${snap.strategy || 'не выбран'}, служба: ${f.service}, winws запущен: ${f.winws === true ? 'да' : f.winws === false ? 'нет' : f.winws}`,
    `Провайдер: ${f.isp?.error ? `не определён (${f.isp.error})` : `${f.isp.holder}, ${f.isp.asn}, сеть ${f.isp.network}`}${vpn.length ? ` — ВНИМАНИЕ: включён VPN (${vpn.join(', ')}), это может быть его сервер, а не провайдер` : ''}`,
  );

  h('Проверка целей сейчас');
  if (!f.live.length) out.push('Цели не отмечены');
  for (const r of f.live) {
    out.push(`${r.id} ${r.url}`);
    for (const p of r.res) out.push(`  ${p.proto.padEnd(7)} ${p.code === 0 ? `ОК, HTTP ${p.http}` : `ошибка curl ${p.code}${p.err ? ` (${p.err})` : ''}`}, ${p.time} с${p.ip ? `, IP ${p.ip}` : ''}`);
  }
  h('DNS: куда ведут адреса целей');
  for (const [host, ips] of Object.entries(f.dnsMap || {})) out.push(`${host}: ${list(ips)}`);

  h('История за последний час: проверки доступа (раз в 5 минут, пока обход включён)');
  if (!f.history.checks.length) out.push('Проверок не было');
  for (const c of f.history.checks) out.push(`${time(c.t)} ${c.id}: отвечают ${c.ok} из ${c.total}${c.ssl ? `, ошибок сертификата ${c.ssl}` : ''}`);
  h('История за последний час: соединения без ответа (раз в минуту)');
  out.push('Программа на этом компьютере пыталась подключиться к адресу, но ответа не получила.');
  if (!f.history.stuck.length) out.push('Не было');
  for (const s of f.history.stuck.slice(0, 60)) out.push(`${s.key}: ${s.n} раз, последний в ${time(s.last)}`);

  h('Настройки приложения');
  const t = snap.targets.map(x => `${x.name} (${x.on ? 'отмечено' : 'не отмечено'})`);
  out.push(
    `Цели: ${list(t)}`,
    `Каталог: ${list(snap.catalogOn)}`,
    `Автозапуск: ${yes(snap.autostart)}, сам подбирать: ${yes(snap.autoheal)}, обновления: ${yes(snap.updates)}, анимация: ${yes(snap.motion)}`,
    `Режим для игр: ${snap.game.mode}, TCP ${snap.game.tcp}, UDP ${snap.game.udp}`,
    `Адреса (ipset): ${snap.ipset}`,
    `Подменные пакеты: Discord ${snap.fakes.discord || 'как в запрете'}, игры ${snap.fakes.game || 'как в запрете'}`,
    `Безопасный DNS: ${yes(snap.dohEnabled)}, hosts актуальный: ${yes(snap.hostsOk)}`,
    `Проверка компьютера: ${snap.diag?.state === 'done' ? list(Object.entries(snap.diag.issues).map(([k, v]) => `${k}: ${v}`)) : 'не запускалась'}`,
  );

  h('Конфиг, который сейчас читает winws');
  out.push(`Команда службы: ${f.image}`);
  for (const k of ['list-general-user.txt', 'list-exclude-user.txt', 'ipset-exclude-user.txt', 'game_filter.enabled']) out.push(`${k}: ${list(f.files[k])}`);
  out.push(
    `ipset-all.txt: ${f.files.ipsetCount} строк, своих сверх списка Flowseal: ${list(f.files.ipsetExtra)}`,
    `Снятые исключения запрета (list-exclude.txt): ${list(f.files.unexcluded)}`,
  );

  h('Результаты последнего подбора');
  const tested = Object.entries(snap.results || {});
  if (!tested.length) out.push('Подбора не было');
  for (const [file, v] of tested) {
    out.push(v.failed ? `${file}: не запустился` : `${file}: ${Object.entries(v.targets || {}).map(([id, x]) => `${id} ${x.ok}/${x.total}`).join(', ')}${v.ping != null ? `, ${v.ping} мс` : ''}${v.quick ? ' (быстрая проверка)' : ''}${v.dpi ? `, глубокая ${v.dpi.ok}/${v.dpi.total}` : ''}`);
  }

  h('Сеть');
  if (f.net?.error) out.push(`Не удалось прочитать: ${f.net.error}`);
  else out.push(`Подключения: ${list(f.net?.adapters)}`, `DNS-серверы: ${list(f.net?.dns)}`, `Прокси: ${f.net?.proxy ?? 'неизвестно'}`, `VPN: ${list(vpn)}`);

  h('settings.json целиком');
  const { results, ...settings } = f.settings;
  out.push(JSON.stringify(settings, null, 2));

  h('Журнал приложения (последние 400 строк)');
  out.push(f.logText.trim() || 'Записей нет');
  return out.join('\r\n') + '\r\n';
}

module.exports = { collect, buildReport, coreFiles };
