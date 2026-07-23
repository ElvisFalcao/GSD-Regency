import test from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessDays, createActivationTasks, normaliseRows, validateActivation } from '../lib/automation.js';

test('blocks TikTok outside Nigeria and South Africa', () => {
  assert.match(validateActivation({ brand: 'Germol', market: 'Angola', platform: 'TikTok', date: '2026-07-24', activation: 'Teaser' }), /not available/);
  assert.equal(validateActivation({ brand: 'Germol', market: 'South Africa', platform: 'TikTok', date: '2026-07-24', activation: 'Teaser' }), null);
});

test('creates linked post, boost and three business day report tasks', () => {
  const tasks = createActivationTasks({ activation: 'Teaser', date: '2026-07-24', platform: 'Instagram', market: 'Nigeria', assetType: 'Video', budget: 75, durationDays: 5 }, 'campaign-1', 'user-1');
  assert.equal(tasks.length, 3);
  assert.equal(tasks[1].dependsOn, tasks[0].id);
  assert.equal(tasks[2].dependsOn, tasks[1].id);
  assert.equal(tasks[2].dueDate, '2026-07-29');
});

test('skips weekends while adding business days', () => assert.equal(addBusinessDays('2026-07-24', 3), '2026-07-29'));

test('maps FluxPlanner budget-plan headings and ignores subtotal rows', () => {
  const rows = normaliseRows([
    { DATE: '24/07/2026', ACTIVATION: 'Teaser', 'ASSET TYPE': 'Video', PLATFORM: 'Instagram', Country: 'Nigeria', DURATION: 5, OBJECTIVE: 'Engagement', BUDGET: 75, COMPLETE: false },
    { BUDGET: 300 }
  ]);
  assert.deepEqual(rows, [{ date: '2026-07-24', activation: 'Teaser', assetType: 'Video', platform: 'Instagram', market: 'Nigeria', durationDays: 5, objective: 'Engagement', budget: 75, actualSpend: 0, complete: false }]);
});

