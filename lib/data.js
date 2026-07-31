// Supabase persistence for the Project Manager.
//
// No DOM, no rendering, no framework: this module maps between the database
// and the plain task/campaign/member shapes the interface already uses, so the
// front end can be replaced without rewriting any of it.
//
// Business rules stay in automation.js. This file only moves data.

import { BRAND_CATALOG, createActivationTasks } from './automation.js';

const TASK_COLUMNS = [
  'id', 'workspace_id', 'campaign_id', 'activation_key', 'task_type', 'title', 'role_slot',
  'assignee_id', 'market', 'platform', 'due_date', 'status', 'depends_on', 'duration_days',
  'objective', 'live_link', 'report_state', 'results', 'source_meeting_id', 'created_at', 'updated_at'
].join(', ');

// --- shape mapping -------------------------------------------------------
// The database is snake_case and stores free text inside results.results.notes,
// which is where granola-task-sync also writes meeting context. Keeping both on
// the same key means a task created from a meeting reads identically to one
// typed by hand.

export function toTask(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id || '',
    activationKey: row.activation_key || '',
    type: row.task_type,
    title: row.title,
    roleSlot: row.role_slot || '',
    assigneeId: row.assignee_id || '',
    market: row.market || '',
    platform: row.platform || '',
    dueDate: row.due_date,
    status: row.status,
    dependsOn: row.depends_on || null,
    durationDays: row.duration_days || 0,
    objective: row.objective || '',
    liveLink: row.live_link || '',
    reportState: row.report_state || '',
    notes: row.results?.notes || '',
    sourceMeetingId: row.source_meeting_id || null,
    updatedAt: row.updated_at
  };
}

export function fromTask(task, workspaceId) {
  const row = {
    workspace_id: workspaceId,
    campaign_id: task.campaignId || null,
    activation_key: task.activationKey || `manual:${task.id || crypto.randomUUID()}`,
    task_type: task.type || 'To-do',
    title: task.title,
    role_slot: task.roleSlot || null,
    assignee_id: task.assigneeId || null,
    market: task.market || null,
    platform: task.platform || null,
    due_date: task.dueDate,
    status: task.status || 'Not started',
    duration_days: task.durationDays || null,
    objective: task.objective || null,
    live_link: task.liveLink || null,
    report_state: task.reportState || null,
    updated_at: new Date().toISOString()
  };
  // Merge rather than replace: overwriting results would discard the granola
  // meeting keys stored alongside the notes.
  if (task.notes !== undefined) row.results = { ...(task.results || {}), notes: task.notes };
  if (task.dependsOn) row.depends_on = task.dependsOn;
  return row;
}

export function toMember(row) {
  return {
    id: row.id,
    userId: row.user_id || null,
    name: row.display_name,
    email: row.email || '',
    title: row.title || '',
    accessLevel: row.access_level,
    roles: []
  };
}

export function toCampaign(row) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    division: row.division,
    market: row.market || '',
    source: row.source,
    fluxPlanId: row.flux_plan_id || null
  };
}

// --- capabilities --------------------------------------------------------
// For deciding what to render only. Every rule here is enforced again by RLS,
// which is what actually protects the data — a hidden button is not security.

export function capabilities(member) {
  const level = member?.accessLevel;
  const roles = member?.roles || [];
  const isManager = level === 'owner' || level === 'admin';
  return {
    isActive: isManager || level === 'member',
    isManager,
    isOwner: level === 'owner',
    isPending: level === 'pending',
    canSeeAnalytics: isManager || roles.includes('Community Manager'),
    canSeeBudget: isManager || roles.includes('Bookkeeping')
  };
}

// --- import planning -----------------------------------------------------
// Post, Boost and Report are chained by depends_on, but the database assigns
// the ids. The rows therefore have to be inserted in order, each one learning
// the id of the one before it. This function decides that order without
// touching the network so it can be tested directly.

export function planActivationInserts(row, campaignId, paidMediaOwnerId) {
  const [post, boost, report] = createActivationTasks(row, campaignId, paidMediaOwnerId);
  return [
    { task: post, dependsOnIndex: null },
    { task: boost, dependsOnIndex: 0 },
    { task: report, dependsOnIndex: 1 }
  ];
}

// --- data layer ----------------------------------------------------------

export function createDataLayer(client, { workspaceId }) {
  if (!client) throw new Error('A Supabase client is required.');
  if (!workspaceId) throw new Error('A workspaceId is required.');

  // Postgres raises our guard-trigger messages verbatim, and they were written
  // to be shown to a person, so they pass straight through.
  function fail(error, fallback) {
    if (!error) return;
    throw new Error(error.message || fallback);
  }

  async function currentMember() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const { data, error } = await client.from('pm_members')
      .select('id, user_id, display_name, email, title, access_level')
      .eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
    fail(error, 'Could not load your membership.');
    if (!data) return null;
    const member = toMember(data);
    const { data: roles } = await client.from('pm_member_roles')
      .select('role_slot').eq('member_id', member.id).is('campaign_id', null);
    member.roles = (roles || []).map((r) => r.role_slot);
    return member;
  }

  // A new sign-up lands as 'pending' and stays invisible to the workspace until
  // a manager links them. The insert policy pins access_level, so this cannot
  // be used to arrive as an admin.
  //
  // The email column is deliberately left null. Every seeded member already
  // holds a regency.global address and 0001 made (workspace_id, lower(email))
  // unique, so writing it here collides with the very row this person is
  // waiting to be linked to. Their address goes in display_name instead, which
  // is what a manager needs to recognise them, and moves to email on linking.
  async function requestAccess(displayName) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Sign in before requesting access.');
    const { data, error } = await client.from('pm_members').insert({
      workspace_id: workspaceId,
      user_id: user.id,
      display_name: displayName || user.email,
      access_level: 'pending'
    }).select().single();
    // Asking twice is not a failure: pm_members_user_unique means the first
    // request already stands, so treat the collision as success.
    if (error?.code === '23505') return null;
    fail(error, 'Could not request access.');
    return toMember(data);
  }

  async function listMembers() {
    const { data, error } = await client.from('pm_members')
      .select('id, user_id, display_name, email, title, access_level')
      .eq('workspace_id', workspaceId).order('display_name');
    fail(error, 'Could not load the team.');
    const members = (data || []).map(toMember);
    const { data: roles } = await client.from('pm_member_roles')
      .select('member_id, role_slot, campaign_id').eq('workspace_id', workspaceId);
    for (const role of roles || []) {
      const member = members.find((m) => m.id === role.member_id);
      if (member && !role.campaign_id) member.roles.push(role.role_slot);
    }
    return members;
  }

  async function listCampaigns() {
    const { data, error } = await client.from('pm_campaigns')
      .select('id, name, brand, division, market, source, flux_plan_id')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false });
    fail(error, 'Could not load campaigns.');
    return (data || []).map(toCampaign);
  }

  // Budget and metrics live in their own tables precisely so they can be
  // withheld. When the reader lacks the capability RLS returns no rows rather
  // than an error, so the task simply arrives without those fields.
  async function listTasks() {
    const { data, error } = await client.from('pm_tasks')
      .select(TASK_COLUMNS).eq('workspace_id', workspaceId).order('due_date');
    fail(error, 'Could not load tasks.');
    const tasks = (data || []).map(toTask);

    const { data: money } = await client.from('pm_task_financials')
      .select('task_id, budget, actual_spend').eq('workspace_id', workspaceId);
    for (const entry of money || []) {
      const task = tasks.find((t) => t.id === entry.task_id);
      if (task) { task.budget = Number(entry.budget) || 0; task.actualSpend = Number(entry.actual_spend) || 0; }
    }

    const { data: metrics } = await client.from('pm_task_metrics')
      .select('task_id, metrics, source, fetched_at').eq('workspace_id', workspaceId);
    for (const entry of metrics || []) {
      const task = tasks.find((t) => t.id === entry.task_id);
      if (task) task.metrics = { source: entry.source, fetchedAt: entry.fetched_at, ...entry.metrics };
    }
    return tasks;
  }

  async function createTask(task) {
    const { data, error } = await client.from('pm_tasks')
      .insert(fromTask(task, workspaceId)).select(TASK_COLUMNS).single();
    fail(error, 'Could not create the task.');
    return toTask(data);
  }

  // A member may progress their own task but not reassign or reschedule it.
  // pm_guard_task_update raises a readable message when they try, and fail()
  // hands it to the caller unchanged.
  async function updateTask(id, patch) {
    const { data, error } = await client.from('pm_tasks')
      .update(fromTask({ ...patch, id }, workspaceId)).eq('id', id).select(TASK_COLUMNS).single();
    fail(error, 'Could not save the task.');
    return toTask(data);
  }

  async function setFinancials(taskId, { budget, actualSpend }) {
    const { error } = await client.from('pm_task_financials').upsert({
      task_id: taskId, workspace_id: workspaceId,
      budget: budget ?? null, actual_spend: actualSpend ?? null,
      updated_at: new Date().toISOString()
    });
    fail(error, 'Could not save budget.');
  }

  async function logActivity(taskId, actorId, eventType, detail = {}) {
    const { error } = await client.from('pm_task_activity')
      .insert({ task_id: taskId, actor_id: actorId, event_type: eventType, detail });
    if (error) console.warn('Activity not recorded:', error.message);
  }

  // Imports a validated spreadsheet. Rows must already have passed
  // validateActivation; this does not re-check eligibility.
  async function importCampaign({ brand, name, market }, rows, paidMediaOwnerId) {
    const division = BRAND_CATALOG[brand]?.division;
    if (!division) throw new Error(`Unknown brand: ${brand}`);

    const { data: campaign, error } = await client.from('pm_campaigns').insert({
      workspace_id: workspaceId, brand, division, market, name, source: 'spreadsheet'
    }).select('id, name, brand, division, market, source, flux_plan_id').single();
    fail(error, 'Could not create the campaign.');

    const created = [];
    for (const row of rows) {
      const inserted = [];
      for (const step of planActivationInserts(row, campaign.id, paidMediaOwnerId)) {
        const payload = fromTask(step.task, workspaceId);
        payload.campaign_id = campaign.id;
        if (step.dependsOnIndex !== null) payload.depends_on = inserted[step.dependsOnIndex].id;
        const { data, error: taskError } = await client.from('pm_tasks')
          .insert(payload).select(TASK_COLUMNS).single();
        fail(taskError, `Could not create tasks for ${row.activation}.`);
        inserted.push(data);
        if (row.budget) await setFinancials(data.id, { budget: row.budget, actualSpend: row.actualSpend });
      }
      created.push(...inserted.map(toTask));
    }
    return { campaign: toCampaign(campaign), tasks: created };
  }

  return {
    currentMember, requestAccess, listMembers, listCampaigns, listTasks,
    createTask, updateTask, setFinancials, logActivity, importCampaign
  };
}
