import test from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessDays, createActivationTasks, normaliseRows, validateActivation, findHeaderRow, parseMoney, roleForAssetType, groupContentTasks, subtractBusinessDays, fluxPlanRows } from '../lib/automation.js';

test('maps a published FluxPlanner plan onto the import row shape', () => {
  // Mirrors what FluxPlanner's budget-engine actually writes: DD/MM/YYYY
  // dates, lowercase platform ids, country as a full name, the rand figure
  // named zarValue, and _isSubtotal spacer rows between activations.
  const rows = fluxPlanRows({
    campaignName: 'IBUCAP Cold & Flu',
    planData: {
      rows: [
        { date: '17/07/2026', day: 'Friday', activation: 'Teaser', assetType: 'Video', platform: 'tiktok', country: 'Nigeria', zarValue: 3511.29, duration: 7, objective: 'Video Views', complete: false, actualSpend: '', budget: 225.81, _activationId: 'act-1' },
        { date: '17/07/2026', day: 'Friday', activation: 'Teaser', assetType: 'Video', platform: 'instagram', country: 'Nigeria', zarValue: 2340.86, duration: 5, objective: 'Engagement', complete: false, actualSpend: '', budget: 150.54, _activationId: 'act-1' },
        { _isSubtotal: true, activationId: 'act-1', budget: 376.35 }
      ]
    }
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    date: '2026-07-17', activation: 'Teaser', assetType: 'Video', platform: 'TikTok',
    market: 'Nigeria', durationDays: 7, objective: 'Video Views',
    budget: 225.81, actualSpend: 0, randValue: 3511.29, complete: false
  });
  // The mapped rows must satisfy the same eligibility rules as a spreadsheet.
  assert.equal(validateActivation({ ...rows[0], brand: 'Ibucap' }), null);
});

test('an empty or legacy plan maps to no rows rather than throwing', () => {
  assert.deepEqual(fluxPlanRows(null), []);
  assert.deepEqual(fluxPlanRows({}), []);
  assert.deepEqual(fluxPlanRows({ planData: { rows: [{ _isSubtotal: true }] } }), []);
});

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

test('routes an asset to a craft, checking AI before plain video', () => {
  // Order matters: 'AI Video' contains 'video', so a naive rule sends every AI
  // asset to the editor instead of the AI specialist.
  assert.equal(roleForAssetType('AI Video'), 'AI Video');
  assert.equal(roleForAssetType('Video'), 'Video Editor');
  assert.equal(roleForAssetType('Animated Static'), 'Static Design');
  assert.equal(roleForAssetType('Carousel'), 'Static Design');
  assert.equal(roleForAssetType('Caption copy'), 'Content Lead');
  assert.equal(roleForAssetType(''), 'Creative');
  assert.equal(roleForAssetType('Something new'), 'Creative');
});

test('one asset serves every platform it runs on', () => {
  // The same Teaser video appears on four platform rows. Four creative tasks
  // would be four people making the same video.
  const rows = ['TikTok', 'Instagram', 'YouTube', 'Facebook'].map((platform) => ({
    activation: 'Teaser', assetType: 'Video', date: '2026-07-17', platform, market: 'Nigeria'
  }));
  const content = groupContentTasks(rows, 'c1');
  assert.equal(content.length, 1);
  assert.equal(content[0].roleSlot, 'Video Editor');
  assert.match(content[0].title, /TikTok, Instagram, YouTube, Facebook/);
});

test('different assets on the same day stay separate', () => {
  const content = groupContentTasks([
    { activation: 'Teaser', assetType: 'Video', date: '2026-07-17', platform: 'TikTok', market: 'Nigeria' },
    { activation: 'Teaser', assetType: 'Static', date: '2026-07-17', platform: 'Facebook', market: 'Nigeria' }
  ], 'c1');
  assert.equal(content.length, 2);
  assert.deepEqual(content.map((c) => c.roleSlot).sort(), ['Static Design', 'Video Editor']);
});

test('an asset is due before the launch it feeds, skipping weekends', () => {
  // Friday 17 July 2026 launch, three business days earlier is Tuesday 14th.
  assert.equal(subtractBusinessDays('2026-07-17', 3), '2026-07-14');
  // Monday launch has to reach back over the weekend.
  assert.equal(subtractBusinessDays('2026-07-20', 1), '2026-07-17');
});

test('maps FluxPlanner budget-plan headings and ignores subtotal rows', () => {
  const rows = normaliseRows([
    { DATE: '24/07/2026', ACTIVATION: 'Teaser', 'ASSET TYPE': 'Video', PLATFORM: 'Instagram', Country: 'Nigeria', DURATION: 5, OBJECTIVE: 'Engagement', BUDGET: 75, COMPLETE: false },
    { BUDGET: 300 }
  ]);
  assert.deepEqual(rows, [{ date: '2026-07-24', activation: 'Teaser', assetType: 'Video', platform: 'Instagram', market: 'Nigeria', durationDays: 5, objective: 'Engagement', budget: 75, actualSpend: 0, randValue: 0, complete: false }]);
});
