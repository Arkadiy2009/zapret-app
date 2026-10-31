// Интерфейс zapret. Состояние живёт в основном процессе, здесь только показ и локальные мелочи.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = window.zapret;

const PAGES = [
  { id: 'home', name: 'Главная', icon: 'power' },
  { id: 'catalog', name: 'Каталог', icon: 'search' },
  { id: 'methods', name: 'Способы', icon: 'layers' },
  { id: 'check', name: 'Проверка', icon: 'pulse' },
  { id: 'settings', name: 'Настройки', icon: 'sliders' },
];

const ic = {
  power: '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  check: '<path d="M4.5 12.5l5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  warn: '<path d="M12 4l9.5 16h-19z"/><path d="M12 10v5M12 17.6v.4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 5M18 15a7 7 0 0 1-12 2l-2-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icon = (n, s = 20) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[n]}</svg>`;

function art(kind, letter, wide) {
  if (kind === 'wardogs') return `<img class="art" src="img/wardogs-${wide ? 'wide' : 'square'}.jpg" alt="" draggable="false">`;
  const brand = BRANDS[kind];
  if (brand) return `<span class="art art-brand" style="background:${brand.bg}">${brand.svg}</span>`;
  return `<span class="art art-brand" style="background:linear-gradient(135deg,#55647a,#232c3a)"><b>${esc((letter || '?').toUpperCase())}</b></span>`;
}

let S = null;
const U = { page: 'home', q: '', listTab: 'general', overlay: null, step: 0, testType: 'standard', listErr: '', portErr: false, dnsBrowser: false, updateOpen: false };

const call = async (name, ...args) => {
  const r = await api.call(name, ...args);
  if (r.error) toast(r.error);
  return r.result ?? {};
};

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

const stratResult = file => S.results?.[file] || null;
const current = () => S.strategies.find(x => x.file === S.strategy);
const chosen = () => S.targets.filter(t => t.on);
const fits = file => {
  const r = stratResult(file);
  return !!r && !r.failed && chosen().every(t => r.targets?.[t.id]?.total && r.targets[t.id].ok === r.targets[t.id].total);
};
function plural(n, one, few, many) {
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function statusWord() { return { off: 'Выключено', scan: 'Подбор', on: 'Подключено' }[S.conn]; }
function headline() {
  if (S.conn === 'on') return 'Всё подключено';
  if (S.conn === 'scan') return S.scan.reason === 'heal' ? 'Подбираем новый способ' : 'Ищем способ';
  return 'Обход выключен';
}
function subline() {
  if (S.conn === 'on') return `Следим за доступом сами. Способ ${esc(current()?.name || '')}.`;
  if (S.conn === 'scan') return `${S.scan.phase === 2 ? 'Перепроверяем лучшие' : 'Проверили'}: ${S.scan.i} из ${S.scan.total}. Видео и звонки могут прерываться.`;
  if (S.strategy) return `Способ ${esc(current()?.name || '')} уже подобран. Подключим за пару секунд.`;
  return 'Отметьте, что должно работать. Способ подберём сами.';
}
function ctaLabel() { return S.conn === 'on' ? 'Отключить' : S.conn === 'scan' ? 'Остановить' : 'Подключить'; }

function targetState(t) {
  if (!t.on) return { cls: 'idle', text: 'Не выбрано' };
  if (S.conn === 'on') {
    const r = stratResult(S.strategy)?.targets?.[t.id];
    if (!r) return { cls: 'idle', text: 'Не проверено' };
    return { cls: r.ok === r.total ? 'ok' : r.ok ? 'part' : 'bad', text: r.ok === r.total ? `Работает, ${stratResult(S.strategy).ping ?? '—'} мс` : r.ok ? `Отвечают ${r.ok} из ${r.total}` : 'Не открывается' };
  }
  if (S.conn === 'scan') {
    const done = Object.values(S.results || {}), n = done.filter(r => r.targets?.[t.id]?.total && r.targets[t.id].ok === r.targets[t.id].total).length;
    return { cls: n ? 'ok' : 'wait', text: n ? `Работает в ${n} из ${done.length}` : 'Проверяем' };
  }
  return { cls: 'idle', text: 'Ждёт подключения' };
}
function cellClass(st) {
  if (S.conn === 'scan') {
    if (st.file === S.scan.file) return 'now';
    if (!stratResult(st.file)) return 'wait';
  } else if (!stratResult(st.file)) return 'wait';
  if (st.file === S.strategy && S.conn !== 'scan') return 'best';
  return fits(st.file) ? 'yes' : 'no';
}
function scanStrip() {
  return `<div class="cells" style="grid-template-columns:repeat(${S.strategies.length},minmax(0,1fr))" role="img" aria-label="Проверено ${S.scan.i} способов из ${S.scan.total}">${S.strategies.map(st => `<span class="cell ${cellClass(st)}"></span>`).join('')}</div>`;
}
function updateBanner() {
  const core = S.update?.state === 'ask', ui = S.appUpdate?.state === 'ask';
  if (!core && !ui) return '';
  const text = core && ui ? 'Есть обновления приложения и запрета' : core ? `Вышла новая версия zapret ${esc(S.update.v)}` : `Вышло приложение ${esc(S.appUpdate.v)}`;
  return `<div class="banner info" id="b-update">${icon('download')}<span>${text}</span><button class="btn small" data-act="askUpdate">Обновить</button></div>`;
}
function bannerHtml() {
  if (!S.banner) return updateBanner();
  return `<div class="banner ${S.banner.kind}" id="b-main">${icon('warn')}<span>${esc(S.banner.text)}</span>${S.banner.action ? `<button class="btn small" data-act="${S.banner.act}">${esc(S.banner.action)}</button>` : ''}</div>`;
}
function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? 'только что' : `${m} мин назад`;
}
function uptime() {
  const s = Math.max(0, Math.floor((Date.now() - S.startedAt) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин ${String(sec).padStart(2, '0')} с`;
}
function liveMeta() {
  if (S.conn !== 'on') return '';
  return `<div class="meta-row" id="meta">
    <div><span>Работает</span><b id="uptime">${uptime()}</b></div>
    <div><span>Последняя проверка</span><b id="lastcheck">${ago(S.lastCheck)}</b></div>
    <div><span>Автозапуск</span><b>${S.autostart ? 'Включён' : 'Выключен'}</b></div>
  </div>`;
}
function addCard() {
  return `<button class="t-add" id="t-add" data-act="nav" data-v="catalog">${icon('plus', 26)}<b>Добавить игру или сайт</b></button>`;
}
function targetCard(t) {
  const s = targetState(t);
  return `<article class="t-card ${t.on ? 'on' : ''}" id="card-${esc(t.id)}">
    <button class="t-hit" data-act="toggleTarget" data-v="${esc(t.id)}" aria-pressed="${t.on}">
      <span class="t-art" data-keep>${art(t.art, t.name[0], true)}</span>
      <span class="t-tick">${icon('check', 16)}</span>
      <span class="t-body"><b>${esc(t.name)}</b><small>${esc(t.sub)}</small><em class="st ${s.cls}"><i></i>${s.text}</em></span>
    </button>
    ${t.custom ? `<button class="t-del" data-act="removeTarget" data-v="${esc(t.id)}" aria-label="Убрать ${esc(t.name)}">${icon('x', 14)}</button>` : ''}
  </article>`;
}

function pageHome() {
  return `<div class="flow-home">
    <section class="hero">
      <h1 id="h-${S.conn}${S.conn === 'scan' ? S.scan.reason : ''}">${headline()}</h1>
      <p>${subline()}</p>
      ${bannerHtml()}
      <div class="cta-row">
        <button class="cta ${S.conn} ${S.busy ? 'busy' : ''}" id="cta" data-act="primary" ${S.busy ? 'disabled' : ''}>${icon('power', 26)}<span>${ctaLabel()}</span></button>
        ${S.conn === 'off' && S.strategy ? '<button class="ghost" id="again" data-act="rescan">Подобрать заново</button>' : ''}
      </div>
      ${S.conn === 'scan' ? scanStrip() : liveMeta()}
    </section>
    <section class="dock" aria-label="Что должно работать">
      <div class="dock-row">${S.targets.map(targetCard).join('')}${addCard()}</div>
    </section>
  </div>`;
}

// Каталог и личные списки
function catCard(c) {
  const added = S.catalogOn.includes(c.id);
  return `<article class="res" id="res-${c.id}">
    <span class="res-art" data-keep>${art(c.art, c.name[0])}</span>
    <div class="res-txt">
      <b>${esc(c.name)}</b><small>${esc(c.kind)}</small>
      <ul>
        <li>В ваш список: ${c.domains.slice(0, 4).map(esc).join(', ')}${c.domains.length > 4 ? ` и ещё ${c.domains.length - 4}` : ''}</li>
        ${c.game ? '<li>Сами включим режим для игр и список адресов серверов</li>' : ''}
      </ul>
      ${c.note ? `<div class="note warn">${esc(c.note)}</div>` : ''}
    </div>
    <button class="btn ${added ? '' : 'primary'}" data-act="addCatalog" data-v="${c.id}" ${added ? 'disabled' : ''}>${added ? 'Добавлено' : 'Добавить'}</button>
  </article>`;
}
function catResults() {
  const q = U.q.trim().toLowerCase();
  if (!q) {
    return `<h3>Игры</h3>${S.catalog.filter(c => c.group === 'game').map(catCard).join('')}<h3>Сервисы и сайты</h3>${S.catalog.filter(c => c.group === 'web').map(catCard).join('')}
      <p class="muted small">Списки собраны из советов пользователей запрета. Работа не гарантируется: всё зависит от провайдера.</p>
      <div class="set-row wish"><div><b>Нет вашей игры или сервиса?</b><small>Напишите, что добавить, или проголосуйте за чужое пожелание</small></div><button class="btn small" data-act="wish">Предложить</button></div>`;
  }
  const out = [];
  const special = S.special.find(a => a.match.some(m => q.includes(m)));
  if (special) out.push(`<article class="res answer" id="ans"><div class="res-txt"><b>${special.title}</b><p>${special.text}</p></div>${special.action ? `<button class="btn" data-act="${special.action.act}">${special.action.label}</button>` : ''}</article>`);
  S.catalog.filter(c => c.aliases.some(a => a.includes(q) || (q.length > 2 && q.includes(a))) || c.name.toLowerCase().includes(q)).forEach(c => out.push(catCard(c)));
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(q)) {
    out.push(`<article class="res" id="res-site"><span class="res-art">${art('site', q.replace(/^https?:\/\//, '')[0])}</span><div class="res-txt"><b>${esc(q)}</b><small>Сайт</small><ul><li>Добавим в ваш личный список, поддомены учтутся сами</li></ul></div><button class="btn primary" data-act="addDomain" data-v="${esc(q)}">Добавить сайт</button></article>`);
  }
  if (!out.length) out.push(`<div class="empty"><b>Не нашли «${esc(U.q)}»</b><p>Введите адрес сайта, например example.com, и мы добавим его в ваш список. Или <button class="link" data-act="wish">предложите это для каталога</button>.</p></div>`);
  return out.join('');
}
function pageCatalog() {
  const tab = LIST_TABS.find(t => t.id === U.listTab);
  const ipTab = tab.id.startsWith('ip');
  const items = S.lists[tab.id];
  return `<header class="page-h"><div><h1>Каталог</h1><p>Найдите игру или сайт, и мы сами разложим адреса по нужным спискам.</p></div></header>
  <label class="searchbox" for="q">${icon('search')}<input id="q" type="search" autocomplete="off" placeholder="Название игры или адрес сайта, например wardogs" value="${esc(U.q)}" aria-label="Найти игру или сайт"></label>
  <div id="cat-results" class="results">${catResults()}</div>
  <section class="panel">
    <div class="panel-h"><h2>Ваши списки</h2><small>Обновления их не затронут</small></div>
    <div class="tabs" role="tablist">${LIST_TABS.map(t => `<button role="tab" aria-selected="${t.id === tab.id}" class="${t.id === tab.id ? 'on' : ''}" data-act="listTab" data-v="${t.id}">${t.title}<i>${S.lists[t.id].length}</i></button>`).join('')}</div>
    <p class="muted">${tab.hint} <code>${tab.file}</code></p>
    <form class="list-add" data-form="listAdd"><input id="list-input" placeholder="${ipTab ? '203.0.113.0/24' : 'example.com'}" aria-label="Новый адрес" autocomplete="off"><button class="btn" type="submit">Добавить</button></form>
    <p class="error" id="list-err" ${U.listErr ? '' : 'hidden'}>${esc(U.listErr)}</p>
    ${items.length ? `<ul class="chips">${items.map(i => `<li>${esc(i)}<button data-act="listRemove" data-v="${esc(i)}" aria-label="Убрать ${esc(i)}">${icon('x', 13)}</button></li>`).join('')}</ul>` : '<p class="muted small">Пока пусто.</p>'}
  </section>`;
}

// Способы
function pageMethods() {
  const sorted = [...S.strategies];
  const rank = st => { const r = stratResult(st.file); if (!r || r.failed) return -1; return chosen().reduce((n, t) => n + (r.targets?.[t.id]?.ok || 0), 0) * 1000 - (r.ping ?? 999); };
  if (S.results && Object.keys(S.results).length) sorted.sort((a, b) => rank(b) - rank(a));
  const cols = chosen();
  const grid = `grid-template-columns: minmax(0,1.5fr) minmax(0,1fr) repeat(${cols.length},76px) 60px 112px`;
  const scanning = S.conn === 'scan';
  const rows = sorted.map(st => {
    const active = st.file === S.strategy, r = stratResult(st.file);
    const val = t => {
      const x = r?.targets?.[t.id];
      if (r?.dpi) return '<div class="m-val idle">—</div>';
      if (!x) return '<div class="m-val idle">—</div>';
      return `<div class="m-val ${x.ok === x.total ? 'ok' : x.ok ? 'part' : 'bad'}">${x.ok}/${x.total}</div>`;
    };
    return `<div class="m-row ${active ? 'active' : ''}" id="row-${st.file.replace(/\W/g, '')}" style="${grid}">
      <div class="m-name"><b>${esc(st.name)}${active ? '<span class="tag">Выбран</span>' : ''}</b><small>${esc(st.file)}</small></div>
      <div class="m-tech">${esc(st.tech)}</div>
      ${cols.map(val).join('')}
      <div class="m-val idle">${r?.dpi ? `${r.dpi.ok}/${r.dpi.total}` : r?.ping ?? '—'}</div>
      <div class="m-act">${active ? (S.conn === 'on' ? '<span class="on-word">Работает</span>' : '') : `<button class="btn small" data-act="useStrategy" data-v="${esc(st.file)}" ${scanning ? 'disabled' : ''}>Включить</button>`}</div>
    </div>`;
  }).join('');
  return `<header class="page-h"><div><h1>Способы обхода</h1><p>Обычно сюда заходить не нужно: подбор всё делает сам. Здесь можно выбрать вручную.</p></div>
    <button class="btn primary" data-act="scanAll" ${scanning ? 'disabled' : ''}>${icon('refresh', 18)}Проверить все ${S.strategies.length}</button></header>
  <div class="seg-row">
    <div class="seg" role="group">${[['standard', 'Обычная проверка'], ['dpi', 'Глубокая проверка']].map(([v, l]) => `<button class="${v === U.testType ? 'on' : ''}" aria-pressed="${v === U.testType}" data-act="testType" data-v="${v}">${l}</button>`).join('')}</div>
    <span class="muted small">${U.testType === 'standard' ? 'Сайты по трём протоколам и пинг для каждого способа.' : 'Ищет обрыв соединения на 16–20 КБ у разных хостингов. На время переключит адреса в режим «Все» и вернёт обратно.'}</span>
  </div>
  <section class="table">
    <div class="m-head" style="${grid}"><span>Способ</span><span>Приём</span>${cols.map(t => `<span>${esc(t.name)}</span>`).join('')}<span>мс</span><span></span></div>
    ${rows}
  </section>`;
}
function seg(key, value, options) {
  return `<div class="seg" role="group">${options.map(([v, l]) => `<button class="${v === value ? 'on' : ''}" aria-pressed="${v === value}" data-act="set" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
}

// Проверка компьютера
function pageCheck() {
  const running = S.diag.state === 'running', fresh = S.diag.state === 'idle';
  const groups = DIAG_GROUPS.map(g => `<section class="panel diag">
    <h2>${g.title}</h2>
    <ul>${g.items.map(it => {
      const st = running || fresh ? 'wait' : S.diag.issues[it.id] || (S.diag.info[it.id] ? 'info' : 'ok');
      const text = st === 'bad' || st === 'warn' || st === 'info' ? `<small>${esc(it.fix)}</small>` : '';
      const btn = it.id === 'dns' && st === 'info' ? '<button class="btn small" data-act="askDns">Включить</button>'
        : it.id === 'dns' && S.dohEnabled ? '<button class="btn small" data-act="disableDns">Выключить</button>'
        : it.id === 'conflict' && st === 'bad' ? '<button class="btn small" data-act="fixConflicts">Удалить</button>' : '';
      return `<li class="${st}"><span class="dot">${st === 'ok' ? icon('check', 14) : st === 'bad' || st === 'warn' ? icon('warn', 14) : ''}</span><div><b>${esc(it.name)}</b>${text}</div>${btn}</li>`;
    }).join('')}</ul>
  </section>`).join('');
  const issues = Object.keys(S.diag.issues).length;
  const on = S.conn === 'on';
  const chip = (n, ok, text) => `<div class="svc ${ok ? 'ok' : ''}"><small>${n}</small><b>${text}</b></div>`;
  const sub = fresh ? 'Нажмите «Проверить», и мы посмотрим, что мешает обходу' : running ? 'Проверяем систему' : issues ? `${issues} ${plural(issues, 'пункт требует', 'пункта требуют', 'пунктов требуют')} внимания` : 'Ничего не мешает обходу';
  return `<header class="page-h"><div><h1>Проверка компьютера</h1><p>${sub}</p></div>
    <button class="btn primary" data-act="runDiag" ${running ? 'disabled' : ''}>${icon('pulse', 18)}${running ? 'Проверяем' : fresh ? 'Проверить' : 'Проверить снова'}</button></header>
  <div class="svc-row">
    ${chip('Обход', on, on ? 'Работает' : 'Остановлен')}
    ${chip('Служба', S.installed, S.installed ? (on ? 'Запущена' : 'Установлена') : 'Не установлена')}
    ${chip('Автозапуск', S.autostart, S.autostart ? 'Включён' : 'Выключен')}
    ${chip('hosts', S.hostsOk, S.hostsOk ? 'Актуальный' : 'Не проверен')}
  </div>
  <div class="diag-grid">${groups}</div>
  <section class="panel tools">
    <div><b>Discord перестал открываться</b><small>Закроем Discord и очистим кэш во всех версиях: Stable, PTB, Canary и Development. Сообщения и вход останутся.</small></div>
    <button class="btn" data-act="discordCache">Очистить кэш Discord</button>
  </section>
  <section class="panel tools">
    <div><b>Ни один способ не подходит</b><small>Сбросим сетевые настройки Windows. Потребуется перезагрузка.</small></div>
    <button class="btn" data-act="askNet">Сбросить сеть</button>
  </section>`;
}

// Настройки
function toggleRow(key, title, sub) {
  return `<div class="set-row"><div><b>${title}</b><small>${sub}</small></div><button class="sw ${S[key] ? 'on' : ''}" role="switch" aria-checked="${S[key]}" aria-label="${title}" data-act="toggle" data-v="${key}"><span></span></button></div>`;
}
function pageSettings() {
  const gameOn = S.game.mode !== 'off';
  return `<header class="page-h"><div><h1>Настройки</h1><p>Всё работает и без них. Меняйте, только если нужно что-то особенное.</p></div></header>
  ${updateBanner()}
  <div class="set-grid">
    <section class="panel">
      <h2>Запуск</h2>
      ${toggleRow('autostart', 'Запускать вместе с Windows', 'Обход работает как служба, даже если приложение закрыто')}
      ${toggleRow('autoheal', 'Сам подбирать новый способ', 'Если текущий перестанет открывать ваши цели')}
      ${toggleRow('updates', 'Проверять обновления', 'Раз в сутки сверяем версию с GitHub. Ставим только по вашей кнопке')}
      ${toggleRow('motion', 'Анимация', 'Плавные переходы и живой фон')}
    </section>
    <section class="panel">
      <h2>Игры</h2>
      <p class="muted">Включается само, когда вы добавляете игру. Обход начинает работать с портами выше 1023.</p>
      ${seg('gameMode', S.game.mode, [['off', 'Выключено'], ['all', 'TCP и UDP'], ['tcp', 'Только TCP'], ['udp', 'Только UDP']])}
      ${gameOn ? `<div class="ports">
        <label for="p-tcp">Порты TCP<input id="p-tcp" data-port="tcp" value="${esc(S.game.tcp)}"></label>
        <label for="p-udp">Порты UDP<input id="p-udp" data-port="udp" value="${esc(S.game.udp)}"></label>
      </div><p class="error" id="port-err" ${U.portErr ? '' : 'hidden'}>Пример правильной записи: 1024-1934,1936-65535</p>
      <div class="note">Античит может реагировать на драйвер обхода. Если игра ругается, отключите обход перед запуском.</div>` : ''}
    </section>
    <section class="panel">
      <h2>Адреса</h2>
      <p class="muted">Какие IP пропускать через обход помимо сайтов из списков.</p>
      ${seg('ipset', S.ipset, [['none', 'Никакие'], ['loaded', 'Из списка'], ['any', 'Все']])}
      ${S.ipset === 'any' ? '<div class="note warn">Режим «Все» может сломать часть сайтов. Лучше не оставлять его надолго.</div>' : ''}
      <div class="set-row"><div><b>Список адресов</b><small>${S.ipsetDate ? `Обновлён ${esc(S.ipsetDate)}` : `Из версии ${esc(S.zapret)}`}</small></div><button class="btn small" data-act="ipsetUpdate">Обновить</button></div>
      <div class="set-row"><div><b>Файл hosts</b><small>Помогает голосу в Discord и Telegram Web</small></div><button class="btn small" data-act="hostsUpdate" ${S.hostsOk ? 'disabled' : ''}>${S.hostsOk ? 'Актуальный' : 'Обновить'}</button></div>
    </section>
    <section class="panel">
      <h2>О приложении</h2>
      <div class="set-row"><div><b>zapret ${esc(S.zapret)}</b><small>Неофициальная оболочка ${esc(S.appVersion)}. Сборка Flowseal, основа bol-van</small></div><button class="btn small" data-act="appCheck">Проверить обновления</button></div>
      <details class="adv" id="adv">
        <summary>Для опытных: подменные пакеты</summary>
        <p class="muted small">Что отправлять вместо настоящих пакетов, если голос или игра всё равно не работают.</p>
        <label for="f-d">Голос в Discord<select id="f-d" data-fake="discord">${S.fakeList.map(f => `<option ${f === S.fakes.discord ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label for="f-g">Игры<select id="f-g" data-fake="game">${S.fakeList.map(f => `<option ${f === S.fakes.game ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      </details>
      <div class="set-row"><div><b>Журнал</b><small>Пригодится, если что-то пошло не так</small></div><button class="btn small" data-act="openLog">Открыть папку</button></div>
      <div class="set-row"><div><b>Поддержать приложение</b><small>Я буду очень рад, если вы меня поддержите, люблю всех подписчиков ❤️</small></div><button class="btn small" data-act="donate">Открыть</button></div>
      <div class="set-row danger"><div><b>Удалить обход с компьютера</b><small>Уберём службу и драйвер. Ваши списки останутся</small></div><button class="btn small bad" data-act="askRemove">Удалить</button></div>
    </section>
  </div>`;
}

// Первый запуск
const ONBOARD = [
  { title: 'Привет! Настроим за пару минут', text: 'Приложение подберёт рабочий способ для вашего интернета. Трафик никуда не уходит: всё работает на этом компьютере.', icon: 'power',
    points: ['Обходу нужны права администратора, поэтому Windows спрашивает разрешение при запуске', 'Служба и драйвер ставятся один раз', 'Удалить всё можно в одну кнопку'] },
  { title: 'Антивирус может насторожиться', text: 'Обход использует драйвер WinDivert. Он перехватывает трафик, поэтому антивирусы часто называют его RiskTool. Сам по себе это не вирус.', icon: 'shield',
    points: ['Скачивайте приложение только из надёжного места', 'Можем добавить папку с файлами в исключения Защитника Windows'], action: 'Добавить в исключения' },
  { title: 'Что должно работать?', text: 'Подберём способ, который откроет всё отмеченное. Другие игры и сайты добавите потом в каталоге.', icon: 'search', pick: true },
];
const onboarding = () => ONBOARD.map(st => (st.pick && S.imported ? { ...st, title: 'Перенесли ваш запрет', text: 'Забрали способ, строки из списков и настройки игр. Старую папку не меняли, её можно удалить.' } : st));
const modal = (label, body, cls = '') => `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${label}">${body}</div>`;
const points = (list, ico = 'check') => list.map(p => `<li>${icon(ico, 16)}${esc(p)}</li>`).join('');
function dnsModal() {
  if (U.dnsBrowser) {
    return modal('Безопасный DNS', `<span class="m-ic">${icon('layers', 30)}</span>
      <h2>Включите DNS в браузере</h2>
      <p>На Windows 10 нет системной настройки, поэтому включите её в самом браузере.</p>
      <ul>${points(['Chrome: «Настройки», «Конфиденциальность и безопасность», «Безопасность», «Использовать безопасный DNS». Выберите Google', 'Firefox: «DNS через HTTPS», режим «Персональный», адрес https://dns.google/dns-query', 'Если у вас роутер Keenetic, включите в нём «Транзит запросов»'])}</ul>
      <div class="m-act"><span></span><div><button class="btn primary" data-act="closeOverlay">Понятно</button></div></div>`, 'first');
  }
  return modal('Безопасный DNS', `<span class="m-ic">${icon('layers', 30)}</span>
    <h2>${S.dnsBad ? 'Провайдер подменяет адрес' : 'Безопасный DNS'}</h2>
    <p>${S.dnsBad
      ? 'Все способы не открыли сайт: похоже, провайдер выдаёт компьютеру неверный адрес. zapret меняет только трафик, а адрес берёт готовым, поэтому способы тут не помогут.'
      : 'DNS сообщает компьютеру адреса сайтов. Обычно этим занят провайдер, и он может выдавать неверные. Включать это нужно, только если сайты не открываются ни одним способом.'}</p>
    <ul>${points(['Адреса будут приходить в зашифрованном виде от Google', 'На Windows 10 такой настройки нет, покажем, где включить её в браузере', 'Если у вас роутер Keenetic, включите в нём «Транзит запросов»', 'Выключить можно в любой момент в разделе «Проверка»'])}</ul>
    <div class="m-act"><span></span><div><button class="ghost" data-act="closeOverlay">Не сейчас</button><button class="btn primary" data-act="enableDns">${S.dnsBad ? 'Включить и проверить снова' : 'Включить'}</button></div></div>`, 'first');
}
function updateModal() {
  const u = S.update, a = S.appUpdate;
  if (a?.state === 'run') {
    return modal('Обновление', `<span class="m-ic">${icon('download', 30)}</span>
      <h2>Обновляем приложение до ${esc(a.v)}</h2>
      <p>Скачано ${a.pct}%. Обход продолжает работать.</p>
      <div class="up-bar"><i style="width:${a.pct}%"></i></div>
      <p class="small">Потом приложение перезапустится, и Windows спросит разрешение.</p>`, 'first');
  }
  const coreAsk = u?.state === 'ask', uiAsk = a?.state === 'ask';
  if (!u && !uiAsk) return '';
  const head = `<span class="m-ic">${icon(u?.state === 'done' ? 'check' : 'download', 30)}</span>`;
  if (coreAsk || (uiAsk && u?.state !== 'run')) {
    const news = [...(uiAsk ? a.news || [] : []), ...(coreAsk ? u.news || [] : [])];
    const title = coreAsk && uiAsk ? `Приложение ${esc(a.v)} и zapret ${esc(u.v)}` : coreAsk ? `Вышел zapret ${esc(u.v)}` : `Вышло приложение ${esc(a.v)}`;
    return modal('Обновление', `${head}
      <h2>${title}</h2>
      ${news.length ? `<ul class="news">${points(news, 'arrow')}</ul>` : ''}
      <ul>${points(['Ваши списки и настройки останутся', ...(coreAsk ? ['После обновления сами проверим способ. Если он перестал работать, подберём новый', 'Если не заработает ничего, вернём прошлую версию'] : ['Обход не прервётся, приложение перезапустится само'])])}</ul>
      <div class="m-act"><span></span><div><button class="ghost" data-act="closeOverlay">Позже</button><button class="btn primary" data-act="updateAll">Обновить сейчас</button></div></div>`, 'first');
  }
  if (u.state === 'run') {
    return modal('Обновление', `${head}
      <h2>Обновляем до ${esc(u.v)}</h2>
      <ol class="up-steps">${u.steps.map(([, s], i) => `<li class="${i < u.i ? 'done' : i === u.i ? 'now' : ''}"><span class="dot">${i < u.i ? icon('check', 14) : ''}</span>${esc(s)}</li>`).join('')}</ol>`, 'first');
  }
  return modal('Обновление', `${head}
    <h2>Готово, zapret ${esc(u.v)}</h2>
    <p>${S.conn === 'on' ? `Способ ${esc(current()?.name || '')} работает. ` : ''}Списки и настройки на месте.</p>
    <div class="m-act"><span></span><div><button class="btn primary" data-act="closeOverlay">Отлично</button></div></div>`, 'first');
}
function overlayHtml() {
  if (U.overlay === 'first') {
    const st = onboarding()[U.step];
    return modal('Первый запуск', `
      <div class="steps-dots">${ONBOARD.map((_, i) => `<i class="${i === U.step ? 'on' : i < U.step ? 'done' : ''}"></i>`).join('')}</div>
      <span class="m-ic">${icon(st.icon, 30)}</span>
      <h2 id="ob-${U.step}">${st.title}</h2>
      <p>${st.text}</p>
      ${st.points ? `<ul>${points(st.points)}</ul>` : ''}
      ${st.pick ? `<div class="pick">${S.targets.map(t => `<button class="${t.on ? 'on' : ''}" aria-pressed="${t.on}" data-act="toggleTarget" data-v="${esc(t.id)}"><span class="mini-art">${art(t.art, t.name[0])}</span><b>${esc(t.name)}</b><span class="t-tick">${icon('check', 16)}</span></button>`).join('')}</div><p class="small">Галочка влияет только на подбор. Без неё обход для сервиса не выключается.</p>` : ''}
      <div class="m-act">
        ${U.step ? '<button class="ghost" data-act="obBack">Назад</button>' : '<span></span>'}
        <div>${st.action ? `<button class="ghost" data-act="obNext">Пропустить</button><button class="btn primary" data-act="obDo">${st.action}</button>` : `<button class="btn primary" data-act="obNext">${st.pick ? (S.conn === 'on' ? 'Готово' : 'Подобрать способ') : 'Дальше'}</button>`}</div>
      </div>`, 'first');
  }
  if (U.overlay === 'dns') return dnsModal();
  if (U.overlay === 'update') return updateModal();
  if (U.overlay === 'remove') {
    return modal('Удаление обхода', `<h2>Удалить обход с компьютера?</h2>
      <p>Остановим обход, удалим службу zapret и драйверы WinDivert. Ваши списки и настройки останутся.</p>
      <div class="m-act"><button class="ghost" data-act="closeOverlay">Отмена</button><button class="btn bad" data-act="doRemove">Удалить</button></div>`);
  }
  if (U.overlay === 'net') {
    return modal('Сброс сети', `<h2>Сбросить сеть?</h2>
      <p>Сбросим Winsock, IP, прокси WinHTTP и кэш DNS. После этого нужно перезагрузить компьютер, настройки сети вернутся к стандартным.</p>
      <div class="m-act"><button class="ghost" data-act="closeOverlay">Отмена</button><button class="btn bad" data-act="doNet">Сбросить</button></div>`);
  }
  return '';
}

// Показ. morphdom сохраняет элементы между состояниями, поэтому CSS-переходы работают
const morphOpts = {
  onBeforeElUpdated(from, to) {
    if (from.hasAttribute('data-keep')) return false;
    if (from.isEqualNode(to)) return false;
    if (from.tagName === 'INPUT' && from === document.activeElement) { to.value = from.value; }
    if (from.tagName === 'DETAILS') to.open = from.open;
    if (from.tagName === 'SELECT') to.value = [...to.options].find(o => o.selected)?.value ?? from.value;
    return true;
  },
};
const PAGE_FN = { home: pageHome, catalog: pageCatalog, methods: pageMethods, check: pageCheck, settings: pageSettings };

function paint() {
  const win = $('#win');
  win.dataset.conn = S.conn;
  win.dataset.page = U.page;
  const pill = $('#title-state');
  pill.textContent = statusWord();
  pill.className = 'pill ' + S.conn;
  const nav = $('#nav');
  nav.style.setProperty('--i', PAGES.findIndex(p => p.id === U.page));
  morphdom(nav, `<nav class="nav" id="nav" aria-label="Разделы" style="--i:${PAGES.findIndex(p => p.id === U.page)}">${PAGES.map(p => `<button id="nav-${p.id}" data-act="nav" data-v="${p.id}" class="${U.page === p.id ? 'on' : ''}" ${U.page === p.id ? 'aria-current="page"' : ''}>${icon(p.icon, 20)}<span>${p.name}</span></button>`).join('')}</nav>`, morphOpts);
  morphdom($('#view'), `<main class="view" id="view">${PAGE_FN[U.page]()}</main>`, morphOpts);
  const overlay = $('#overlay'), html = overlayHtml();
  overlay.classList.toggle('show', !!html);
  if (html) morphdom(overlay, `<div class="overlay show" id="overlay">${html}</div>`, morphOpts);
  document.documentElement.dataset.motion = S.motion ? 'on' : 'off';
  FX.set({ mode: S.conn, dim: U.page === 'home' ? 0 : 0.72, motion: S.motion });
}

function render(pageChange) {
  if (pageChange && document.startViewTransition && S.motion && !document.hidden) {
    $('#view').scrollTop = 0;
    document.startViewTransition(paint);
  } else paint();
}

// Действия
const openOverlay = name => { U.overlay = name; paint(); };
const A = {
  primary: () => call('primary'),
  nav: v => { if (U.page !== v) { U.page = v; render(true); } },
  rescan: () => call('startScan', { reason: S.strategy ? 'again' : 'first' }),
  heal: () => call('startScan', { reason: 'heal' }),
  scanAll: () => { U.page = 'home'; render(true); call('startScan', { reason: 'again', full: true, deep: U.testType === 'dpi' }); },
  testType: v => { U.testType = v; paint(); },
  toggleTarget: v => call('toggleTarget', v),
  removeTarget: v => call('removeTarget', v),
  addCatalog: v => call('addCatalog', v),
  addDomain: v => { U.q = ''; const q = $('#q'); if (q) q.value = ''; call('addDomain', v); },
  listTab: v => { U.listTab = v; U.listErr = ''; paint(); },
  listRemove: v => call('listRemove', U.listTab, v),
  useStrategy: v => call('useStrategy', v),
  runDiag: () => call('runDiag'),
  fixConflicts: () => call('fixConflicts'),
  askDns: () => { U.dnsBrowser = false; openOverlay('dns'); },
  async enableDns() { const r = await call('enableDns'); if (r.browser) { U.dnsBrowser = true; paint(); } else A.closeOverlay(); },
  disableDns: () => call('disableDns'),
  discordCache: () => call('discordCache'),
  askNet: () => openOverlay('net'),
  doNet: () => { A.closeOverlay(); call('netReset'); },
  askRemove: () => openOverlay('remove'),
  doRemove: () => { U.page = 'home'; A.closeOverlay(); render(true); call('remove'); },
  closeOverlay: () => { U.overlay = null; paint(); },
  ipsetUpdate: () => call('ipsetUpdate'),
  hostsUpdate: () => call('hostsUpdate'),
  appCheck: () => (S.update || S.appUpdate ? openOverlay('update') : call('checkUpdate', true)),
  askUpdate: () => openOverlay('update'),
  updateAll: () => call('updateAll'),
  openLog: () => api.win('log'),
  donate: () => api.win('donate'),
  wish: () => api.win('wish'),
  toggle: v => call('toggle', v),
  set: (v, el) => call('set', el.dataset.k, v),
  obBack: () => { U.step--; paint(); },
  obDo: () => { call('defender'); A.obNext(); },
  obNext() {
    if (U.step < ONBOARD.length - 1) { U.step++; return paint(); }
    if (!chosen().length) return toast('Отметьте хотя бы одну цель');
    U.overlay = null; U.step = 0;
    paint();
    call('finishOnboarding');
  },
};

function bind() {
  document.addEventListener('click', e => {
    const w = e.target.closest('[data-win]');
    if (w) return api.win(w.dataset.win);
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    e.preventDefault();
    A[el.dataset.act]?.(el.dataset.v, el);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'q') { U.q = e.target.value; morphdom($('#cat-results'), `<div id="cat-results" class="results">${catResults()}</div>`, morphOpts); }
  });
  document.addEventListener('change', async e => {
    const f = e.target.dataset.fake;
    if (f) { await call('setFake', f, e.target.value); toast('Подмена заменена'); }
    const port = e.target.dataset.port;
    if (port) {
      const r = await api.call('setPorts', port, e.target.value);
      U.portErr = !!r.result?.error;
      paint();
    }
  });
  document.addEventListener('submit', async e => {
    if (e.target.dataset.form !== 'listAdd') return;
    e.preventDefault();
    const input = $('#list-input');
    const r = await api.call('listAdd', U.listTab, input.value);
    U.listErr = r.result?.error || '';
    if (!U.listErr) input.value = '';
    paint();
    $('#list-input')?.focus();
  });
}

api.on('state', s => {
  const updateDone = S?.update && !s.update && U.overlay === 'update';
  S = s;
  if (updateDone) U.overlay = null;
  if (s.appUpdate?.state === 'run') U.overlay = 'update';
  paint();
});
api.on('toast', toast);
api.on('open', what => { U.dnsBrowser = false; openOverlay(what); });

async function boot() {
  S = await api.state();
  FX.init($('#fx'), S.conn, S.motion);
  bind();
  if (S.firstRun) U.overlay = 'first';
  paint();
  document.body.classList.add('ready');
  setInterval(() => {
    const up = $('#uptime');
    if (up) up.textContent = uptime();
    const lc = $('#lastcheck');
    if (lc) lc.textContent = ago(S.lastCheck);
  }, 1000);
}
boot();
