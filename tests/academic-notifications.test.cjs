const assert = require('node:assert/strict');
const notifications = require('../academic-notifications.js');

const NOW = new Date('2026-09-11T17:00:00-05:00');

function workspaceFixture() {
    return {
        tasks: [
            { id: 'task-overdue', title: 'Ensayo', due: '2026-09-10', dueTime: '12:00', status: 'pending' },
            { id: 'task-complete', title: 'Entregada', due: '2026-09-10', dueTime: '08:00', status: 'completed' },
            { id: 'task-future', title: 'Futura', due: '2026-09-12', dueTime: '12:00', status: 'pending' }
        ],
        evaluations: [
            { id: 'evaluation-overdue', title: 'Examen de física', date: '2026-09-10', time: '10:00', status: 'pending' }
        ],
        projects: [
            { id: 'project-open', title: 'Proyecto solar', dueDate: '2026-09-09', dueTime: '14:30', status: 'in_progress' },
            { id: 'project-derived-complete', title: 'Proyecto completo', dueDate: '2026-09-09', dueTime: '14:30', status: 'in_progress' }
        ],
        projectStages: [
            { id: 'stage-open', projectId: 'project-open', title: 'Investigación', dueDate: '2026-09-10', dueTime: '18:30', status: 'in_progress' },
            { id: 'stage-complete', projectId: 'project-derived-complete', title: 'Entrega final', dueDate: '2026-09-10', dueTime: '18:30', status: 'in_progress' }
        ],
        projectSubtasks: [
            { id: 'subtask-open', projectId: 'project-open', stageId: 'stage-open', title: 'Redactar marco', dueDate: '2026-09-10', dueTime: '16:00', status: 'pending' },
            { id: 'subtask-complete', projectId: 'project-derived-complete', stageId: 'stage-complete', title: 'Enviar PDF', dueDate: '2026-09-10', dueTime: '16:00', status: 'completed' }
        ],
        events: [
            { id: 'event-past', title: 'Clase magistral', date: '2026-09-11', time: '08:00' },
            { id: 'event-future', title: 'Tutoría', date: '2026-09-11', time: '19:00' }
        ]
    };
}

const candidates = notifications.buildAcademicNotificationCandidates(workspaceFixture(), NOW);
assert.deepEqual(
    new Set(candidates.map(item => item.type)),
    new Set(['task', 'evaluation', 'project', 'stage', 'subtask', 'event']),
    'derives all six academic notice types'
);
assert.equal(candidates.some(item => item.id === 'task-complete'), false, 'excludes completed tasks');
assert.equal(candidates.some(item => item.id === 'task-future'), false, 'excludes future deadlines');
assert.equal(candidates.some(item => item.id === 'project-derived-complete'), false, 'excludes projects completed by all stages');
assert.equal(candidates.some(item => item.id === 'stage-complete'), false, 'excludes stages completed by all subtasks');
assert.equal(candidates.some(item => item.id === 'subtask-complete'), false, 'excludes completed subtasks');
assert.equal(candidates.some(item => item.id === 'event-future'), false, 'excludes future events');

for (let index = 1; index < candidates.length; index += 1) {
    assert.ok(candidates[index - 1].dueAtMs >= candidates[index].dueAtMs, 'orders recent deadlines first');
}

const first = candidates[0];
const readAt = '2026-09-11T22:01:00.000Z';
const merged = notifications.mergeNotificationStates(candidates, [
    { notification_key: first.key, read_at: readAt, dismissed_at: null },
    { notification_key: 'task:another-user-record:2026-09-10:12:00', read_at: readAt, dismissed_at: null }
]);
assert.equal(merged.find(item => item.key === first.key).readAt, readAt, 'merges persisted state by exact derived key');
assert.equal(notifications.unreadCount(merged), candidates.length - 1, 'counts only visible unread notices');
assert.equal(notifications.unreadBadgeLabel(3), '3');
assert.equal(notifications.unreadBadgeLabel(37), '9+', 'caps the visual badge at 9+');

const dismissedKey = candidates[1].key;
const withDismissed = notifications.mergeNotificationStates(candidates, [
    { notification_key: dismissedKey, read_at: readAt, dismissed_at: readAt }
]);
assert.equal(withDismissed.some(item => item.key === dismissedKey), false, 'dismisses only the selected notice');
assert.equal(withDismissed.length, candidates.length - 1, 'keeps all other notices');

const localRows = notifications.applyLocalNotificationState([], [first.key], { read_at: readAt }, NOW);
assert.equal(localRows.length, 1);
assert.equal(localRows[0].notification_key, first.key);
assert.equal(localRows[0].read_at, readAt);

assert.notEqual(
    notifications.buildNotificationKey('task', 'same-id', '2026-09-10', '12:00', '18:00'),
    notifications.buildNotificationKey('task', 'same-id', '2026-09-10', '13:00', '18:00'),
    'rescheduling creates a new deadline-specific key'
);

assert.equal(notifications.deadlineFromLocal('2026-09-11', '12:00').toISOString(), '2026-09-11T17:00:00.000Z', '12:00 is noon in Guayaquil');
assert.equal(notifications.deadlineFromLocal('2026-09-11', '00:00').toISOString(), '2026-09-11T05:00:00.000Z', '00:00 is midnight in Guayaquil');
assert.match(notifications.formatWhen('2026-09-11T17:00:00.000Z', NOW), /12:00 PM$/, 'renders AM/PM time');

assert.deepEqual(notifications.notificationNavigation({ type: 'evaluation' }), { section: 'evaluations', detail: 'evaluation' });
assert.deepEqual(notifications.notificationNavigation({ type: 'subtask' }), { section: 'goals-projects', detail: 'project', tab: 'stages' });
for (const section of notifications.constants.VISIBLE_SECTIONS) {
    assert.equal(notifications.shouldShowBell(section, true), true, `shows the bell in authenticated section ${section}`);
}
assert.equal(notifications.shouldShowBell('settings', true), false);
assert.equal(notifications.shouldShowBell('login', true), false);
assert.equal(notifications.shouldShowBell('register', true), false);
assert.equal(notifications.shouldShowBell('dashboard', false), false);

console.log(`academic-notifications: ${candidates.length} derived notices validated`);
