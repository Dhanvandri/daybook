const DAY = 86_400_000;
const STARTUP_GRACE = 90_000;

function dateKey(date) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function calendarDay(date) {
  return Date.parse(date + 'T00:00:00Z') / DAY;
}

function occursOn(reminder, day) {
  if (day < reminder.date) return false;
  if (reminder.repeat === 'none') return day === reminder.date;
  return reminder.repeat === 'daily' ||
    (calendarDay(day) - calendarDay(reminder.date)) % 7 === 0;
}

function occurrenceOn(reminder, date, now) {
  const day = dateKey(date);
  const [hours, minutes] = reminder.time.split(':').map(Number);
  const at = date.setHours(hours, minutes, 0, 0);
  return at <= now ? { at, key: JSON.stringify([reminder.id, day, reminder.time]) } : null;
}

function latestOccurrence(reminder, now) {
  if (reminder.repeat === 'none') {
    return occurrenceOn(reminder, new Date(reminder.date + 'T12:00:00'), now);
  }
  // Local calendar dates keep the selected hour across daylight-saving changes.
  const today = new Date(now);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset, 12);
    const day = dateKey(date);
    if (day < reminder.date) break;
    if (!occursOn(reminder, day)) continue;
    const occurrence = occurrenceOn(reminder, date, now);
    if (occurrence) return occurrence;
  }
  return null;
}

function dueReminders(reminders, fired, now, lastCheck) {
  const since = Math.min(lastCheck ?? now, now - STARTUP_GRACE);
  const due = [];
  for (const reminder of reminders) {
    const occurrence = latestOccurrence(reminder, now);
    if (!occurrence || occurrence.at < since || Object.hasOwn(fired, occurrence.key)) continue;
    due.push({ ...occurrence, title: reminder.title });
  }
  return due.sort((a, b) => a.at - b.at);
}

module.exports = { DAY, dueReminders };
