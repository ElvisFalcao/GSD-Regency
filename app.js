import { BRAND_CATALOG, PLATFORM_IDS, WORKFLOW_TEMPLATE, normaliseRows, validateActivation, createActivationTasks, taskFlags } from './lib/automation.js';
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

let state = { members: [], campaigns: [], tasks: [], member: null };
let can = capabilities(null);
let preview = [];
let activeTask = null;
let authMode = 'signin';

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
  client.auth.onAuthStateChange(() => refresh());
  await refresh();
}

async function refresh() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return showGate('signin');

  let member = null;
  try { member = await db.currentMember(); } catch (error) { return showGate('signin', error.message); }

  // Signed in but not part of the workspace yet. The row is theirs to create;
  // the insert policy pins it to 'pending' so it cannot arrive with access.
  if (!member) return showGate('request');
  can = capabilities(member);
  if (!can.isActive) return showGate('pending');

  hideGate();
  try {
    const [members, campaigns, tasks] = await Promise.all([db.listMembers(), db.listCampaigns(), db.listTasks()]);
    state = { members, campaigns, tasks, member };
  } catch (error) { toast(error.message); return; }
  render();
}

const GATES = {
  signin: { title: 'Sign in', intro: 'Use your Regency email address.', submit: 'Sign in', secondary: 'Create an account', fields: true },
  signup: { title: 'Create an account', intro: 'Register with your Regency email. A manager links you to the workspace before anything unlocks.', submit: 'Create account', secondary: 'I already have an account', fields: true },
  request: { title: 'Request access', intro: 'Your account exists but is not linked to the Shalina workspace yet.', submit: 'Request access', secondary: 'Sign out', fields: false },
  pending: { title: 'Waiting for approval', intro: 'Shane, Elvis or Zaida will assign your roles. Your work appears here once they do.', submit: '', secondary: 'Sign out', fields: false }
};

function showGate(mode, message = '') {
  authMode = mode;
  const gate = GATES[mode];
  $('authTitle').textContent = gate.title;
  $('authIntro').textContent = gate.intro;
  $('authFields').classList.toggle('hidden', !gate.fields);
  $('authSubmit').textContent = gate.submit;
  $('authSubmit').classList.toggle('hidden', !gate.submit);
  $('authSecondary').textContent = gate.secondary;
  $('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
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
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else if (authMode === 'signup') {
      const { error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      // A session may not exist yet if the project requires email confirmation.
      return showGate('signin', 'Account created. Confirm your email if prompted, then sign in.');
    } else if (authMode === 'request') {
      await db.requestAccess();
      return showGate('pending');
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
  renderOverview(); renderTasks(); renderCampaigns(); renderReports(); renderSettings();
  $('notificationCount').textContent = state.tasks.filter((t) => { const f = taskStatus(t); return f.overdue || f.boostToday || f.reportDue; }).length;
}

// Hiding a control is a courtesy, not a control. Every rule below is enforced
// again by row-level security, which is what actually refuses the request.
function applyCapabilities() {
  $('whoami').classList.toggle('hidden', !state.member);
  if (state.member) {
    $('whoamiName').textContent = state.member.name;
    $('whoamiRole').textContent = [state.member.title, (state.member.roles || []).join(' · ')].filter(Boolean).join(' — ');
  }
  $('signOut').classList.toggle('hidden', !configured);
  $('addTaskButton').classList.toggle('hidden', !can.isManager);
  $('uploadButton').classList.toggle('hidden', !can.isManager);
  $('seedDemo').classList.toggle('hidden', configured);
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
  return `<article class="task-card" data-task-id="${t.id}"><div class="task-mark ${t.type}"></div><div><h3>${escape(t.title)}</h3><p>${escape(context)} · <span class="badge ${t.type}">${t.type || 'To-do'}</span> · ${escape(memberName(t.assigneeId))}</p></div><div class="due ${f.overdue ? 'overdue' : ''}">${f.overdue ? 'Overdue · ' : ''}${escape(t.dueDate)}<br><span class="badge">${escape(t.status)}</span></div></article>`;
}

function bindTaskCards() { document.querySelectorAll('[data-task-id]').forEach((el) => { el.onclick = () => openTask(el.dataset.taskId); }); }

function renderTasks() {
  const fill = (id, values) => { const el = $(id); const chosen = el.value; el.innerHTML = `<option value="">${el.options[0]?.text || 'All'}</option>${[...new Set(values)].filter(Boolean).sort().map((v) => `<option ${v === chosen ? 'selected' : ''}>${escape(v)}</option>`).join('')}`; };
  fill('brandFilter', state.campaigns.map((c) => c.brand)); fill('marketFilter', state.tasks.map((t) => t.market));
  fill('platformFilter', PLATFORM_IDS); fill('assigneeFilter', state.members.map((m) => m.name));
  const query = $('taskSearch').value.toLowerCase();
  const filters = { brand: $('brandFilter').value, market: $('marketFilter').value, platform: $('platformFilter').value, assignee: $('assigneeFilter').value, type: $('typeFilter').value, status: $('statusFilter').value };
  const tasks = state.tasks.filter((t) => (!query || t.title.toLowerCase().includes(query))
    && (!filters.brand || state.campaigns.find((c) => c.id === t.campaignId)?.brand === filters.brand)
    && (!filters.market || t.market === filters.market) && (!filters.platform || t.platform === filters.platform)
    && (!filters.assignee || memberName(t.assigneeId) === filters.assignee)
    && (!filters.type || t.type === filters.type) && (!filters.status || t.status === filters.status));
  $('taskTable').innerHTML = `<table><thead><tr><th>Task</th><th>Campaign / Brand</th><th>Assigned to</th><th>Due</th><th>Status</th></tr></thead><tbody>${tasks.map((t) => `<tr data-task-id="${t.id}"><td><b>${escape(t.title)}</b><br><span class="badge ${t.type}">${t.type || 'To-do'}</span></td><td>${escape(campaignName(t.campaignId))}</td><td>${escape(memberName(t.assigneeId))}</td><td class="${taskStatus(t).overdue ? 'due overdue' : ''}">${escape(t.dueDate)}</td><td>${escape(t.status)}</td></tr>`).join('') || '<tr><td colspan="5">No tasks match these filters.</td></tr>'}</tbody></table>`;
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

function renderSettings() {
  const pending = state.members.filter((m) => m.accessLevel === 'pending');
  const waiting = pending.length
    ? `<ul>${pending.map((m) => `<li>${escape(m.name)}${m.email ? ` — ${escape(m.email)}` : ''}</li>`).join('')}</ul><p>A pending person is listed by the address they registered with. Link them to their member row and grant roles in Supabase; the admin screen for this comes with step 4.</p>`
    : '<p>Nobody is waiting for approval.</p>';
  $('settingsPanel').innerHTML = `<section class="setting"><h3>Waiting for access</h3>${waiting}</section>`
    + `<section class="setting"><h3>Team and roles</h3><ul>${state.members.map((m) => `<li>${escape(m.name)} — ${escape(m.accessLevel)}${m.roles?.length ? ` · ${escape(m.roles.join(', '))}` : ''}</li>`).join('')}</ul></section>`
    + `<section class="setting"><h3>Role templates</h3><ul>${WORKFLOW_TEMPLATE.map((s) => `<li>${s.order}. ${s.name} → ${s.role}</li>`).join('')}</ul></section>`
    + '<section class="setting"><h3>Notification channels</h3><p><b>In-app:</b> active<br><b>Email:</b> configure Resend secret + verified sender<br><b>Teams:</b> inactive until IT approves a scoped channel integration.</p></section>';
}

// --- task editing --------------------------------------------------------

function openTask(id) { activeTask = state.tasks.find((t) => t.id === id); if (activeTask) renderTaskDialog(false); }
function newTask() { activeTask = { title: '', type: 'To-do', campaignId: '', assigneeId: memberWithRole('Paid Media Owner') || '', dueDate: today(), status: 'Not started', market: '', platform: '' }; renderTaskDialog(true); }

function renderTaskDialog(isNew) {
  const mine = activeTask.assigneeId && activeTask.assigneeId === state.member?.id;
  const locked = !can.isManager;
  $('taskDialogType').textContent = isNew ? 'NEW TEAM TASK' : `${(activeTask.type || 'To-do').toUpperCase()} · ${campaignName(activeTask.campaignId)}`;
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
      const rows = normaliseRows(window.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' }));
      const brand = $('importBrand').value;
      preview = rows.map((row) => ({ ...row, error: validateActivation({ ...row, brand }) }));
      const valid = preview.filter((r) => !r.error);
      $('importPreview').innerHTML = `<b>${valid.length} valid activation rows · ${preview.length - valid.length} rejected</b>${preview.slice(0, 20).map((r) => `<div class="${r.error ? 'error' : ''}">${escape(r.date)} · ${escape(r.activation)} · ${escape(r.platform)} · ${escape(r.market)}${r.error ? ` — ${escape(r.error)}` : ''}</div>`).join('')}`;
      $('confirmImport').disabled = !valid.length;
    } catch (err) {
      $('importPreview').innerHTML = `<span class="error">Could not read spreadsheet: ${escape(err.message)}</span>`;
      $('confirmImport').disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

async function importRows() {
  const brand = $('importBrand').value;
  const valid = preview.filter((r) => !validateActivation({ ...r, brand }));
  if (!brand || !valid.length) return;
  const markets = [...new Set(valid.map((r) => r.market))];
  const details = { brand, name: `${brand} · ${valid[0].activation} plan`, market: markets.length === 1 ? markets[0] : 'Multiple markets' };
  const owner = memberWithRole('Paid Media Owner');

  if (!db) {
    const campaignId = `demo-${crypto.randomUUID()}`;
    state.campaigns.unshift({ id: campaignId, ...details, division: BRAND_CATALOG[brand]?.division, source: 'spreadsheet' });
    state.tasks.unshift(...valid.flatMap((row) => createActivationTasks(row, campaignId, owner)));
    persistDemo(); render(); $('importDialog').close();
    return toast(`Imported ${valid.length} activations and generated ${valid.length * 3} tasks.`);
  }
  try {
    const { campaign, tasks } = await db.importCampaign(details, valid, owner);
    state.campaigns.unshift(campaign); state.tasks.unshift(...tasks);
    render(); $('importDialog').close();
    toast(`Imported ${valid.length} activations and generated ${tasks.length} tasks.`);
  } catch (error) { toast(error.message); }
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

function bindEvents() {
  const titles = { overview: 'Today’s operations', tasks: 'Task command centre', campaigns: 'Campaigns', reports: 'Reporting queue', settings: 'Workspace settings' };
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
  $('authForm').onsubmit = submitGate;
  $('authSecondary').onclick = () => {
    if (authMode === 'signin') return showGate('signup');
    if (authMode === 'signup') return showGate('signin');
    return signOut();
  };
  $('signOut').onclick = signOut;
  $('uploadButton').onclick = () => $('importDialog').showModal();
  $('addTaskButton').onclick = newTask;
  $('fileInput').onchange = (e) => e.target.files[0] && previewWorkbook(e.target.files[0]);
  $('importBrand').onchange = () => { const file = $('fileInput').files[0]; if (file) previewWorkbook(file); };
  $('confirmImport').onclick = (event) => { event.preventDefault(); importRows(); };
  $('seedDemo').onclick = loadDemo;
  $('saveTask').onclick = async (event) => { event.preventDefault(); if (await saveTask()) $('taskDialog').close(); };
  $('notifications').onclick = () => { document.querySelector('[data-view="overview"]').click(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('viewAllTasks').onclick = () => document.querySelector('[data-view="tasks"]').click();
  ['taskSearch', 'brandFilter', 'marketFilter', 'platformFilter', 'assigneeFilter', 'typeFilter', 'statusFilter']
    .forEach((id) => $(id).addEventListener(id === 'taskSearch' ? 'input' : 'change', renderTasks));
}

boot();
