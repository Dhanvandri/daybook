const { mkdir, open, readFile, rename, rm } = require('node:fs/promises');
const { dirname } = require('node:path');
const { DAY, dueReminders } = require('./reminders.cjs');

const CATEGORIES = ['Learning', 'Work', 'Personal', 'Health', 'Other'];
const REPEATS = ['none', 'daily', 'weekly'];
const MAX_RECORD_BYTES = 14_000_000;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function textField(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

function cleanRecord(record) {
  if (!record || typeof record.id !== 'string' || record.id.length >= 150 || !validDate(record.date)) {
    throw new Error('Invalid Daybook record');
  }
  return {
    id: record.id,
    date: record.date,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
  };
}

function validateRecords(data) {
  if (!Array.isArray(data?.entries) || !Array.isArray(data.reminders)) {
    throw new Error('Invalid Daybook data');
  }
  const entries = data.entries.map(entry => {
    const common = cleanRecord(entry);
    if (!textField(entry.text, 3000) || !CATEGORIES.includes(entry.category) ||
        (entry.time !== '' && !validTime(entry.time))) {
      throw new Error('Invalid Daybook activity');
    }
    return { ...common, text: entry.text, category: entry.category, time: entry.time };
  });
  const reminders = data.reminders.map(reminder => {
    const common = cleanRecord(reminder);
    if (!textField(reminder.title, 160) || !validTime(reminder.time) || !REPEATS.includes(reminder.repeat)) {
      throw new Error('Invalid Daybook reminder');
    }
    return { ...common, title: reminder.title, time: reminder.time, repeat: reminder.repeat };
  });
  const records = { entries, reminders };
  if (Buffer.byteLength(JSON.stringify(records)) > MAX_RECORD_BYTES) {
    throw new Error('Daybook data exceeds the local storage limit');
  }
  return records;
}

async function writeState(file, state) {
  const temporary = file + '.tmp';
  try {
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(state), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function openStore(file) {
  await mkdir(dirname(file), { recursive: true });
  let current = null;
  try {
    const loaded = JSON.parse(await readFile(file, 'utf8'));
    if (loaded?.version !== 1 || !loaded.fired || Array.isArray(loaded.fired) ||
        typeof loaded.fired !== 'object' || !Object.values(loaded.fired).every(Number.isFinite)) {
      throw new Error('Invalid Daybook data file');
    }
    current = { version: 1, ...validateRecords(loaded), fired: loaded.fired };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let queue = Promise.resolve();
  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  return {
    read() {
      return current && { entries: current.entries, reminders: current.reminders };
    },
    save(data) {
      const records = validateRecords(data);
      return enqueue(async () => {
        const next = { version: 1, ...records, fired: current?.fired ?? {} };
        await writeState(file, next);
        current = next;
      });
    },
    claimReminders(now, lastCheck) {
      return enqueue(async () => {
        if (!current) return [];
        const due = dueReminders(current.reminders, current.fired, now, lastCheck);
        if (!due.length) return [];
        const cutoff = now - 31 * DAY;
        const fired = Object.fromEntries(Object.entries(current.fired).filter(([, at]) => at >= cutoff));
        for (const reminder of due) fired[reminder.key] = now;
        const next = { ...current, fired };
        await writeState(file, next);
        current = next;
        return due;
      });
    },
    flush() {
      return queue;
    },
  };
}

module.exports = { openStore };
