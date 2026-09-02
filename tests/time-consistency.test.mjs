import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testsDirectory, '..');
await import(pathToFileURL(path.join(root, 'time-utils.js')).href);

const time = globalThis.ACEdunityTime;
assert.ok(time, 'The shared time utility must be registered.');

const cases = [
    ['12:00', 'AM', '00:00'],
    ['12:30', 'AM', '00:30'],
    ['1:00', 'AM', '01:00'],
    ['1:15', 'AM', '01:15'],
    ['11:30', 'AM', '11:30'],
    ['11:59', 'AM', '11:59'],
    ['12:00', 'PM', '12:00'],
    ['12:30', 'PM', '12:30'],
    ['1:00', 'PM', '13:00'],
    ['1:15', 'PM', '13:15'],
    ['6:30', 'PM', '18:30'],
    ['6:45', 'PM', '18:45'],
    ['11:59', 'PM', '23:59'],
    ['8:05', 'AM', '08:05']
];

for (const [clock, period, expected24] of cases) {
    assert.equal(time.convert12HourTo24(clock, period), expected24, `${clock} ${period} must persist as ${expected24}.`);
    const roundTrip = time.convert24HourTo12(expected24);
    assert.equal(`${roundTrip.clock} ${roundTrip.period}`, `${clock} ${period}`, `${expected24} must render without changing meaning.`);
}

assert.equal(time.formatTime24ForDisplay('00:00'), '12:00 AM');
assert.equal(time.formatTime24ForDisplay('12:00'), '12:00 PM');
assert.equal(time.formatTime24ForDisplay('18:30:00'), '6:30 PM');
assert.equal(time.formatTime24ForDisplay('', 'Sin hora'), 'Sin hora');
assert.equal(time.convert12HourTo24('13:00', 'PM'), '', 'Invalid 12-hour input must be rejected.');

const dueAt = (date, value) => new Date(`${date}T${value}:00-05:00`);
assert.equal(dueAt('2026-09-05', '12:00').toISOString(), '2026-09-05T17:00:00.000Z');
assert.equal(dueAt('2026-09-05', '00:00').toISOString(), '2026-09-05T05:00:00.000Z');
assert.equal(dueAt('2026-09-05', '18:30').toISOString(), '2026-09-05T23:30:00.000Z');
assert.equal(dueAt('2026-09-05', '23:59').toISOString(), '2026-09-06T04:59:00.000Z');

const noon = dueAt('2026-09-05', '12:00');
assert.equal(new Date(noon.getTime() - 24 * 3_600_000).toISOString(), '2026-09-04T17:00:00.000Z');
assert.equal(new Date(noon.getTime() - 2 * 3_600_000).toISOString(), '2026-09-05T15:00:00.000Z');
assert.equal(new Date(noon.getTime() - 1 * 3_600_000).toISOString(), '2026-09-05T16:00:00.000Z');
const midnight = dueAt('2026-09-05', '00:00');
assert.equal(new Date(midnight.getTime() - 24 * 3_600_000).toISOString(), '2026-09-04T05:00:00.000Z');
assert.equal(new Date(midnight.getTime() - 2 * 3_600_000).toISOString(), '2026-09-05T03:00:00.000Z');
const emailTime = value => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil', hour: 'numeric', minute: '2-digit', hour12: true
}).format(value).replace(/\u202f/g, ' ');
assert.equal(emailTime(noon), '12:00 PM');
assert.equal(emailTime(midnight), '12:00 AM');

for (const system of ['task', 'event', 'evaluation', 'project', 'stage', 'subtask']) {
    for (const [, , value24] of cases) {
        const instant = dueAt('2026-09-05', value24);
        assert.ok(!Number.isNaN(instant.getTime()), `${system} must build a valid Ecuador instant for ${value24}.`);
        assert.equal(time.formatTime24ForDisplay(value24), `${time.convert24HourTo12(value24).clock} ${time.convert24HourTo12(value24).period}`);
    }
}

const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const calendarStart = appSource.indexOf('function toGoogleCalendarDate');
const calendarEnd = appSource.indexOf('function openGoogleCalendarForEvent', calendarStart);
assert.ok(calendarStart >= 0 && calendarEnd > calendarStart, 'Google Calendar helpers must remain available.');
const calendarContext = { URLSearchParams };
vm.createContext(calendarContext);
vm.runInContext(`${appSource.slice(calendarStart, calendarEnd)}\nthis.getGoogleCalendarUrl = getGoogleCalendarUrl;`, calendarContext);

const noonCalendarUrl = new URL(calendarContext.getGoogleCalendarUrl({ title: 'Prueba mediodía', date: '2026-09-05', time: '12:00' }));
assert.equal(noonCalendarUrl.searchParams.get('dates'), '20260905T120000/20260905T130000');
assert.equal(noonCalendarUrl.searchParams.get('ctz'), 'America/Guayaquil');
const midnightCalendarUrl = new URL(calendarContext.getGoogleCalendarUrl({ title: 'Prueba medianoche', date: '2026-09-05', time: '00:00' }));
assert.equal(midnightCalendarUrl.searchParams.get('dates'), '20260905T000000/20260905T010000');

for (const worker of ['task-reminders', 'event-reminders', 'evaluation-reminders', 'project-reminders']) {
    const source = fs.readFileSync(path.join(root, 'supabase', 'functions', worker, 'index.ts'), 'utf8');
    assert.match(source, /America\/Guayaquil/, `${worker} must use the project timezone.`);
    assert.match(source, /hour12:\s*true/, `${worker} emails must display AM/PM.`);
    assert.doesNotMatch(source, /hour12:\s*false/, `${worker} must not expose ambiguous 24-hour email labels.`);
    assert.match(source, /-05:00/, `${worker} must construct local instants with Ecuador's UTC-05 offset.`);
}

const taskWorker = fs.readFileSync(path.join(root, 'supabase', 'functions', 'task-reminders', 'index.ts'), 'utf8');
assert.match(taskWorker, /\? String\(time\)\.slice\(0, 5\) : DEFAULT_DUE_TIME/, 'An explicit task time must take priority over the fallback.');
const eventWorker = fs.readFileSync(path.join(root, 'supabase', 'functions', 'event-reminders', 'index.ts'), 'utf8');
assert.match(eventWorker, /\? String\(row\.event_time\)\.slice\(0, 5\)\s*: DEFAULT_EVENT_TIME/, 'An explicit event time must take priority over the fallback.');
const evaluationWorker = fs.readFileSync(path.join(root, 'supabase', 'functions', 'evaluation-reminders', 'index.ts'), 'utf8');
assert.match(evaluationWorker, /hasTime \? String\(row\.evaluation_time\)\.slice\(0, 5\) : "23:59"/, 'An explicit evaluation time must take priority over the no-time rule.');

const goalsSource = fs.readFileSync(path.join(root, 'goals-projects.js'), 'utf8');
assert.doesNotMatch(`${appSource}\n${goalsSource}`, /type=(?:"|')time(?:"|')|type:\s*(?:"|')time(?:"|')/, 'User-facing time fields must use the shared 12-hour control.');

const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.ok(indexSource.indexOf('time-utils.js') < indexSource.indexOf('app.js'), 'Time utilities must load before the application scripts.');

console.log(`Time consistency checks passed (${cases.length} conversion cases, reminders, Agenda and Google Calendar).`);
