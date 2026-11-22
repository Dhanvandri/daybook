import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const matches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
const script = matches.map(m => m[1]).join('\n');

test('GitHub Pages has a deployable root index.html', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta name="viewport"/);
  assert.ok(existsSync(new URL('../.nojekyll', import.meta.url)));
});

test('single-file offline app has no required external scripts or stylesheets', () => {
  assert.equal(matches.length, 1);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet/i);
  assert.doesNotMatch(html, /(?:fetch|XMLHttpRequest)\s*\(/);
});

test('inline browser JavaScript passes syntax validation', () => {
  assert.doesNotThrow(() => new Script(script, { filename: 'daybook-inline.js' }));
});

test('all referenced document IDs exist in the page', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const m of script.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.has(m[1]), `Missing HTML ID: ${m[1]}`);
  }
});

test('activity calendar, reminders, storage and export controls are wired', () => {
  for (const id of ['calendarGrid','entries','entryForm','reminderForm','reminderList','exportBtn','importFile','icsBtn','csvBtn']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /setInterval\(checkReminders/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /RRULE:FREQ=/);
});

test('starter example is added only to a new browser profile', () => {
  assert.match(script, /function seedExampleActivity\(\)/);
  assert.match(script, /localStorage\.getItem\(STORE_KEY\)!==null\) return/);
  assert.match(script, /Caught up with an old friend/);
});
