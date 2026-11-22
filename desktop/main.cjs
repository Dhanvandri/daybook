const { app, BrowserWindow, dialog, ipcMain, Notification, powerMonitor, protocol, session } = require('electron');
const { createHash } = require('node:crypto');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { openStore } = require('./store.cjs');

const APP_URL = 'app://daybook/index.html';
const APP_ID = 'com.daybook.calendar';
const EXPORTS = {
  json: { label: 'Daybook backup', basename: 'daybook-backup' },
  csv: { label: 'Activity spreadsheet', basename: 'daybook-activities' },
  ics: { label: 'Calendar reminders', basename: 'daybook-reminders' },
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true } },
]);

let mainWindow;
let store;
let lastCheck;
let checkInProgress = false;
let reminderTimer;
let closing = false;
const activeNotifications = new Set();

function focusWindow() {
  if (!mainWindow) {
    createWindow().catch(reportStartupError);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 950,
    minWidth: 500,
    minHeight: 540,
    title: 'Daybook',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  await window.loadURL(APP_URL);
}

function registerPage(html) {
  function contentHash(tag) {
    const content = html.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))[1];
    return "'sha256-" + createHash('sha256').update(content.replace(/\r\n?/g, '\n')).digest('base64') + "'";
  }
  const csp = [
    "default-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
    'script-src ' + contentHash('script'), 'style-src ' + contentHash('style'),
  ].join('; ');
  protocol.handle('app', request => {
    if (request.method !== 'GET' || request.url !== APP_URL) return new Response(null, { status: 404 });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp },
    });
  });
}

function handle(channel, callback) {
  ipcMain.handle('daybook:' + channel, (event, ...args) => {
    const contents = mainWindow?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
        event.senderFrame.url !== APP_URL || closing) {
      throw new Error('Daybook request rejected');
    }
    return callback(...args);
  });
}

async function exportFile(kind, date, data) {
  if (!Object.hasOwn(EXPORTS, kind) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof data !== 'string' || Buffer.byteLength(data) > 32_000_000) {
    throw new Error('Invalid Daybook export');
  }
  const format = EXPORTS[kind];
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save ' + format.label.toLowerCase(),
    defaultPath: path.join(app.getPath('documents'), format.basename + '-' + date + '.' + kind),
    filters: [{ name: format.label, extensions: [kind] }],
  });
  if (canceled || !filePath) return false;
  await writeFile(filePath, data, 'utf8');
  return true;
}

function notify(titles) {
  mainWindow?.webContents.send('daybook:reminders', titles);
  if (!Notification.isSupported()) return;
  for (const body of titles) {
    const notification = new Notification({ title: 'Daybook reminder', body });
    activeNotifications.add(notification);
    const release = () => activeNotifications.delete(notification);
    // Some Linux notification services omit the close event.
    setTimeout(release, 600_000).unref();
    notification.once('close', release);
    notification.once('failed', release);
    notification.once('click', () => { release(); focusWindow(); });
    notification.show();
  }
}

async function checkReminders() {
  if (closing || checkInProgress) return;
  checkInProgress = true;
  const now = Date.now();
  try {
    const due = await store.claimReminders(now, lastCheck);
    lastCheck = now;
    if (due.length && !closing) notify(due.map(reminder => reminder.title));
  } catch (error) {
    console.error('Daybook could not check reminders:', error);
  } finally {
    checkInProgress = false;
  }
}

function reportStartupError(error) {
  console.error(error);
  dialog.showErrorBox('Daybook could not open', 'Check that Daybook can read its local data and try again.');
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady() && mainWindow) focusWindow(); });
  app.on('activate', () => { if (store && !closing) focusWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (!store || closing) return;
    event.preventDefault();
    closing = true;
    clearInterval(reminderTimer);
    store.flush().then(() => app.quit());
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
    const html = await readFile(path.join(__dirname, '..', 'index.html'), 'utf8');
    store = await openStore(path.join(app.getPath('userData'), 'daybook-data.json'));
    registerPage(html);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    handle('load', () => ({ records: store.read(), notifications: Notification.isSupported() }));
    handle('save', data => store.save(data));
    handle('export', exportFile);
    await createWindow();
    checkReminders();
    reminderTimer = setInterval(checkReminders, 15_000);
    powerMonitor.on('resume', checkReminders);
  }).catch(reportStartupError);
}
