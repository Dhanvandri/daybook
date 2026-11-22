const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
const { app, BrowserWindow, dialog } = require('electron');

const profile = mkdtempSync(join(tmpdir(), 'daybook-electron-'));
const dataFile = join(profile, 'daybook-data.json');
const state = async () => JSON.parse(await readFile(dataFile, 'utf8'));
app.setPath('userData', profile);

let exportPath;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
dialog.showErrorBox = (_title, message) => { throw new Error(message); };
require('../desktop/main.cjs');

async function until(check, description, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      if (!['ENOENT', 'ERR_ABORTED'].includes(error.code)) throw error;
    }
    await pause(100);
  }
  throw new Error('Timed out waiting for ' + description);
}

function localDateTime(date) {
  const pad = value => String(value).padStart(2, '0');
  return {
    date: [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-'),
    time: [pad(date.getHours()), pad(date.getMinutes())].join(':'),
  };
}

async function smoke() {
  const window = await until(
    () => BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === 'app://daybook/index.html'),
    'the desktop window',
  );
  const evaluate = (fn, value) => window.webContents.executeJavaScript(
    '(' + fn.toString() + ')(' + (value === undefined ? '' : JSON.stringify(value)) + ')',
  );
  const calendarReady = () => evaluate(() => Boolean(
    document.querySelector('#calendarGrid button') && window.daybookDesktop,
  ));
  await until(calendarReady, 'the activity calendar');
  assert.equal((await state()).entries[0].text, 'Caught up with an old friend. We talked for hours and forgot our coffee had gone cold.');
  assert.equal(await evaluate(() => typeof require), 'undefined');
  const colors = await evaluate(() => {
    const NativeDate = Date;
    const themes = [];
    for (const [hour, minute] of [[17,59],[18,0],[5,59],[6,0]]) {
      Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [new NativeDate().setHours(hour,minute,0,0)]));
        }
      };
      window.dispatchEvent(new Event('focus'));
      themes.push(document.documentElement.dataset.theme);
    }
    Date = NativeDate;
    window.dispatchEvent(new Event('focus'));
    return themes;
  });
  assert.deepEqual(colors, ['light','dark','dark','light']);

  await evaluate(() => {
    document.querySelector('#activityText').value = 'Smoke test activity';
    document.querySelector('#entryForm').requestSubmit();
  });
  await until(async () => (await state()).entries.some(e => e.text === 'Smoke test activity'), 'an offline activity save');

  const now = localDateTime(new Date(Date.now() - 1000));
  await evaluate(({date,time}) => {
    document.querySelector('#reminderDate').value = date;
    document.querySelector('#reminderTime').value = time;
    document.querySelector('#reminderTitle').value = 'Smoke test reminder';
    document.querySelector('#reminderRepeat').value = 'weekly';
    document.querySelector('#reminderForm').requestSubmit();
  }, now);
  window.minimize();
  await until(async () => Object.keys((await state()).fired).length === 1, 'a reminder with the window minimized', 21_000);
  await until(() => evaluate(() => document.querySelector('#toast').textContent.includes('Smoke test reminder')), 'an in-app reminder message');

  window.restore();
  for (const [kind, button, result] of [
    ['json','exportBtn',/Smoke test activity/],
    ['csv','csvBtn',/Smoke test activity/],
    ['ics','icsBtn',/RRULE:FREQ=WEEKLY/],
  ]) {
    exportPath = join(profile, 'export.' + kind);
    await evaluate(id => document.getElementById(id).click(), button);
    const contents = await until(async () => {
      const data = await readFile(exportPath, 'utf8');
      return data.length && data;
    }, 'the ' + kind + ' export');
    assert.match(contents, result);
  }

  const backup = {
    app: 'Daybook', version: 1, entries: [{
      id:'legacy-activity', date:'2026-11-22', text:'Imported web practice', category:'Learning', time:'',
    }],
  };
  await evaluate(payload => {
    window.confirm = () => true;
    const input = document.getElementById('importFile');
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  }, backup);
  await until(async () => (await state()).entries.some(e => e.id === 'legacy-activity'), 'a web backup import');
  await evaluate(() => {
    const search=document.getElementById('searchInput');
    search.value='Caught up with an old friend';
    search.dispatchEvent(new Event('input'));
    document.querySelector('#searchResults button').click();
    document.querySelector('[data-action="delete"][data-id="seed-reunion-2026-11-22"]').click();
  });
  await until(async () => !(await state()).entries.some(e => e.id.startsWith('seed-')), 'the deletion of the starter activity');

  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.reload();
  await reloaded;
  await until(calendarReady, 'the reloaded calendar');
  const restored = await evaluate(async () => (await window.daybookDesktop.load()).records);
  assert.equal(restored.entries.length, 2);
  assert.equal(restored.reminders.length, 1);
}

const deadline = setTimeout(() => {
  console.error('Daybook desktop smoke test exceeded 50 seconds');
  app.exit(1);
}, 50_000);
app.whenReady().then(smoke).then(() => {
  console.log('Daybook Electron smoke test passed');
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
}).finally(() => clearTimeout(deadline));

process.on('exit', () => {
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
});
