import test from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessDays, createActivationTasks, normaliseRows, validateActivation, findHeaderRow, parseMoney } from '../lib/automation.js';

test('finds the heading row when a plan opens with a title', () => {
  // The IBUCAP plan puts "IBUCAP Cold & Flu" on row 1, which made every column
  // parse as _1, _2, _3 and silently discarded all 56 rows.
  assert.equal(findHeaderRow([
    ['IBUCAP Cold & Flu', '', '', ''],
    ['DATE', '', 'ACTIVATION', 'ASSET TYPE', 'PLATFORM', 'Country'],
    ['17/07/2026', 'Friday', 'Teaser', 'Video', 'TikTok', 'Nigeria']
  ]), 1);
  assert.equal(findHeaderRow([['DATE', 'ACTIVATION', 'PLATFORM']]), 0);
  assert.equal(findHeaderRow([['Total spend', ''], ['', '']]), -1);
});

test('reads money however the sheet formats it', () => {
  assert.equal(parseMoney('$225.81'), 225.81);   // IBUCAP plan
  assert.equal(parseMoney('R3 511,29'), 3511.29); // rand, comma decimal
  assert.equal(parseMoney('1,234.56'), 1234.56);
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney(120), 120);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney('n/a'), 0);
});

test('a text budget does not import as zero', () => {
  const [row] = normaliseRows([{ DATE: '17/07/2026', ACTIVATION: 'Teaser', PLATFORM: 'TikTok', Country: 'Nigeria', BUDGET: '$225.81', 'ACTUAL SPEND': 'R1 000,50' }]);
  assert.equal(row.budget, 225.81);
  assert.equal(row.actualSpend, 1000.5);
});

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
