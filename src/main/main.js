const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { Controller } = require('./controller');

const MOCK = !app.isPackaged && process.argv.includes('--mock');
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = MOCK ? path.join(app.getPath('temp'), 'zapret-mock') : path.join(process.env.ProgramData || 'C:\\ProgramData', 'zapret');
const BUNDLED_CORE = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.join(ROOT, 'resources', 'core');
const LOG_FILE = path.join(DATA_DIR, 'zapret-app.log');

fs.mkdirSync(DATA_DIR, { recursive: true });
const log = e => { try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${e && e.stack || e}\n`); } catch { /* журнал не критичен */ } };

const DONATE_URL = 'https://www.donationalerts.com/r/dOne';
const WISH_URL = 'https://github.com/Arkadiy2009/zapret-app/discussions/1';
let win = null, tray = null, ctrl = null, quitting = false;
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
}

function refreshTray() {
  if (!tray || !ctrl) return;
  const on = ctrl.v.conn === 'on';
  tray.setImage(trayIcon(on ? 'tray-on.ico' : 'tray-off.ico'));
  tray.setToolTip(on ? 'zapret: подключено' : 'zapret: выключено');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть', click: () => { win.show(); win.focus(); } },
    { label: on ? 'Отключить' : 'Подключить', enabled: ctrl.v.conn !== 'scan', click: () => ctrl.primary().catch(e => toastError(e)) },
    { type: 'separator' },
    { label: 'Выйти', click: () => { quitting = true; app.quit(); } },
  ]));
}

const toastError = e => { log(e); win?.webContents.send('toast', e.message || String(e)); };

const ACTIONS = new Set(['primary', 'startScan', 'cancelScan', 'useStrategy', 'toggleTarget', 'removeTarget', 'addCatalog', 'addDomain', 'listAdd', 'listRemove', 'set', 'toggle', 'setPorts', 'setFake',
  'finishOnboarding', 'defender', 'runDiag', 'fixConflicts', 'discordCache', 'netReset', 'remove', 'enableDns', 'disableDns', 'checkUpdate', 'updateAll', 'ipsetUpdate', 'hostsUpdate']);

function bindIpc() {
  ipcMain.handle('state', () => ctrl.snapshot());
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
    if (what === 'log') shell.showItemInFolder(LOG_FILE);
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
