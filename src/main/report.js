// Отчёт для разработчика: сводка настроек и состояния плюс хвост журнала в одном текстовом файле.
// Паролей и личных данных в нём нет, только то, что видно в самом приложении.
const os = require('os');

const yes = v => (v ? 'да' : 'нет');
const list = items => (items.length ? items.join(', ') : 'пусто');

function buildReport({ snap, service, logText, now = new Date() }) {
  const r = snap.results?.[snap.strategy];
  const targets = snap.targets.map(t => {
    const res = r?.targets?.[t.id];
    return `${t.name} (${t.on ? 'отмечено' : 'не отмечено'}${res ? `, отвечают ${res.ok} из ${res.total}` : ''})`;
  });
  const diag = snap.diag?.state === 'done'
    ? list(Object.entries(snap.diag.issues).map(([k, v]) => `${k}: ${v}`))
    : 'не запускалась';
  const tested = Object.entries(snap.results || {}).filter(([, v]) => !v.failed && v.targets);
  const lines = [
    'Журнал zapret для разработчика',
    `Создан: ${now.toLocaleString('ru-RU')}`,
    '',
    `Приложение: ${snap.appVersion}, запрет: ${snap.zapret}`,
    `Windows: ${os.release()} ${os.arch()}`,
    `Обход: ${snap.conn}, способ: ${snap.strategy || 'не выбран'}, служба: ${service}`,
    `Автозапуск: ${yes(snap.autostart)}, сам подбирать новый способ: ${yes(snap.autoheal)}, обновления: ${yes(snap.updates)}`,
    `Цели: ${list(targets)}`,
    `Каталог: ${list(snap.catalogOn)}`,
    `Режим для игр: ${snap.game.mode}, TCP ${snap.game.tcp}, UDP ${snap.game.udp}`,
    `Адреса (ipset): ${snap.ipset}`,
    `Обходить сайты: ${list(snap.lists.general)}`,
    `Не трогать сайты: ${list(snap.lists.exclude)}`,
    `Обходить IP: ${list(snap.lists.ipadd)}`,
    `Не трогать IP: ${list(snap.lists.ipskip)}`,
    `Подменные пакеты: Discord ${snap.fakes.discord || 'как в запрете'}, игры ${snap.fakes.game || 'как в запрете'}`,
    `Безопасный DNS: ${yes(snap.dohEnabled)}, hosts актуальный: ${yes(snap.hostsOk)}`,
    `Проверка компьютера: ${diag}`,
    `Проверено способов при последнем подборе: ${tested.length}`,
    ...tested.slice(0, 22).map(([file, v]) => `  ${file}: ${Object.entries(v.targets).map(([id, t]) => `${id} ${t.ok}/${t.total}`).join(', ')}${v.ping != null ? `, ${v.ping} мс` : ''}${v.quick ? ' (быстрая проверка)' : ''}`),
    '',
    '--- Журнал ---',
    logText.trim() || 'Записей нет',
  ];
  return lines.join('\r\n') + '\r\n';
}

module.exports = { buildReport };
