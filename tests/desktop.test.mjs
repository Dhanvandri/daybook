import assert from 'node:assert/strict';
import fs, { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import store from '../desktop/store.cjs';
import scheduler from '../desktop/reminders.cjs';

const { openStore } = store;
const { dueReminders } = scheduler;
const oneTime = { id: 'one', title: 'Review joins', date: '2026-11-22', time: '23:59', repeat: 'none' };
const days = { ...oneTime, id: 'daily', time: '08:00', repeat: 'daily' };
const weeks = { ...days, id: 'weekly', repeat: 'weekly' };
const local = (day, hour, minute, second = 0) => +new Date(2026, 10, day, hour, minute, second);

test('desktop reminders respect one-time, daily, and weekly dates', () => {
  assert.deepEqual(dueReminders([days,weeks], {}, local(21,8,0)), []);
  assert.deepEqual(dueReminders([days,weeks], {}, local(22,7,59,59)), []);
  assert.equal(dueReminders([oneTime], {}, local(23,0,0)).length, 1);
  assert.equal(dueReminders([oneTime], {}, local(23,0,1)).length, 0);
  assert.equal(dueReminders([days,weeks], {}, local(23,8,0)).length, 1);
  assert.equal(dueReminders([days,weeks], {}, local(29,8,0)).length, 2);
});

test('resume checks the latest elapsed occurrence and deduplicates alerts', () => {
  const now = local(24, 9, 0);
  const lastCheck = local(21, 9, 0);
  const due = dueReminders([oneTime, days, weeks], {}, now, lastCheck);
  assert.equal(due.length, 3);
  assert.equal(due.at(-1).at, local(24, 8, 0));
  const fired = Object.fromEntries(due.map(reminder => [reminder.key, now]));
  assert.deepEqual(dueReminders([oneTime, days, weeks], fired, now, lastCheck), []);
  assert.deepEqual(dueReminders([oneTime, days, weeks], {}, now), []);
});

test('resume finds a one-time reminder after more than a week of sleep', () => {
  const now = local(34, 9, 0);
  const due = dueReminders([oneTime], {}, now, local(22, 20, 0));
  assert.equal(due.length, 1);
  assert.equal(due[0].at, local(22, 23, 59));
  assert.deepEqual(dueReminders([oneTime], {}, now), []);
  assert.deepEqual(dueReminders([oneTime], {}, now, local(23, 1, 0)), []);
  assert.deepEqual(dueReminders([oneTime], { [due[0].key]: now }, now, local(22, 20, 0)), []);
});

test('desktop writes entries and reminders together and retains fired state across edits and restarts', async t => {
  const dir = await mkdtemp(join(tmpdir(),'daybook-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'daybook-data.json');
  const first = await openStore(file);
  assert.equal(first.read(), null);
  await first.save({ entries: [], reminders: [days] });
  const now = local(23, 8, 0);
  const claim = first.claimReminders(now);
  const activity = { id: 'sql', date: days.date, text: 'Practiced joins', time: '', category: 'Learning' };
  const edit = first.save({ entries: [activity], reminders: [days] });
  assert.equal((await claim).length, 1);
  await edit;
  const second = await openStore(file);
  assert.equal(second.read().entries[0].text, activity.text);
  assert.deepEqual(await second.claimReminders(now), []);
  assert.throws(() => second.save({ entries: [{ ...activity, date: '2026-02-30' }], reminders: [] }));
  assert.equal(second.read().entries.length, 1);
  await second.save({ entries: [], reminders: [] });
  const third = await openStore(file);
  assert.deepEqual(third.read(), { entries: [], reminders: [] });
});

test('a corrupt desktop data file is preserved on startup', async t => {
  const dir = await mkdtemp(join(tmpdir(),'daybook-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'daybook-data.json');
  await writeFile(file, '{broken');
  await assert.rejects(openStore(file), SyntaxError);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('desktop retries a locked data file and keeps the previous state if replacement fails', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'daybook-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'daybook-data.json');
  const records = { entries: [], reminders: [days] };
  const desktop = await openStore(file);
  await desktop.save({ entries: [], reminders: [] });
  const rename = fs.rename;
  let attempts = 0;
  const replace = t.mock.method(fs, 'rename', async (from, to) => {
    attempts += 1;
    if (attempts <= 2) throw Object.assign(new Error('File is locked'), { code: 'EPERM' });
    await rename(from, to);
  });
  await desktop.save(records);
  assert.equal(attempts, 3);
  assert.deepEqual((await openStore(file)).read(), desktop.read());
  replace.mock.mockImplementation(async () => {
    throw Object.assign(new Error('Disk error'), { code: 'EIO' });
  });
  await assert.rejects(desktop.save({ entries: [], reminders: [] }), { code: 'EIO' });
  assert.equal(desktop.read().reminders.length, 1);
  assert.equal((await openStore(file)).read().reminders.length, 1);
  await assert.rejects(readFile(file + '.tmp'), { code: 'ENOENT' });
});
