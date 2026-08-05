import { BRAND_CATALOG, PLATFORM_IDS, WORKFLOW_TEMPLATE, normaliseRows, validateActivation, createActivationTasks, taskFlags, findHeaderRow, groupContentTasks, detectBrand, buildPostPipeline } from './lib/automation.js';
import { createDataLayer, capabilities } from './lib/data.js';

const cfg = window.PM_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
const client = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
const db = client ? createDataLayer(client, { workspaceId: cfg.workspaceId || 'regency-shalina' }) : null;
const DEMO_KEY = 'regency-pm-demo';

// Demo mode runs with no credentials so the interface can be shown offline.
// It never reaches the database, so these ids are slugs rather than uuids.
const DEMO_MEMBERS = [
  { id: 'shane', name: 'Shane Killeen', title: 'Strategic Director', accessLevel: 'owner', roles: ['Strategy', 'Approval Coordinator'] },
  { id: 'elvis', name: 'Elvis Falcao', title: 'Paid Media Owner', accessLevel: 'admin', roles: ['Paid Media Owner', 'Approval Coordinator'] },
  { id: 'zaida', name: 'Zaida Kays', title: 'Process Coordinator', accessLevel: 'admin', roles: ['Approval Coordinator'] },
  { id: 'kesia', name: 'Kesia Burdett', title: 'Creative Lead', accessLevel: 'member', roles: ['Creative'] },
  { id: 'tshwaraganyo', name: 'Tshwaraganyo Lekabe', title: 'Creative Lead', accessLevel: 'member', roles: ['Creative'] },
  { id: 'leon', name: 'Leon-Erasmus Maree', title: 'Video Producer & Editor', accessLevel: 'member', roles: ['Video Editor', 'Production'] },
  { id: 'sian', name: 'Sian Touzel', title: 'Community Manager', accessLevel: 'member', roles: ['Community Manager'] },
  { id: 'nikki', name: 'Nikki Dickson', title: 'Bookkeeping', accessLevel: 'member', roles: ['Bookkeeping'] }
];

// Every role the workspace can grant: the workflow stages plus Bookkeeping,
// which is real work (Nikki reconciles spend) but not a content stage.
const ROLE_SLOTS = [...new Set([...WORKFLOW_TEMPLATE.map((s) => s.role), 'Bookkeeping'])].sort();

let state = { members: [], campaigns: [], tasks: [], member: null };
let can = capabilities(null);
let preview = [];
// Where the current preview came from: {type:'file'} or {type:'flux', plan}.
// Decides the campaign name and whether flux_plan_id links it on import.
let previewSource = null;
let fluxPlans = [];
let activeTask = null;
let authMode = 'signin';
let recovering = false;

const $ = (id) => document.getElementById(id);
function escape(value = '') { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function today() { return new Date().toLocaleDateString('en-CA', { timeZone: cfg.timezone || 'Africa/Johannesburg' }); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3600); }
function memberName(id) { return state.members.find((member) => member.id === id)?.name || 'Unassigned'; }
function memberWithRole(slot) { return state.members.find((member) => member.roles?.includes(slot))?.id || null; }
function campaignName(id) { return state.campaigns.find((c) => c.id === id)?.name || ''; }
function taskStatus(task) { return taskFlags(task, today()); }
function brandOptions(selected = '') { return `<option value="">Choose brand</option>${Object.keys(BRAND_CATALOG).map((b) => `<option ${b === selected ? 'selected' : ''}>${b}</option>`).join('')}`; }
function memberOptions(selected = '') { return `<option value="">Unassigned</option>${state.members.map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${escape(m.name)} — ${escape(m.title || '')}</option>`).join('')}`; }
function campaignOptions(selected = '') { return `<option value="">General / no campaign</option>${state.campaigns.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}`; }

// --- session -------------------------------------------------------------

async function boot() {
  bindEvents();
  if (!configured) return startDemo();
  // A recovery link signs the user in with a short-lived session; until they
  // have chosen a new password, every other event must not hide that screen.
  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; return showGate('recover'); }
    refresh().catch((error) => { console.error(error); toast(error.message); });
  });
  await refresh();
}

async function refresh() {
  if (recovering) return showGate('recover');
  const { data: { session } } = await client.auth.getSession();
  if (!session) return showGate('signin');

  let member = null;
  try { member = await db.currentMember(); } catch (error) { return showGate('signin', error.message); }

  // Signed in but not yet part of the workspace. Rather than a bare panel, show
  // what Regency does and which brands it runs — none of which needs the
  // database, since BRAND_CATALOG is a client-side constant. Operational data
  // stays hidden, and RLS would refuse it anyway.
  can = capabilities(member);
  if (!member || !can.isActive) { hideGate(); state = { members: [], campaigns: [], tasks: [], member }; return renderWelcome(member); }

  hideGate();
  try {
    const [members, campaigns, tasks] = await Promise.all([db.listMembers(), db.listCampaigns(), db.listTasks()]);
    state = { members, campaigns, tasks, member };
  } catch (error) { toast(error.message); return; }
  render();
}

// Where this app lives right now — localhost in dev, GitHub Pages deployed.
// Auth emails carry this as their return address, so the reset link comes
// back to the same app the person started from instead of the project-wide
// Site URL default (which once pointed at localhost:3000 and stranded a
// perfectly good recovery link on a dead port).
function appUrl() { return window.location.origin + window.location.pathname.replace(/index\.html$/, ''); }

const GATES = {
  signin: { title: 'Sign in', intro: 'Use your Regency email address.', submit: 'Sign in', secondary: 'Create an account', secondaryTarget: 'signup', email: true, password: true, forgot: true },
  signup: { title: 'Create an account', intro: 'Register with your Regency email. A manager links you to the workspace before anything unlocks.', submit: 'Create account', secondary: 'I already have an account', secondaryTarget: 'signin', email: true, password: true },
  forgot: { title: 'Reset your password', intro: 'Enter your email and we send a link. It opens this app and asks you for a new password.', submit: 'Send reset link', secondary: 'Back to sign in', secondaryTarget: 'signin', email: true },
  recover: { title: 'Choose a new password', intro: 'You followed a recovery link, so you are signed in — set the new password for your account now.', submit: 'Save new password', password: true, password2: true }
};

// Shown to anyone signed in but not yet active: registered and waiting, or
// linked but disabled. Deliberately orienting rather than a dead end.
function renderWelcome(member) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('welcomeView').classList.remove('hidden');
  document.querySelectorAll('.nav').forEach((n) => n.classList.add('hidden'));
  $('pageTitle').textContent = 'Welcome to Regency';
  $('addTaskButton').classList.add('hidden');
  $('uploadButton').classList.add('hidden');
  $('seedDemo').classList.add('hidden');
  $('whoami').classList.remove('hidden');
  $('whoamiName').textContent = member?.name || 'Signed in';
  $('whoamiRole').textContent = member ? 'Awaiting approval' : 'Not linked yet';
  $('notificationCount').textContent = '0';

  const waiting = member
    ? '<span class="welcome-status">◷ Waiting for Shane, Elvis or Zaida to approve you</span>'
    : '<button id="requestAccess" class="secondary" type="button">Request access to this workspace</button>';
  const brands = Object.entries(BRAND_CATALOG).map(([brand, info]) => `<article class="brand-tile"><p class="eyebrow">${escape(info.division)}</p><h3>${escape(brand)}</h3><p>${escape(info.markets.join(', '))}</p></article>`).join('');

  $('welcomePanel').innerHTML = `<div class="welcome-lead">
      <h2>Regency · Shalina Healthcare</h2>
      <p>This is where Regency runs the Shalina account: campaign plans become Post, Boost and Report tasks with owners and deadlines, alongside the everyday work that is not tied to a campaign. Once you are approved you will see what is assigned to you and what the rest of the team is working on.</p>
      ${waiting}
    </div>
    <div><p class="eyebrow">BRANDS WE RUN</p><div class="brand-grid">${brands}</div></div>
    <div><p class="eyebrow">HOW WORK FLOWS</p><div class="brand-grid">${WORKFLOW_TEMPLATE.slice(0, 6).map((s) => `<article class="brand-tile"><p class="eyebrow">STAGE ${s.order}</p><h3>${escape(s.name)}</h3><p>${escape(s.role)}</p></article>`).join('')}</div></div>`;

  const request = $('requestAccess');
  if (request) {
    request.onclick = async () => {
      request.disabled = true;
      try { await db.requestAccess(); await refresh(); }
      catch (error) { toast(error.message); request.disabled = false; }
    };
  }
}

function showGate(mode, message = '') {
  authMode = mode;
  const gate = GATES[mode];
  $('authTitle').textContent = gate.title;
  $('authIntro').textContent = gate.intro;
  $('authEmailRow').classList.toggle('hidden', !gate.email);
  $('authPasswordRow').classList.toggle('hidden', !gate.password);
  $('authPassword2Row').classList.toggle('hidden', !gate.password2);
  $('authSubmit').textContent = gate.submit;
  $('authSecondary').textContent = gate.secondary || '';
  $('authSecondary').classList.toggle('hidden', !gate.secondary);
  $('authForgot').classList.toggle('hidden', !gate.forgot);
  $('authPassword').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  const passwordLabel = $('authPasswordRow').firstChild;
  if (passwordLabel) passwordLabel.textContent = gate.password2 ? 'New password' : 'Password';
  authError(message);
  $('authGate').classList.remove('hidden');
}

function hideGate() { $('authGate').classList.add('hidden'); authError(''); }
function authError(message) { const el = $('authError'); el.textContent = message; el.classList.toggle('show', Boolean(message)); }

async function submitGate(event) {
  event.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  try {
    if (authMode === 'signin') {
      if (!email || !password) return authError('Enter your email and password.');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else if (authMode === 'signup') {
      if (!email || password.length < 8) return authError('Enter your email and a password of at least 8 characters.');
      const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
      if (error) throw error;
      // A session may not exist yet if the project requires email confirmation.
      return showGate('signin', 'Account created. Confirm your email if prompted, then sign in.');
    } else if (authMode === 'forgot') {
      if (!email) return authError('Enter the email you registered with.');
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
      if (error) throw error;
      return showGate('signin', 'Reset link sent — check the inbox. The link opens this app and asks for a new password.');
    } else if (authMode === 'recover') {
      if (password.length < 8) return authError('Use at least 8 characters.');
      if (password !== $('authPassword2').value) return authError('The two passwords do not match.');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      recovering = false;
      toast('Password updated.');
    }
    await refresh();
  } catch (error) { authError(error.message); }
}

async function signOut() {
  await client.auth.signOut();
  state = { members: [], campaigns: [], tasks: [], member: null };
  can = capabilities(null);
  showGate('signin');
}

// --- demo mode -----------------------------------------------------------

function startDemo() {
  const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || '{}');
  state = { members: DEMO_MEMBERS, campaigns: saved.campaigns || [], tasks: saved.tasks || [], member: DEMO_MEMBERS[1] };
  can = capabilities(state.member);
  hideGate();
  render();
  toast('Demo mode — populate config.js to connect to the workspace.');
}

function persistDemo() { localStorage.setItem(DEMO_KEY, JSON.stringify({ campaigns: state.campaigns, tasks: state.tasks })); }

// --- rendering -----------------------------------------------------------

function render() {
  applyCapabilities();
  renderOverview(); renderTasks(); renderPosts(); renderCampaigns(); renderSpend(); renderReports(); renderSettings();
  renderNotifications();
}

// The bell answers "what needs me right now": overdue work, boosts launching
// today, reports waiting on results. Clicking an entry opens the task itself.
function notificationTasks() {
  return state.tasks
    .map((t) => ({ t, f: taskStatus(t) }))
    .filter(({ f }) => f.overdue || f.boostToday || f.reportDue)
    .sort((a, b) => a.t.dueDate.localeCompare(b.t.dueDate));
}

function renderNotifications() {
  const items = notificationTasks();
  $('notificationCount').textContent = items.length;
  $('notificationCount').style.display = items.length ? '' : 'none';
  $('notifPanel').innerHTML = items.length
    ? items.slice(0, 12).map(({ t, f }) => {
        const reason = f.overdue ? 'Overdue' : f.boostToday ? 'Boost launches today' : 'Report due';
        return `<button type="button" class="notif-item" data-notif-task="${t.id}"><b>${escape(t.title)}</b><small>${escape(reason)} · ${escape(t.dueDate)} · ${escape(memberName(t.assigneeId))}</small></button>`;
      }).join('') + (items.length > 12 ? `<div class="notif-more">…and ${items.length - 12} more in the task list</div>` : '')
    : '<div class="notif-more">Nothing needs attention right now.</div>';
  document.querySelectorAll('[data-notif-task]').forEach((el) => {
    el.onclick = () => { $('notifPanel').classList.add('hidden'); openTask(el.dataset.notifTask); };
  });
}

// Hiding a control is a courtesy, not a control. Every rule below is enforced
// again by row-level security, which is what actually refuses the request.
function applyCapabilities() {
  // renderWelcome hides every nav item; an active member gets them back.
  document.querySelectorAll('.nav').forEach((n) => n.classList.remove('hidden'));
  $('welcomeView').classList.add('hidden');
  $('whoami').classList.toggle('hidden', !state.member);
  if (state.member) {
    $('whoamiName').textContent = state.member.name;
    $('whoamiRole').textContent = [state.member.title, (state.member.roles || []).join(' · ')].filter(Boolean).join(' — ');
  }
  $('signOut').classList.toggle('hidden', !configured);
  $('addTaskButton').classList.toggle('hidden', !can.isManager);
  $('uploadButton').classList.toggle('hidden', !can.isManager);
  $('seedDemo').classList.toggle('hidden', configured);
  document.querySelector('[data-view="spend"]').classList.toggle('hidden', !can.canSeeBudget);
  document.querySelector('[data-view="reports"]').classList.toggle('hidden', !can.canSeeAnalytics);
  document.querySelector('[data-view="settings"]').classList.toggle('hidden', !can.isManager);
}

function renderOverview() {
  const flags = state.tasks.map(taskStatus);
  const cards = [
    ['Due today', state.tasks.filter((t) => t.dueDate === today() && t.status !== 'Done').length, 'tasks need action'],
    ['Overdue', flags.filter((f) => f.overdue).length, 'tasks past deadline'],
    ['Boosts today', flags.filter((f) => f.boostToday).length, 'planned paid activations'],
    ['Reports due', flags.filter((f) => f.reportDue).length, 'results awaiting capture']
  ];
  $('statCards').innerHTML = cards.map(([label, value, caption]) => `<article class="stat"><p class="eyebrow">${label}</p><div class="number">${value}</div><div class="caption">${caption}</div></article>`).join('');
  // Pre-assigned work is a proposal the plan made, not a decision anyone took.
  // It sits at the top until a manager agrees to it.
  const proposed = state.tasks.filter((t) => t.assignmentState === 'proposed');
  $('proposalBar').innerHTML = proposed.length && can.isManager
    ? `<div><b>${proposed.length} pre-assigned tasks</b> were routed from the plan by asset type. Review them — editing one confirms it — or confirm the lot.</div><div class="proposal-actions"><button id="reviewProposed" class="secondary" type="button">Review tasks</button><button id="confirmAll" class="primary" type="button">Confirm all</button></div>`
    : '';
  $('proposalBar').classList.toggle('hidden', !proposed.length || !can.isManager);
  if (proposed.length && can.isManager) {
    $('reviewProposed').onclick = () => {
      $('assignmentFilter').value = 'proposed';
      document.querySelector('[data-view="tasks"]').click();
      renderTasks();
    };
    $('confirmAll').onclick = guard(async () => {
      if (!db) { proposed.forEach((t) => { t.assignmentState = 'confirmed'; }); persistDemo(); render(); return toast('Assignments confirmed.'); }
      const saved = await db.confirmAssignments(proposed.map((t) => t.id));
      saved.forEach((task) => { const i = state.tasks.findIndex((t) => t.id === task.id); if (i >= 0) state.tasks[i] = task; });
      render(); toast(`Confirmed ${saved.length} assignments.`);
    });
  }

  const priority = state.tasks.filter((t) => { const f = taskStatus(t); return f.overdue || f.boostToday || f.reportDue || t.dueDate === today(); }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $('priorityTasks').innerHTML = priority.length
    ? priority.map(taskCard).join('')
    : `<div class="task-card"><div class="task-mark"></div><div><h3>You’re clear</h3><p>${can.isManager ? 'Import a budget plan to see operations here.' : 'Nothing needs your attention right now.'}</p></div></div>`;
  $('teamBoard').innerHTML = state.members.filter((m) => m.accessLevel !== 'pending').map((member) => {
    const tasks = state.tasks.filter((task) => task.assigneeId === member.id && !['Done', 'Cancelled'].includes(task.status));
    const assigned = tasks.slice(0, 3).map((task) => `<li>${escape(task.title)} <small>${escape(task.dueDate)}</small></li>`).join('') || '<li class="quiet">No active tasks</li>';
    return `<article class="team-card"><div class="team-avatar">${escape(member.name.charAt(0))}</div><div><h3>${escape(member.name)}</h3><p>${escape(member.title || '')}</p></div><b>${tasks.length}</b><ul>${assigned}</ul></article>`;
  }).join('');
  bindTaskCards();
}

function taskCard(t) {
  const f = taskStatus(t);
  const context = [campaignName(t.campaignId), t.market, t.platform].filter(Boolean).join(' · ') || 'General task';
  const proposed = t.assignmentState === 'proposed' ? '<span class="badge proposed">pre-assigned</span> · ' : '';
  return `<article class="task-card" data-task-id="${t.id}"><div class="task-mark ${t.type}"></div><div><h3>${escape(t.title)}</h3><p>${escape(context)} · <span class="badge ${t.type}">${t.type || 'To-do'}</span> · ${proposed}${escape(memberName(t.assigneeId))}</p></div><div class="due ${f.overdue ? 'overdue' : ''}">${f.overdue ? 'Overdue · ' : ''}${escape(t.dueDate)}<br><span class="badge">${escape(t.status)}</span></div></article>`;
}

function bindTaskCards() { document.querySelectorAll('[data-task-id]').forEach((el) => { el.onclick = () => openTask(el.dataset.taskId); }); }

function renderTasks() {
  const fill = (id, values) => { const el = $(id); const chosen = el.value; el.innerHTML = `<option value="">${el.options[0]?.text || 'All'}</option>${[...new Set(values)].filter(Boolean).sort().map((v) => `<option ${v === chosen ? 'selected' : ''}>${escape(v)}</option>`).join('')}`; };
  fill('brandFilter', state.campaigns.map((c) => c.brand)); fill('marketFilter', state.tasks.map((t) => t.market));
  fill('platformFilter', PLATFORM_IDS); fill('assigneeFilter', state.members.map((m) => m.name));
  const query = $('taskSearch').value.toLowerCase();
  const filters = { brand: $('brandFilter').value, market: $('marketFilter').value, platform: $('platformFilter').value, assignee: $('assigneeFilter').value, type: $('typeFilter').value, status: $('statusFilter').value, assignment: $('assignmentFilter').value };
  const tasks = state.tasks.filter((t) => (!query || t.title.toLowerCase().includes(query))
    && (!filters.brand || state.campaigns.find((c) => c.id === t.campaignId)?.brand === filters.brand)
    && (!filters.market || t.market === filters.market) && (!filters.platform || t.platform === filters.platform)
    && (!filters.assignee || memberName(t.assigneeId) === filters.assignee)
    && (!filters.type || t.type === filters.type) && (!filters.status || t.status === filters.status)
    && (!filters.assignment || (t.assignmentState || 'confirmed') === filters.assignment));
  $('taskTable').innerHTML = `<table><thead><tr><th>Task</th><th>Campaign / Brand</th><th>Assigned to</th><th>Due</th><th>Status</th></tr></thead><tbody>${tasks.map((t) => `<tr data-task-id="${t.id}"><td><b>${escape(t.title)}</b><br><span class="badge ${t.type}">${t.type || 'To-do'}</span>${t.assignmentState === 'proposed' ? ' <span class="badge proposed">pre-assigned</span>' : ''}</td><td>${escape(campaignName(t.campaignId))}</td><td>${escape(memberName(t.assigneeId))}</td><td class="${taskStatus(t).overdue ? 'due overdue' : ''}">${escape(t.dueDate)}</td><td>${escape(t.status)}</td></tr>`).join('') || '<tr><td colspan="5">No tasks match these filters.</td></tr>'}</tbody></table>`;
  bindTaskCards();
}

// --- post pipeline -------------------------------------------------------
// One line per planned post: asset → post → boost → report, with the current
// holder visible. Chasing means clicking the stage that is stuck.

const STAGE_LABELS = { content: 'Asset', post: 'Post', boost: 'Boost', report: 'Report' };
const CURRENT_LABELS = { content: 'Waiting on the asset', post: 'Ready to post', boost: 'Boost due', report: 'Awaiting report', complete: 'Complete' };

function renderPosts() {
  const fill = $('postsCampaignFilter');
  const chosen = fill.value;
  fill.innerHTML = `<option value="">All campaigns</option>${state.campaigns.map((c) => `<option value="${c.id}" ${c.id === chosen ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}`;

  let placements = buildPostPipeline(state.tasks, today());
  if (fill.value) placements = placements.filter((p) => p.campaignId === fill.value);
  if ($('postsAttention').checked) placements = placements.filter((p) => p.overdue || p.blocked);

  // One card per activation × date; its platforms are rows inside it, sharing
  // one asset. That mirrors how the work actually happens.
  const groups = new Map();
  for (const placement of placements) {
    const key = `${placement.campaignId}:${placement.activation}:${placement.date}`;
    if (!groups.has(key)) groups.set(key, { activation: placement.activation, date: placement.date, campaignId: placement.campaignId, content: placement.stages.content, rows: [] });
    groups.get(key).rows.push(placement);
  }

  const stageChip = (stage, task) => {
    if (!task) return `<span class="stage-chip missing">${STAGE_LABELS[stage]}</span>`;
    const flags = taskStatus(task);
    const cls = task.status === 'Done' ? 'done' : task.status === 'Blocked' ? 'blocked' : flags.overdue ? 'overdue' : task.status === 'In progress' ? 'active' : 'todo';
    const link = stage === 'post' && task.liveLink ? ' 🔗' : '';
    return `<button type="button" class="stage-chip ${cls}" data-task-id="${task.id}" title="${escape(task.status)} · ${escape(memberName(task.assigneeId))}${task.dueDate ? ` · due ${escape(task.dueDate)}` : ''}">${STAGE_LABELS[stage]}${link}</button>`;
  };

  $('postsBoard').innerHTML = [...groups.values()].map((group) => {
    const done = group.rows.filter((p) => p.current === 'complete').length;
    return `<article class="pipe-card">
      <header><div><p class="eyebrow">${escape(campaignName(group.campaignId))} · ${escape(group.date)}</p><h3>${escape(group.activation)}</h3></div><b>${done}/${group.rows.length} complete</b></header>
      ${group.content ? `<div class="pipe-asset">${stageChip('content', group.content)} <span>${escape(group.content.title)} — ${escape(memberName(group.content.assigneeId))}</span></div>` : ''}
      ${group.rows.map((p) => `<div class="pipe-row ${p.overdue ? 'overdue' : ''}">
        <span class="pipe-platform">${escape(p.platform)}</span>
        <span class="pipe-stages">${['post', 'boost', 'report'].map((stage) => stageChip(stage, p.stages[stage])).join('<i class="pipe-arrow">→</i>')}</span>
        <span class="pipe-state ${p.overdue ? 'overdue' : ''} ${p.current === 'complete' ? 'done' : ''}">${p.blocked ? 'Blocked' : p.overdue ? `${CURRENT_LABELS[p.current]} — overdue` : CURRENT_LABELS[p.current]}${p.currentTask ? ` · ${escape(memberName(p.currentTask.assigneeId))}` : ''}</span>
      </div>`).join('')}
    </article>`;
  }).join('') || `<p class="quiet-note">${$('postsAttention').checked ? 'Nothing needs chasing — every post is on track.' : 'No planned posts yet. Import a budget plan or a published FluxPlanner plan to fill this view.'}</p>`;
  bindTaskCards();
}

function renderCampaigns() {
  $('campaignList').innerHTML = state.campaigns.map((c) => {
    const tasks = state.tasks.filter((t) => t.campaignId === c.id);
    return `<article class="campaign"><p class="eyebrow">${escape(c.division || BRAND_CATALOG[c.brand]?.division || '')} · ${escape(c.market)}</p><h3>${escape(c.name)}</h3><p>${escape(c.brand)} · ${tasks.length} generated operational tasks</p><div class="meta"><span>FluxPlanner: ${c.fluxPlanId ? 'linked' : 'spreadsheet import'}</span><span>${tasks.filter((t) => t.status === 'Done').length}/${tasks.length} done</span></div></article>`;
  }).join('') || '<p>No campaigns have been imported yet.</p>';
}

// Budget arrives only for readers holding the Bookkeeping capability. For
// everyone else the field is simply absent, so there is nothing to check.
function renderReports() {
  const reports = state.tasks.filter((t) => t.type === 'Report').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $('reportList').innerHTML = reports.map((t) => {
    const f = taskStatus(t);
    const money = t.budget === undefined ? '' : ` · Budget ${t.budget}`;
    return `<article class="task-card" data-task-id="${t.id}"><div class="task-mark Report"></div><div><h3>${escape(t.title)}</h3><p>${escape(t.objective || 'Objective not set')}${money} · ${escape(t.reportState || 'Awaiting data')}</p></div><div class="due ${f.reportDue ? 'overdue' : ''}">${f.reportDue ? 'Due · ' : ''}${escape(t.dueDate)}</div></article>`;
  }).join('') || '<p>No reporting tasks yet.</p>';
  bindTaskCards();
}

// --- spend ---------------------------------------------------------------
// Money lives on the Boost, which is the paid placement. Post and Report carry
// none, so they are simply absent here rather than counted as zero.

function money(value, symbol = '$') { return `${symbol}${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function spendRows() { return state.tasks.filter((t) => t.type === 'Boost' && t.budget !== undefined); }

function renderSpend() {
  if (!can.canSeeBudget) { $('spendTotals').innerHTML = ''; $('spendTable').innerHTML = '<p>You do not have access to budget figures.</p>'; $('spendEntry').innerHTML = ''; return; }
  const rows = spendRows();
  const planned = rows.reduce((sum, t) => sum + (t.budget || 0), 0);
  const actual = rows.reduce((sum, t) => sum + (t.actualSpend || 0), 0);
  const rand = rows.reduce((sum, t) => sum + (t.randValue || 0), 0);
  const recorded = rows.filter((t) => t.actualSpend).length;
  // Variance is only meaningful against placements that have reported. Against
  // the full plan it just tracks how much of the campaign has run.
  const reportedPlanned = rows.filter((t) => t.actualSpend).reduce((sum, t) => sum + (t.budget || 0), 0);
  const variance = actual - reportedPlanned;

  $('spendTotals').innerHTML = [
    ['Planned', money(planned), `${rows.length} placements`],
    ['Actual so far', money(actual), `${recorded} of ${rows.length} reported`],
    ['Variance on reported', `${variance >= 0 ? '+' : '−'}${money(Math.abs(variance))}`, variance > 0 ? 'over what was planned' : variance < 0 ? 'under what was planned' : 'on plan'],
    ['Plan value in rand', money(rand, 'R'), 'at the plan’s own rate']
  ].map(([label, value, caption]) => `<article class="stat"><p class="eyebrow">${label}</p><div class="number">${escape(value)}</div><div class="caption">${escape(caption)}</div></article>`).join('');

  const key = $('spendGroup').value || 'campaign';
  const label = (t) => ({ campaign: campaignName(t.campaignId) || 'No campaign', platform: t.platform || '—', market: t.market || '—', activation: (t.title || '').split(' · ')[0] }[key]);
  const groups = new Map();
  for (const task of rows) {
    const name = label(task);
    if (!groups.has(name)) groups.set(name, { name, planned: 0, actual: 0, rand: 0, count: 0, reported: 0 });
    const g = groups.get(name);
    g.planned += task.budget || 0; g.actual += task.actualSpend || 0; g.rand += task.randValue || 0;
    g.count += 1; if (task.actualSpend) g.reported += 1;
  }
  const ordered = [...groups.values()].sort((a, b) => b.planned - a.planned);
  $('spendTable').innerHTML = ordered.length ? `<table><thead><tr><th>${escape(key)}</th><th>Placements</th><th>Planned</th><th>Actual</th><th>Difference</th><th>Rand value</th></tr></thead><tbody>${ordered.map((g) => {
    const diff = g.actual - (g.reported ? g.planned * (g.reported / g.count) : 0);
    return `<tr><td><b>${escape(g.name)}</b></td><td>${g.reported}/${g.count} reported</td><td>${escape(money(g.planned))}</td><td>${escape(money(g.actual))}</td><td class="${g.reported && diff > 0 ? 'due overdue' : ''}">${g.reported ? escape(`${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))}`) : '—'}</td><td>${escape(money(g.rand, 'R'))}</td></tr>`;
  }).join('')}</tbody></table>` : '<p>No paid placements yet. Import a budget plan to populate this.</p>';

  const outstanding = rows.filter((t) => !t.actualSpend && t.dueDate <= today()).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  $('spendEntry').innerHTML = outstanding.length ? outstanding.slice(0, 25).map((t) => `<article class="task-card spend-row">
      <div class="task-mark Boost"></div>
      <div><h3>${escape(t.title)}</h3><p>${escape([campaignName(t.campaignId), t.market].filter(Boolean).join(' · '))} · planned ${escape(money(t.budget))}${t.randValue ? ` · ${escape(money(t.randValue, 'R'))}` : ''} · ran ${escape(t.dueDate)}</p></div>
      <div class="spend-input"><input type="number" step="0.01" min="0" placeholder="actual" data-spend-for="${t.id}" /><button class="secondary" data-spend-save="${t.id}" type="button">Save</button></div>
    </article>`).join('') : '<p>Every placement that has run has a spend figure recorded.</p>';

  document.querySelectorAll('[data-spend-save]').forEach((button) => {
    button.onclick = guard(async () => {
      const id = button.dataset.spendSave;
      const input = document.querySelector(`[data-spend-for="${id}"]`);
      const value = Number(input.value);
      if (!input.value || Number.isNaN(value) || value < 0) return toast('Enter the amount that was actually spent.');
      button.disabled = true;
      const task = state.tasks.find((t) => t.id === id);
      if (db) await db.setFinancials(id, { actualSpend: value });
      task.actualSpend = value;
      if (!db) persistDemo();
      render(); toast(`Recorded ${money(value)} against ${task.title}.`);
    });
  });
}

function renderSettings() {
  const pending = state.members.filter((m) => m.accessLevel === 'pending');
  const team = state.members.filter((m) => m.accessLevel !== 'pending');
  const unlinked = team.filter((m) => !m.userId);

  // Approving means moving the auth account onto the person's real record, so
  // their seeded roles and title are already waiting. pm_link_member does it in
  // one statement; the alternative is approving someone into a duplicate row.
  const requests = pending.length ? pending.map((m) => `<div class="admin-row">
      <b>${escape(m.name)}</b><small>registered, not linked</small>
      <select data-link-target="${m.id}">
        <option value="">Link to…</option>
        ${unlinked.map((t) => `<option value="${t.id}">${escape(t.name)} — ${escape(t.title || t.accessLevel)}</option>`).join('')}
        <option value="__new">Approve as a new team member</option>
      </select>
      <button class="primary" data-link-confirm="${m.id}" type="button">Approve</button>
      <button class="secondary" data-decline="${m.id}" type="button">Decline</button>
    </div>`).join('') : '<p>Nobody is waiting for approval.</p>';

  const roster = team.map((m) => {
    const isSelf = m.id === state.member?.id;
    const levels = ['owner', 'admin', 'member', 'disabled'];
    return `<div class="admin-row">
      <b>${escape(m.name)}</b><small>${escape(m.email || 'no address')}${m.userId ? '' : ' · no account yet'}</small>
      <select data-level="${m.id}" ${isSelf || (m.accessLevel === 'owner' && !can.isOwner) ? 'disabled' : ''}>
        ${levels.map((l) => `<option value="${l}" ${l === m.accessLevel ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <div class="role-chips">${ROLE_SLOTS.map((slot) => `<span class="role-chip ${m.roles?.includes(slot) ? 'on' : ''}" data-role-member="${m.id}" data-role-slot="${escape(slot)}" role="button" tabindex="0">${escape(slot)}</span>`).join('')}</div>
    </div>`;
  }).join('');

  $('settingsPanel').innerHTML = `<section class="setting"><h3>Waiting for access</h3>${requests}</section>`
    + `<section class="setting"><h3>Team, access and roles</h3><p>Click a role to grant or remove it. Access level cannot be changed on your own account.</p>${roster}</section>`
    + `<section class="setting"><h3>Workflow stages</h3><ul>${WORKFLOW_TEMPLATE.map((s) => `<li>${s.order}. ${s.name} → ${s.role}</li>`).join('')}</ul></section>`
    + '<section class="setting"><h3>Notification channels</h3><p><b>In-app:</b> active<br><b>Email:</b> configure Resend secret + verified sender<br><b>Teams:</b> inactive until IT approves a scoped channel integration.</p></section>';

  bindAdminControls();
}

function bindAdminControls() {
  if (!db) return;
  const reload = async () => { state.members = await db.listMembers(); render(); };

  document.querySelectorAll('[data-link-confirm]').forEach((button) => {
    button.onclick = async () => {
      const pendingId = button.dataset.linkConfirm;
      const choice = document.querySelector(`[data-link-target="${pendingId}"]`)?.value;
      if (!choice) return toast('Choose who this person is first.');
      button.disabled = true;
      try {
        if (choice === '__new') await db.approveNewMember(pendingId, { email: state.members.find((m) => m.id === pendingId)?.name });
        else await db.linkMember(pendingId, choice);
        await reload(); toast('Access approved.');
      } catch (error) { toast(error.message); button.disabled = false; }
    };
  });

  document.querySelectorAll('[data-decline]').forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try { await db.removeRequest(button.dataset.decline); await reload(); toast('Request declined.'); }
      catch (error) { toast(error.message); button.disabled = false; }
    };
  });

  document.querySelectorAll('[data-level]').forEach((select) => {
    // reload() runs in the catch to put the control back to the stored value
    // after a refusal, and could itself reject; guard() is the backstop.
    select.onchange = guard(async () => {
      try { await db.setAccessLevel(select.dataset.level, select.value); await reload(); toast('Access level updated.'); }
      catch (error) { toast(error.message); await reload(); }
    });
  });

  document.querySelectorAll('[data-role-slot]').forEach((chip) => {
    chip.onclick = async () => {
      const { roleMember: memberId, roleSlot: slot } = chip.dataset;
      const held = chip.classList.contains('on');
      try {
        if (held) await db.revokeRole(memberId, slot); else await db.grantRole(memberId, slot);
        await reload();
      } catch (error) { toast(error.message); }
    };
  });
}

// --- task editing --------------------------------------------------------

function openTask(id) { activeTask = state.tasks.find((t) => t.id === id); if (activeTask) renderTaskDialog(false); }
function newTask() { activeTask = { title: '', type: 'To-do', campaignId: '', assigneeId: memberWithRole('Paid Media Owner') || '', dueDate: today(), status: 'Not started', market: '', platform: '' }; renderTaskDialog(true); }

function renderTaskDialog(isNew) {
  const mine = activeTask.assigneeId && activeTask.assigneeId === state.member?.id;
  const locked = !can.isManager;
  $('taskDialogType').textContent = isNew ? 'NEW TEAM TASK' : `${(activeTask.type || 'To-do').toUpperCase()}${activeTask.assignmentState === 'proposed' ? ' · PRE-ASSIGNED — SAVING CONFIRMS IT' : ''} · ${campaignName(activeTask.campaignId)}`;
  $('taskDialogTitle').textContent = isNew ? 'Create and delegate a task' : activeTask.title;
  $('taskDialogBody').innerHTML = `<div class="task-fields">
    <label>Task title<input id="editTitle" value="${escape(activeTask.title || '')}" placeholder="What needs to be done?" ${locked ? 'disabled' : ''} /></label>
    <label>Task type<select id="editType" ${locked ? 'disabled' : ''}>${['To-do', 'Post', 'Boost', 'Report'].map((type) => `<option ${type === activeTask.type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
    <label>Campaign<select id="editCampaign" ${locked ? 'disabled' : ''}>${campaignOptions(activeTask.campaignId)}</select></label>
    <label>Assign to<select id="editAssignee" ${locked ? 'disabled' : ''}>${memberOptions(activeTask.assigneeId)}</select></label>
    <label>Status<select id="editStatus" ${locked && !mine ? 'disabled' : ''}>${['Not started', 'In progress', 'Blocked', 'Done'].map((s) => `<option ${s === activeTask.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label>Due date<input id="editDue" type="date" value="${activeTask.dueDate}" ${locked ? 'disabled' : ''} /></label>
    <label>Live post / supporting link<input id="editLink" type="url" value="${escape(activeTask.liveLink || '')}" placeholder="https://" ${locked && !mine ? 'disabled' : ''} /></label>
    <label>Notes / results<textarea id="editResults" placeholder="Brief, context, results or next action…" ${locked && !mine ? 'disabled' : ''}>${escape(activeTask.notes || '')}</textarea></label>
  </div>${locked ? `<p class="quiet">${mine ? 'You can update status, links and notes on your own task. Reassigning and rescheduling is done by Shane, Elvis or Zaida.' : 'This task belongs to someone else, so it is read-only for you.'}</p>` : ''}`;
  $('taskDialog').showModal();
}

async function saveTask() {
  if (!activeTask) return false;
  const title = ($('editTitle').value || activeTask.title || '').trim();
  if (!title) { toast('Add a task title before saving.'); return false; }
  const patch = {
    title, status: $('editStatus').value, liveLink: $('editLink').value, notes: $('editResults').value,
    results: activeTask.results, activationKey: activeTask.activationKey
  };
  if (can.isManager) {
    patch.type = $('editType').value; patch.campaignId = $('editCampaign').value;
    patch.assigneeId = $('editAssignee').value; patch.dueDate = $('editDue').value;
    // A manager opening and saving a pre-assigned task IS the review — the
    // routing has been looked at by a person, so it stops being a proposal.
    if (activeTask.assignmentState === 'proposed') patch.assignmentState = 'confirmed';
  } else {
    patch.type = activeTask.type; patch.campaignId = activeTask.campaignId;
    patch.assigneeId = activeTask.assigneeId; patch.dueDate = activeTask.dueDate;
  }
  if (patch.type === 'Report') patch.reportState = patch.notes ? 'Captured manually' : 'Awaiting data';

  if (!db) {
    Object.assign(activeTask, patch);
    if (!state.tasks.includes(activeTask)) { activeTask.id = `demo-${crypto.randomUUID()}`; state.tasks.unshift(activeTask); }
    persistDemo(); render(); toast('Task saved.'); return true;
  }
  try {
    const saved = activeTask.id ? await db.updateTask(activeTask.id, patch) : await db.createTask(patch);
    if (state.member) db.logActivity(saved.id, state.member.id, activeTask.id ? 'updated' : 'created', { title: saved.title });
    const index = state.tasks.findIndex((t) => t.id === saved.id);
    if (index >= 0) state.tasks[index] = saved; else state.tasks.unshift(saved);
    render(); toast('Task saved.'); return true;
  } catch (error) { toast(error.message); return false; }
}

// --- spreadsheet import --------------------------------------------------

function previewWorkbook(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      if (!window.XLSX) throw new Error('The spreadsheet library did not load. Check your connection and reload.');
      const book = window.XLSX.read(event.target.result, { type: 'array', cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      // Not every plan starts with its headings; some open with a title row.
      const headerRow = findHeaderRow(window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }));
      if (headerRow < 0) throw new Error('Could not find the heading row. The sheet needs columns named DATE, ACTIVATION, PLATFORM and Country in one row.');
      const rows = normaliseRows(window.XLSX.utils.sheet_to_json(sheet, { range: headerRow, defval: '' }));
      if (!rows.length) throw new Error(`Found headings on row ${headerRow + 1}, but no row below them had a date, an activation and a platform.`);
      previewSource = { type: 'file' };
      $('fluxPlanSelect').value = '';
      renderImportPreview(rows);
    } catch (err) {
      $('importPreview').innerHTML = `<span class="error">Could not read spreadsheet: ${escape(err.message)}</span>`;
      $('confirmImport').disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

// One preview path for both doors: eligibility is checked against the chosen
// brand regardless of whether the rows came from a spreadsheet or a plan.
function renderImportPreview(rows) {
  const brand = $('importBrand').value;
  preview = rows.map((row) => ({ ...row, error: validateActivation({ ...row, brand }) }));
  const valid = preview.filter((r) => !r.error);
  $('importPreview').innerHTML = `<b>${valid.length} valid activation rows · ${preview.length - valid.length} rejected</b>${preview.slice(0, 20).map((r) => `<div class="${r.error ? 'error' : ''}">${escape(r.date)} · ${escape(r.activation)} · ${escape(r.platform)} · ${escape(r.market)}${r.error ? ` — ${escape(r.error)}` : ''}</div>`).join('')}`;
  $('confirmImport').disabled = !valid.length;
}

// Published plans arrive when the dialog opens; failure to load them must not
// block the spreadsheet path, so it degrades to a note instead of an error.
async function loadFluxPlans() {
  if (!db) { $('fluxPlanRow').classList.add('hidden'); return; }
  $('fluxPlanRow').classList.remove('hidden');
  try {
    fluxPlans = await db.listPublishedPlans();
    const options = fluxPlans.map((plan) => `<option value="${plan.id}">${escape(plan.name)} — ${escape(plan.country)} · $${(plan.totalBudget || 0).toLocaleString('en-ZA')} · ${plan.rows.length} rows</option>`).join('');
    $('fluxPlanSelect').innerHTML = `<option value="">${fluxPlans.length ? 'Choose a published plan…' : 'No plans published from FluxPlanner yet'}</option>${options}`;
  } catch (error) {
    console.error(error);
    $('fluxPlanSelect').innerHTML = '<option value="">Could not load published plans</option>';
  }
}

function selectFluxPlan() {
  const plan = fluxPlans.find((p) => p.id === $('fluxPlanSelect').value);
  $('fluxUnpublish').classList.toggle('hidden', !plan || !can.isManager);
  if (!plan) { previewSource = null; preview = []; $('importPreview').innerHTML = ''; $('confirmImport').disabled = true; return; }
  previewSource = { type: 'flux', plan };
  $('fileInput').value = '';
  // The plan knows its brand — declared at publish, or readable from the name
  // for plans published before that existed. Pre-select it; still overridable.
  const brand = detectBrand(plan.name, plan.brand);
  if (brand) $('importBrand').value = brand;
  if (!plan.rows.length) return importError('That plan has no usable rows — it may predate the row format GSD understands.');
  importError(brand ? '' : 'Could not tell which brand this plan is for — choose it above.');
  renderImportPreview(plan.rows);
}

async function importRows() {
  const brand = $('importBrand').value;
  if (!brand) return importError('Choose a brand before importing — eligibility is checked against it.');
  const valid = preview.filter((r) => !validateActivation({ ...r, brand }));
  if (!valid.length) return importError('No rows passed validation, so there is nothing to import.');
  if (db && !can.isManager) return importError('Only Shane, Elvis or Zaida can import a plan.');
  const markets = [...new Set(valid.map((r) => r.market))];
  const fromFlux = previewSource?.type === 'flux' ? previewSource.plan : null;
  const details = {
    brand,
    name: fromFlux ? fromFlux.name : `${brand} · ${valid[0].activation} plan`,
    market: markets.length === 1 ? markets[0] : 'Multiple markets',
    fluxPlanId: fromFlux?.id || null
  };
  const owner = memberWithRole('Paid Media Owner');

  if (!db) {
    const campaignId = `demo-${crypto.randomUUID()}`;
    state.campaigns.unshift({ id: campaignId, ...details, division: BRAND_CATALOG[brand]?.division, source: 'spreadsheet' });
    const content = groupContentTasks(valid, campaignId).map((task, index) => ({ ...task, id: `demo-content-${index}`, assigneeId: memberWithRole(task.roleSlot), assignmentState: 'proposed' }));
    const work = valid.flatMap((row) => createActivationTasks(row, campaignId, owner).map((t) => ({ ...t, assignmentState: 'proposed' })));
    state.tasks.unshift(...content, ...work);
    persistDemo(); render(); $('importDialog').close();
    return toast(`Imported ${valid.length} activations: ${content.length} assets and ${work.length} operational tasks.`);
  }
  if (!owner) return importError('No one holds the Paid Media Owner role, so imported tasks would have no owner. Assign it in Workspace settings first.');

  $('confirmImport').disabled = true;
  importError('');
  try {
    const { campaign, tasks } = await db.importCampaign(details, valid, { paidMediaOwnerId: owner, resolveRole: memberWithRole });
    state.campaigns.unshift(campaign); state.tasks.unshift(...tasks);
    render(); $('importDialog').close();
    const proposed = tasks.filter((t) => t.assignmentState === 'proposed').length;
    toast(`Imported ${valid.length} activations into ${tasks.length} tasks. ${proposed} are pre-assigned and waiting for you to confirm.`);
  } catch (error) {
    // Kept in the dialog rather than a toast: an import failure is something to
    // read and act on, not a message that disappears after three seconds.
    console.error('Import failed:', error);
    importError(error.message);
  } finally { $('confirmImport').disabled = false; }
}

function importError(message) {
  const el = $('importPreview');
  const existing = el.querySelector('.import-error');
  if (existing) existing.remove();
  if (!message) return;
  const box = document.createElement('div');
  box.className = 'import-error';
  box.textContent = message;
  el.prepend(box);
}

function loadDemo() {
  const rows = [
    { date: today(), activation: 'Teaser', assetType: 'Video', platform: 'TikTok', market: 'Nigeria', durationDays: 7, objective: 'Video Views', budget: 120 },
    { date: today(), activation: 'Teaser', assetType: 'Video', platform: 'Instagram', market: 'Nigeria', durationDays: 5, objective: 'Engagement', budget: 75 },
    { date: today(), activation: 'Teaser', assetType: 'Video', platform: 'Facebook', market: 'Nigeria', durationDays: 5, objective: 'Reach', budget: 90 }
  ];
  const id = `demo-${crypto.randomUUID()}`;
  state.campaigns.unshift({ id, name: 'Shal’Artem Bounce Back Competition', brand: "Shal'Artem", division: 'OTX', market: 'Nigeria', source: 'spreadsheet' });
  state.tasks.unshift(...rows.flatMap((r) => createActivationTasks(r, id, 'elvis')));
  persistDemo(); render(); toast('Shal’Artem example loaded.');
}

// --- wiring --------------------------------------------------------------

// An async click handler returns a promise nobody awaits. If it rejects, the
// browser reports an unhandled rejection to the console and the interface shows
// nothing at all — the button simply appears dead. Every async handler goes
// through this so a failure always reaches the person who clicked.
function guard(handler, onError) {
  return (event) => {
    try {
      const result = handler(event);
      if (result?.catch) result.catch((error) => { console.error(error); (onError || toast)(error.message); });
    } catch (error) { console.error(error); (onError || toast)(error.message); }
  };
}

function bindEvents() {
  const titles = { overview: 'Today’s operations', tasks: 'Task command centre', posts: 'Post pipeline', campaigns: 'Campaigns', spend: 'Paid media spend', reports: 'Reporting queue', settings: 'Workspace settings' };
  document.querySelectorAll('.nav').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.nav').forEach((n) => n.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
      $(`${b.dataset.view}View`).classList.remove('hidden');
      $('pageTitle').textContent = titles[b.dataset.view];
    };
  });
  $('importBrand').innerHTML = brandOptions();
  $('authForm').onsubmit = guard(submitGate, authError);
  $('authSecondary').onclick = () => showGate(GATES[authMode].secondaryTarget || 'signin');
  $('authForgot').onclick = () => showGate('forgot');
  $('signOut').onclick = guard(signOut);
  $('uploadButton').onclick = guard(() => { $('importDialog').showModal(); return loadFluxPlans(); });
  $('addTaskButton').onclick = newTask;
  $('fileInput').onchange = (e) => e.target.files[0] && previewWorkbook(e.target.files[0]);
  $('fluxPlanSelect').onchange = guard(selectFluxPlan);
  $('fluxUnpublish').onclick = guard(async () => {
    const plan = previewSource?.type === 'flux' ? previewSource.plan : null;
    if (!plan || !db) return;
    $('fluxUnpublish').disabled = true;
    try {
      await db.unpublishPlan(plan.id);
      toast(`"${plan.name}" removed — its author can republish it from FluxPlanner.`);
      previewSource = null; preview = [];
      $('importPreview').innerHTML = ''; $('confirmImport').disabled = true;
      await loadFluxPlans();
    } finally { $('fluxUnpublish').disabled = false; }
  }, importError);
  $('importBrand').onchange = () => {
    if (previewSource?.type === 'flux') return selectFluxPlan();
    const file = $('fileInput').files[0]; if (file) previewWorkbook(file);
  };
  $('confirmImport').onclick = guard((event) => { event.preventDefault(); return importRows(); }, importError);
  $('seedDemo').onclick = guard(loadDemo);
  $('saveTask').onclick = guard(async (event) => { event.preventDefault(); if (await saveTask()) $('taskDialog').close(); });
  $('notifications').onclick = (event) => { event.stopPropagation(); $('notifPanel').classList.toggle('hidden'); };
  document.addEventListener('click', (event) => {
    if (!$('notifPanel').classList.contains('hidden') && !event.target.closest('.notif-wrap')) $('notifPanel').classList.add('hidden');
  });
  $('viewAllTasks').onclick = () => document.querySelector('[data-view="tasks"]').click();
  ['taskSearch', 'brandFilter', 'marketFilter', 'platformFilter', 'assigneeFilter', 'typeFilter', 'statusFilter']
    .forEach((id) => $(id).addEventListener(id === 'taskSearch' ? 'input' : 'change', renderTasks));
  $('spendGroup').addEventListener('change', renderSpend);
  $('postsCampaignFilter').addEventListener('change', renderPosts);
  $('postsAttention').addEventListener('change', renderPosts);
}

// A rejection here would otherwise leave the page blank with nothing but a
// console entry to explain it.
boot().catch((error) => {
  console.error('Startup failed:', error);
  if (configured) showGate('signin', `Could not start: ${error.message}`);
  else toast(`Could not start: ${error.message}`);
});
