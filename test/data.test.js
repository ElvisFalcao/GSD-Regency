import test from 'node:test';
import assert from 'node:assert/strict';
import { toTask, fromTask, toMember, capabilities, planActivationInserts, createDataLayer } from '../lib/data.js';

test('maps a task row to the shape the interface uses', () => {
  const task = toTask({
    id: 'a1', workspace_id: 'regency-shalina', campaign_id: 'c1', activation_key: 'c1:Teaser:2026-07-24:TikTok',
    task_type: 'Post', title: 'Teaser · TikTok post', assignee_id: 'm1', market: 'Nigeria', platform: 'TikTok',
    due_date: '2026-07-24', status: 'Not started', depends_on: null, results: { notes: 'Copy approved' }
  });
  assert.equal(task.type, 'Post');
  assert.equal(task.dueDate, '2026-07-24');
  assert.equal(task.notes, 'Copy approved');
  assert.equal(task.campaignId, 'c1');
});

test('keeps granola meeting keys when notes are edited', () => {
  const row = fromTask({
    title: 'Confirm post copy', dueDate: '2026-07-28', notes: 'Chased Sian',
    results: { granolaMeetingId: 'granola-123', notes: 'original' }
  }, 'regency-shalina');
  assert.equal(row.results.notes, 'Chased Sian');
  assert.equal(row.results.granolaMeetingId, 'granola-123');
});

test('leaves results untouched when notes are not being edited', () => {
  const row = fromTask({ title: 'Boost', dueDate: '2026-07-24' }, 'regency-shalina');
  assert.equal('results' in row, false);
});

test('budget is never written to pm_tasks', () => {
  const row = fromTask({ title: 'Post', dueDate: '2026-07-24', budget: 120 }, 'regency-shalina');
  assert.equal('budget' in row, false);
});

test('grants analytics by role as well as by tier', () => {
  const sian = capabilities(toMemberWith('member', ['Community Manager']));
  assert.equal(sian.canSeeAnalytics, true);
  assert.equal(sian.canSeeBudget, false);
  assert.equal(sian.isManager, false);

  const nikki = capabilities(toMemberWith('member', ['Bookkeeping']));
  assert.equal(nikki.canSeeBudget, true);
  assert.equal(nikki.canSeeAnalytics, false);

  const leon = capabilities(toMemberWith('member', ['Video Editor']));
  assert.equal(leon.canSeeAnalytics, false);
  assert.equal(leon.canSeeBudget, false);
});

test('managers see everything and pending members see nothing', () => {
  for (const level of ['owner', 'admin']) {
    const can = capabilities(toMemberWith(level, []));
    assert.equal(can.isManager, true);
    assert.equal(can.canSeeAnalytics, true);
    assert.equal(can.canSeeBudget, true);
  }
  const pending = capabilities(toMemberWith('pending', ['Creative']));
  assert.equal(pending.isActive, false);
  assert.equal(pending.isPending, true);
  assert.equal(capabilities(null).isActive, false);
});

test('plans post, boost and report so each learns the previous id', () => {
  const steps = planActivationInserts(
    { activation: 'Teaser', date: '2026-07-24', platform: 'Instagram', market: 'Nigeria', budget: 75, durationDays: 5 },
    'c1', 'm1'
  );
  assert.deepEqual(steps.map((s) => s.task.type), ['Post', 'Boost', 'Report']);
  assert.equal(steps[0].dependsOnIndex, null);
  assert.equal(steps[1].dependsOnIndex, 0);
  assert.equal(steps[2].dependsOnIndex, 1);
});

test('requesting access does not write the email that would collide', async () => {
  let captured = null;
  const db = createDataLayer(fakeClient('comms@regency.global', (payload) => { captured = payload; }), { workspaceId: 'regency-shalina' });
  await db.requestAccess();
  // Zaida's seeded row already holds comms@regency.global, and 0001 made
  // (workspace_id, lower(email)) unique. Writing it here is a duplicate key.
  assert.equal(captured.email, undefined);
  assert.equal(captured.display_name, 'comms@regency.global');
  assert.equal(captured.access_level, 'pending');
  assert.equal(captured.user_id, 'auth-1');
});

test('asking for access twice is not an error', async () => {
  const db = createDataLayer(fakeClient('comms@regency.global', () => {}, { code: '23505', message: 'duplicate key' }), { workspaceId: 'regency-shalina' });
  assert.equal(await db.requestAccess(), null);
});

test('other insert failures still surface', async () => {
  const db = createDataLayer(fakeClient('comms@regency.global', () => {}, { code: '42501', message: 'permission denied' }), { workspaceId: 'regency-shalina' });
  await assert.rejects(() => db.requestAccess(), /permission denied/);
});

test('a budget belongs to the boost alone, not to all three tasks', () => {
  const steps = planActivationInserts(
    { activation: 'Teaser', date: '2026-07-24', platform: 'Instagram', market: 'Nigeria', budget: 75, randValue: 1166.25, durationDays: 5 },
    'c1', 'm1'
  );
  // Attaching money to Post, Boost and Report alike reported every plan at
  // three times its real value.
  const paid = steps.filter((s) => s.task.type === 'Boost');
  assert.equal(paid.length, 1);
  assert.equal(steps.filter((s) => ['Post', 'Report'].includes(s.task.type)).length, 2);
});

test('setFinancials sends only the fields it was given', async () => {
  let captured = null;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email: 'a@b.c' } } }) },
    from: () => ({ upsert: async (payload) => { captured = payload; return { error: null }; } })
  };
  const db = createDataLayer(client, { workspaceId: 'regency-shalina' });
  await db.setFinancials('t1', { actualSpend: 240.5 });
  // An upsert carrying budget: undefined would erase the planned figure every
  // time someone recorded what was actually spent.
  assert.equal(captured.actual_spend, 240.5);
  assert.equal('budget' in captured, false);
  assert.equal('rand_value' in captured, false);
});

test('refuses to build without a client or workspace', () => {
  assert.throws(() => createDataLayer(null, { workspaceId: 'regency-shalina' }), /Supabase client/);
  assert.throws(() => createDataLayer({}, {}), /workspaceId/);
});

// Minimal stand-in for the Supabase client: records what would be inserted and
// replays whichever error the test is interested in.
function fakeClient(email, onInsert, error = null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1', email } } }) },
    from: () => ({
      insert(payload) {
        onInsert(payload);
        return { select: () => ({ single: async () => ({ data: error ? null : { id: 'm9', display_name: email, access_level: 'pending' }, error }) }) };
      }
    })
  };
}

function toMemberWith(accessLevel, roles) {
  const member = toMember({ id: 'm1', display_name: 'Test', access_level: accessLevel });
  member.roles = roles;
  return member;
}
