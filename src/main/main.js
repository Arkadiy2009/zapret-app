const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Controller } = require('./controller');
const { collect, buildReport } = require('./report');
const insight = require('./insight');

const MOCK = !app.isPackaged && process.argv.includes('--mock');
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = MOCK ? path.join(app.getPath('temp'), 'zapret-mock') : path.join(process.env.ProgramData || 'C:\\ProgramData', 'zapret');
const BUNDLED_CORE = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.join(ROOT, 'resources', 'core');
const LOG_FILE = path.join(DATA_DIR, 'zapret-app.log');

fs.mkdirSync(DATA_DIR, { recursive: true });
// Журнал ведётся всегда: в нём версии, подключения, подбор и ошибки. Больше 1 МБ уходит в .old
const log = e => {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${e && e.stack || e}\n`);
  } catch { /* журнал не критичен */ }
};

// Файл для разработчика на рабочем столе: сводка настроек и хвост журнала
async function saveReport() {
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const logText = (read(`${LOG_FILE}.old`) + read(LOG_FILE)).split('\n').slice(-400).join('\n');
  const e = ctrl.engine;
  const deps = MOCK
    ? { serviceImage: e.serviceImage, network: e.network, provider: e.provider, stuck: e.stuckConnections, resolve: e.resolve, probeDetail: e.probeDetail }
    : { serviceImage: e.serviceImage, network: insight.network, provider: () => insight.provider(), stuck: insight.stuckConnections, resolve: insight.resolve, probeDetail: insight.probeDetail };
  const text = buildReport(await collect({ ctrl, deps, logText }));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `zapret-журнал-${stamp}.txt`;
  let file = null;
  for (const dir of MOCK ? [DATA_DIR] : [app.getPath('desktop'), app.getPath('documents'), DATA_DIR]) {
    try { file = path.join(dir, name); fs.writeFileSync(file, '\ufeff' + text); break; } catch { file = null; }
  }
  if (!file) throw new Error('Не удалось сохранить журнал');
  shell.showItemInFolder(file);
  return file;
}

const DONATE_URL = 'https://www.donationalerts.com/r/dOne';
const WISH_URL = 'https://github.com/Arkadiy2009/zapret-app/discussions/1';
const RELEASES_URL = 'https://github.com/Arkadiy2009/zapret-app/releases/latest';
let win = null, tray = null, ctrl = null, quitting = false, uiAlive = false, uiRescue = false;
const trayIcon = name => nativeImage.createFromPath(path.join(ROOT, 'src', 'renderer', 'img', name));

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 740, useContentSize: true, resizable: false, maximizable: false, frame: false, show: false,
    backgroundColor: '#050a18', title: 'zapret', icon: path.join(ROOT, 'src', 'renderer', 'img', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Если интерфейс не загрузился, человек не должен остаться с пустым окном: обновиться можно и без него
  win.webContents.on('did-finish-load', () => setTimeout(() => { if (!uiAlive) rescue('окно загрузилось, но интерфейс не ответил').catch(log); }, 15000));
  win.webContents.on('did-fail-load', (_, code, text) => rescue(`окно не загрузилось: ${code} ${text}`).catch(log));
  win.webContents.on('render-process-gone', (_, d) => rescue(`процесс окна завершился: ${d.reason}`).catch(log));
}

async function rescue(reason) {
  log(new Error(`Интерфейс не работает: ${reason}`));
  if (uiRescue || quitting) return;
  uiRescue = true;
  await ctrl.checkUpdate(false).catch(log);
  const next = ctrl.v.appUpdate?.state === 'ask' ? ctrl.v.appUpdate.v : null;
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: 'zapret', noLink: true, defaultId: 0, cancelId: 2,
    message: 'Окно приложения не загрузилось',
    detail: `Обход продолжает работать.${next ? ` Вышла версия ${next}, она может это исправить.` : ''} Журнал: ${LOG_FILE}`,
    buttons: [next ? `Установить ${next}` : 'Открыть страницу загрузки', 'Перезагрузить окно', 'Закрыть'],
  });
  if (response === 0) next ? ctrl.updateAll().catch(log) : shell.openExternal(RELEASES_URL);
  if (response === 1) { uiRescue = false; win?.reload(); }
}

// Обновление из трея работает, даже если окно не открывается
async function trayUpdate() {
  await ctrl.checkUpdate(false).catch(log);
  const a = ctrl.v.appUpdate, u = ctrl.v.update;
  const what = [a?.state === 'ask' && `приложение ${a.v}`, u?.state === 'ask' && `zapret ${u.v}`].filter(Boolean);
  if (!what.length) return dialog.showMessageBox({ type: 'info', title: 'zapret', message: 'У вас последняя версия', noLink: true });
  const { response } = await dialog.showMessageBox({ type: 'question', title: 'zapret', noLink: true, buttons: ['Обновить', 'Позже'], cancelId: 1, message: `Есть обновление: ${what.join(' и ')}`, detail: 'Списки и настройки сохранятся.' });
  if (response === 0) ctrl.updateAll().catch(e => toastError(e));
}

function refreshTray() {
  if (!tray || !ctrl) return;
  const on = ctrl.v.conn === 'on';
  tray.setImage(trayIcon(on ? 'tray-on.ico' : 'tray-off.ico'));
  tray.setToolTip(on ? 'zapret: подключено' : 'zapret: выключено');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть', click: () => { win.show(); win.focus(); } },
    { label: on ? 'Отключить' : 'Подключить', enabled: ctrl.v.conn !== 'scan', click: () => ctrl.primary().catch(e => toastError(e)) },
    { label: ctrl.v.appUpdate?.state === 'ask' ? `Обновить до ${ctrl.v.appUpdate.v}` : 'Проверить обновления', click: () => trayUpdate().catch(log) },
    { type: 'separator' },
    { label: 'Выйти', click: () => { quitting = true; app.quit(); } },
  ]));
}

const toastError = e => { log(e); win?.webContents.send('toast', e.message || String(e)); };

const ACTIONS = new Set(['primary', 'startScan', 'cancelScan', 'useStrategy', 'toggleTarget', 'removeTarget', 'addCatalog', 'addDomain', 'listAdd', 'listRemove', 'set', 'toggle', 'setPorts', 'setFake',
  'finishOnboarding', 'defender', 'runDiag', 'fixConflicts', 'discordCache', 'netReset', 'remove', 'enableDns', 'disableDns', 'checkUpdate', 'updateAll', 'ipsetUpdate', 'hostsUpdate']);

function bindIpc() {
  ipcMain.handle('state', () => { uiAlive = true; return ctrl.snapshot(); });
  ipcMain.handle('saveLog', async () => { try { return { file: await saveReport() }; } catch (e) { log(e); return { error: e.message }; } });
  ipcMain.handle('call', async (_, name, ...args) => {
    if (!ACTIONS.has(name)) return { error: 'Неизвестное действие' };
    try {
      return { result: await ctrl[name](...args) };
    } catch (e) {
      log(e);
      return { error: e.message };
    }
  });
  ipcMain.on('win', (_, what) => {
    if (what === 'min') win.minimize();
    if (what === 'hide') win.hide();
    if (what === 'log') { log('Открыта папка журнала'); shell.showItemInFolder(LOG_FILE); }
    if (what === 'donate') shell.openExternal(DONATE_URL);
    if (what === 'wish') shell.openExternal(WISH_URL);
  });
}

function fatal(e) {
  log(e);
  dialog.showErrorBox('zapret не запустился', `${e.message}\n\nЖурнал: ${LOG_FILE}`);
  quitting = true;
  app.quit();
}

async function boot() {
  let engine, updater;
  if (MOCK) {
    const { createMockEngine, createMockUpdater } = require('./mock');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const scenario = JSON.parse(process.env.ZAPRET_MOCK_SCENARIO || '{}');
    engine = createMockEngine({ scenario });
    updater = createMockUpdater({ bundledCore: BUNDLED_CORE, scenario, nextVersion: '1.10.5' });
  } else {
    engine = require('./engine');
    updater = require('./update');
  }
  log(`Запуск: приложение ${app.getVersion()}, Windows ${os.release()}, данные ${DATA_DIR}`);
  ctrl = new Controller({ dataDir: DATA_DIR, bundledCore: BUNDLED_CORE, engine, updater, log, appVersion: app.getVersion() });
  ctrl.on('quit', () => { quitting = true; app.quit(); });
  ctrl.on('state', s => { win?.webContents.send('state', s); refreshTray(); });
  ctrl.on('toast', t => win?.webContents.send('toast', t));
  ctrl.on('open', what => { win?.webContents.send('open', what); win?.show(); });
  await ctrl.init();
  bindIpc();
  createWindow();
  tray = new Tray(trayIcon('tray-off.ico'));
  tray.on('click', () => { win.show(); win.focus(); });
  refreshTray();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.setAppUserModelId('zapret.app');
  app.whenReady().then(boot).catch(fatal);
  app.on('window-all-closed', e => e.preventDefault?.());
  app.on('before-quit', () => { quitting = true; ctrl?.dispose(); });
}
