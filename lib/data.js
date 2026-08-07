// Supabase persistence for the Project Manager.
//
// No DOM, no rendering, no framework: this module maps between the database
// and the plain task/campaign/member shapes the interface already uses, so the
// front end can be replaced without rewriting any of it.
//
// Business rules stay in automation.js. This file only moves data.

import { BRAND_CATALOG, createActivationTasks, groupContentTasks, fluxPlanRows } from './automation.js';

const TASK_COLUMNS = [
  'id', 'workspace_id', 'campaign_id', 'activation_key', 'task_type', 'title', 'role_slot',
  'assignee_id', 'market', 'platform', 'due_date', 'status', 'depends_on', 'duration_days',
  'objective', 'live_link', 'report_state', 'results', 'source_meeting_id', 'assignment_state', 'created_at', 'updated_at'
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
    assignmentState: row.assignment_state || 'confirmed',
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
  if (task.assignmentState) row.assignment_state = task.assignmentState;
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

  // --- membership administration ---
  // pm_link_member does the whole approval in one statement; see 0006 for why
  // it is not three calls from here.
  async function linkMember(pendingId, targetId) {
    const { data, error } = await client.rpc('pm_link_member', { pending_member_id: pendingId, target_member_id: targetId });
    fail(error, 'Could not approve that request.');
    return toMember(Array.isArray(data) ? data[0] : data);
  }

  // For someone who was never seeded: promote the request itself into a member.
  async function approveNewMember(memberId, { email, title, accessLevel = 'member' }) {
    const { data, error } = await client.from('pm_members')
      .update({ email: email || null, title: title || null, access_level: accessLevel })
      .eq('id', memberId).select('id, user_id, display_name, email, title, access_level').single();
    fail(error, 'Could not approve that request.');
    return toMember(data);
  }

  // pm_guard_member_update refuses self-demotion and owner changes by anyone
  // but the owner, and raises a message written to be shown as-is.
  async function setAccessLevel(memberId, accessLevel) {
    const { data, error } = await client.from('pm_members')
      .update({ access_level: accessLevel }).eq('id', memberId)
      .select('id, user_id, display_name, email, title, access_level').single();
    fail(error, 'Could not change that access level.');
    return toMember(data);
  }

  async function grantRole(memberId, roleSlot) {
    const { error } = await client.from('pm_member_roles')
      .insert({ workspace_id: workspaceId, member_id: memberId, role_slot: roleSlot });
    if (error && error.code !== '23505') fail(error, 'Could not grant that role.');
  }

  async function revokeRole(memberId, roleSlot) {
    const { error } = await client.from('pm_member_roles').delete()
      .eq('workspace_id', workspaceId).eq('member_id', memberId).eq('role_slot', roleSlot).is('campaign_id', null);
    fail(error, 'Could not remove that role.');
  }

  // Confirming turns the plan's suggestion into an agreed assignment. Managers
  // only, which RLS enforces regardless of what the interface offers.
  async function confirmAssignments(taskIds) {
    const { data, error } = await client.from('pm_tasks')
      .update({ assignment_state: 'confirmed', updated_at: new Date().toISOString() })
      .in('id', taskIds).select(TASK_COLUMNS);
    fail(error, 'Could not confirm those assignments.');
    return (data || []).map(toTask);
  }

  async function removeRequest(memberId) {
    const { error } = await client.from('pm_members').delete().eq('id', memberId).eq('access_level', 'pending');
    fail(error, 'Could not decline that request.');
  }

  // Plans an author has explicitly published from FluxPlanner. The
  // plans_gsd_read policy grants active workspace members SELECT on published
  // rows only; drafts never appear here.
  async function listPublishedPlans() {
    const { data, error } = await client.from('plans')
      .select('id, campaign_name, country, total_budget, owner_email, updated_at, published_at, gsd_brand, data')
      .eq('published_to_gsd', true).eq('gsd_workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    fail(error, 'Could not load published FluxPlanner plans.');
    return (data || []).map((plan) => ({
      id: plan.id,
      name: plan.campaign_name || 'Untitled plan',
      brand: plan.gsd_brand || '',
      country: plan.country || '',
      totalBudget: Number(plan.total_budget) || 0,
      ownerEmail: plan.owner_email || '',
      updatedAt: plan.updated_at,
      rows: fluxPlanRows(plan.data)
    }));
  }

  // Curation for the open publish door: anyone on the public FluxPlanner page
  // can put a plan in the dropdown, so managers can take one out. Unpublishing
  // clears the flag and nothing else — no write access to the plan itself.
  async function unpublishPlan(planId) {
    const { error } = await client.rpc('pm_unpublish_plan', { plan_id: planId });
    fail(error, 'Could not remove that plan from the list.');
  }

  // Connections without their tokens: the table itself is service-role only.
  async function listConnections() {
    const { data, error } = await client.rpc('pm_list_connections', { ws: workspaceId });
    fail(error, 'Could not load platform connections.');
    return data || [];
  }

  // Drops one connection from the vault. What Facebook grants on the next
  // reconnect is governed on Facebook's consent screen, not here.
  async function removeConnection(platform, kind, externalId) {
    const { error } = await client.rpc('pm_remove_connection', {
      ws: workspaceId, p_platform: platform, p_kind: kind, p_external_id: externalId
    });
    fail(error, 'Could not remove that connection.');
  }

  // Asks meta-oauth for the Facebook consent URL; the caller opens it.
  async function startMetaConnect(supabaseUrl, anonKey) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new Error('Sign in first.');
    const response = await fetch(`${supabaseUrl}/functions/v1/meta-oauth?action=start`, {
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: anonKey }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not start the Meta connection.');
    return body.url;
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
      .select('task_id, budget, actual_spend, rand_value, spend_note').eq('workspace_id', workspaceId);
    for (const entry of money || []) {
      const task = tasks.find((t) => t.id === entry.task_id);
      if (!task) continue;
      task.budget = Number(entry.budget) || 0;
      task.actualSpend = Number(entry.actual_spend) || 0;
      task.randValue = Number(entry.rand_value) || 0;
      task.spendNote = entry.spend_note || '';
    }

    const { data: metrics } = await client.from('pm_task_metrics')
      .select('task_id, metrics, source, fetched_at').eq('workspace_id', workspaceId);
    for (const entry of metrics || []) {
      const task = tasks.find((t) => t.id === entry.task_id);
      if (task) task.metrics = { source: entry.source, fetchedAt: entry.fetched_at, ...entry.metrics };
    }
    return tasks;
  }

  // Managers only, enforced by pm_tasks_manager_delete / pm_campaigns_manage.
  // Deleting a campaign cascades to its tasks, their financials and activity.
  async function deleteTask(id) {
    const { error } = await client.from('pm_tasks').delete().eq('id', id);
    fail(error, 'Could not delete the task.');
  }

  async function deleteCampaign(id) {
    const { error } = await client.from('pm_campaigns').delete().eq('id', id);
    fail(error, 'Could not delete the campaign.');
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

  async function setFinancials(taskId, { budget, actualSpend, randValue, spendNote }) {
    const row = { task_id: taskId, workspace_id: workspaceId, updated_at: new Date().toISOString() };
    // Only send what the caller supplied: an upsert with undefined would wipe
    // the plan's budget every time someone records what was actually spent.
    if (budget !== undefined) row.budget = budget ?? null;
    if (actualSpend !== undefined) row.actual_spend = actualSpend ?? null;
    if (randValue !== undefined) row.rand_value = randValue ?? null;
    if (spendNote !== undefined) row.spend_note = spendNote || null;
    const { error } = await client.from('pm_task_financials').upsert(row);
    fail(error, 'Could not save spend.');
  }

  async function logActivity(taskId, actorId, eventType, detail = {}) {
    const { error } = await client.from('pm_task_activity')
      .insert({ task_id: taskId, actor_id: actorId, event_type: eventType, detail });
    if (error) console.warn('Activity not recorded:', error.message);
  }

  // Imports a validated spreadsheet. Rows must already have passed
  // validateActivation; this does not re-check eligibility.
  async function importCampaign({ brand, name, market, fluxPlanId }, rows, { paidMediaOwnerId, resolveRole } = {}) {
    const division = BRAND_CATALOG[brand]?.division;
    if (!division) throw new Error(`Unknown brand: ${brand}`);
    const owner = (slot) => (resolveRole ? resolveRole(slot) : null);

    const { data: campaign, error } = await client.from('pm_campaigns').insert({
      workspace_id: workspaceId, brand, division, market, name,
      source: fluxPlanId ? 'fluxplanner' : 'spreadsheet',
      flux_plan_id: fluxPlanId || null
    }).select('id, name, brand, division, market, source, flux_plan_id').single();
    // flux_plan_id is unique across campaigns, so importing the same plan
    // twice fails here by design rather than duplicating 100+ tasks.
    if (error?.code === '23505') throw new Error(`"${name}" has already been imported from FluxPlanner. Delete the existing campaign first if you want to re-import it.`);
    fail(error, 'Could not create the campaign.');

    // There is no transaction across these inserts. If one row fails partway,
    // say how far it got and name the campaign, otherwise the caller is left
    // with a half-imported plan and no idea which rows landed.
    const created = [];
    let done = 0;

    // The produced asset comes first, so the Post that publishes it can depend
    // on it. One asset serves several platform rows, hence the grouping.
    const contentIds = new Map();
    for (const content of groupContentTasks(rows, campaign.id)) {
      const payload = fromTask({ ...content, assigneeId: owner(content.roleSlot), assignmentState: 'proposed' }, workspaceId);
      payload.campaign_id = campaign.id;
      const { data, error: contentError } = await client.from('pm_tasks').insert(payload).select(TASK_COLUMNS).single();
      if (contentError) throw new Error(`Could not create the asset task for ${content.activation}: ${contentError.message}`);
      contentIds.set(`${content.activation}:${content.assetType}:${content.date}`, data.id);
      created.push(toTask(data));
    }

    for (const row of rows) {
      const inserted = [];
      const contentId = contentIds.get(`${row.activation}:${row.assetType || 'Asset'}:${row.date}`);
      try {
        for (const step of planActivationInserts(row, campaign.id, paidMediaOwnerId)) {
          const payload = fromTask({ ...step.task, assignmentState: 'proposed' }, workspaceId);
          payload.campaign_id = campaign.id;
          if (step.dependsOnIndex !== null) payload.depends_on = inserted[step.dependsOnIndex].id;
          else if (contentId) payload.depends_on = contentId;
          const { data, error: taskError } = await client.from('pm_tasks')
            .insert(payload).select(TASK_COLUMNS).single();
          if (taskError) throw new Error(taskError.message);
          inserted.push(data);
          // The money belongs to the paid placement. Writing it against Post,
          // Boost and Report alike would report every plan at three times its
          // real value.
          if (step.task.type === 'Boost' && (row.budget || row.randValue)) {
            await setFinancials(data.id, { budget: row.budget, actualSpend: row.actualSpend, randValue: row.randValue });
          }
        }
      } catch (error) {
        throw new Error(`${row.activation} · ${row.platform} on ${row.date} failed after ${done} of ${rows.length} activations imported. The campaign "${campaign.name}" was created and holds what succeeded — delete it before retrying. Cause: ${error.message}`);
      }
      done += 1;
      created.push(...inserted.map(toTask));
    }
    return { campaign: toCampaign(campaign), tasks: created };
  }

  return {
    currentMember, requestAccess, listMembers, listCampaigns, listPublishedPlans, unpublishPlan, listTasks,
    createTask, updateTask, deleteTask, deleteCampaign, setFinancials, logActivity, importCampaign,
    linkMember, approveNewMember, setAccessLevel, grantRole, revokeRole, removeRequest, listConnections, removeConnection, startMetaConnect,
    confirmAssignments
  };
}
