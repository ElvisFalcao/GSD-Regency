import { BRAND_CATALOG, PLATFORM_IDS, WORKFLOW_TEMPLATE, normaliseRows, validateActivation, createActivationTasks, taskFlags } from './lib/automation.js';

const cfg = window.PM_CONFIG || {};
const db = cfg.supabaseUrl && cfg.supabaseAnonKey ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
const STORAGE_KEY = 'regency-pm-v1';
const TEAM_MEMBERS = [
  { id: 'paid-media-owner', name: 'Paid Media Owner', role: 'Paid Media Owner' },
  { id: 'shane', name: 'Shane', role: 'Strategic Director' },
  { id: 'elvis', name: 'Elvis FalcÃ£o', role: 'Content Lead' },
  { id: 'keisha', name: 'Keisha', role: 'Creative Lead' },
  { id: 't-man', name: 'T-Man', role: 'Creative Lead' },
  { id: 'leon', name: 'Leon', role: 'Video Producer & Editor' },
  { id: 'sian', name: 'Sian', role: 'Community Manager' },
  { id: 'ziada', name: 'Ziada', role: 'Process Coordinator' }
];
const defaultState = { campaigns: [], tasks: [], members: TEAM_MEMBERS, syncConflicts: [] };
let state = loadLocal();
let preview = [];
let activeTask = null;

function loadLocal() { try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); const members = [...TEAM_MEMBERS, ...(saved.members || [])].filter((member, index, all) => all.findIndex(other => other.id === member.id) === index); return { ...defaultState, ...saved, members }; } catch { return structuredClone(defaultState); } }
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function escape(value = '') { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function today() { return new Date().toLocaleDateString('en-CA', { timeZone: cfg.timezone || 'Africa/Johannesburg' }); }
function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3600); }
function uid(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function brandOptions(selected = '') { return `<option value="">Choose brand</option>${Object.keys(BRAND_CATALOG).map(b => `<option ${b === selected ? 'selected' : ''}>${b}</option>`).join('')}`; }
function memberName(id) { return state.members.find(member => member.id === id)?.name || 'Unassigned'; }
function memberOptions(selected = '') { return `<option value="">Unassigned</option>${state.members.map(member => `<option value="${member.id}" ${member.id === selected ? 'selected' : ''}>${escape(member.name)} â€” ${escape(member.role)}</option>`).join('')}`; }
function campaignOptions(selected = '') { return `<option value="">General / no campaign</option>${state.campaigns.map(campaign => `<option value="${campaign.id}" ${campaign.id === selected ? 'selected' : ''}>${escape(campaign.name)}</option>`).join('')}`; }
function taskStatus(task) { return taskFlags(task, today()); }

async function syncToSupabase() {
  if (!db) return;
  // The schema enforces RLS; a signed-in member can persist their workspace data.
  const { error } = await db.from('pm_workspace_snapshots').upsert({ workspace_id: cfg.workspaceId, data: state, updated_at: new Date().toISOString() });
  if (error) console.warn('Supabase sync pending:', error.message);
}
function save() { persist(); syncToSupabase(); render(); }

function render() {
  renderNav(); renderOverview(); renderTasks(); renderCampaigns(); renderReports(); renderSettings();
  document.getElementById('notificationCount').textContent = state.tasks.filter(t => { const f = taskStatus(t); return f.overdue || f.boostToday || f.reportDue; }).length;
}
function renderNav() {
  const titles = { overview: 'Todayâ€™s operations', tasks: 'Task command centre', campaigns: 'Campaigns', reports: 'Reporting queue', settings: 'Workspace settings' };
  document.querySelectorAll('.nav').forEach(b => b.onclick = () => { document.querySelectorAll('.nav').forEach(n => n.classList.remove('active')); b.classList.add('active'); document.querySelectorAll('.view').forEach(v => v.classList.add('hidden')); document.getElementById(`${b.dataset.view}View`).classList.remove('hidden'); document.getElementById('pageTitle').textContent = titles[b.dataset.view]; });
}
function renderOverview() {
  const flags = state.tasks.map(taskStatus);
  const cards = [['Due today', state.tasks.filter(t => t.dueDate === today() && t.status !== 'Done').length, 'tasks need action'], ['Overdue', flags.filter(f => f.overdue).length, 'tasks past deadline'], ['Boosts today', flags.filter(f => f.boostToday).length, 'planned paid activations'], ['Reports due', flags.filter(f => f.reportDue).length, 'results awaiting capture']];
  document.getElementById('statCards').innerHTML = cards.map(([label, value, caption]) => `<article class="stat"><p class="eyebrow">${label}</p><div class="number">${value}</div><div class="caption">${caption}</div></article>`).join('');
  const priority = state.tasks.filter(t => { const f = taskStatus(t); return f.overdue || f.boostToday || f.reportDue || t.dueDate === today(); }).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  document.getElementById('priorityTasks').innerHTML = priority.length ? priority.map(taskCard).join('') : `<div class="task-card"><div class="task-mark"></div><div><h3>Youâ€™re clear</h3><p>Import a budget plan or load the sample campaign to see operations here.</p></div></div>`;
  const board = state.members.map(member => {
    const tasks = state.tasks.filter(task => task.assigneeId === member.id && !['Done', 'Cancelled'].includes(task.status));
    const assigned = tasks.slice(0, 3).map(task => `<li>${escape(task.title)} <small>${escape(task.dueDate)}</small></li>`).join('') || '<li class="quiet">No active tasks</li>';
    return `<article class="team-card"><div class="team-avatar">${escape(member.name.charAt(0))}</div><div><h3>${escape(member.name)}</h3><p>${escape(member.role)}</p></div><b>${tasks.length}</b><ul>${assigned}</ul></article>`;
  }).join('');
  document.getElementById('teamBoard').innerHTML = board;
  bindTaskCards();
}
function taskCard(t) { const f = taskStatus(t); const dueClass = f.overdue ? 'overdue' : ''; const context = [t.campaignName || (t.campaignId ? campaignName(t.campaignId) : ''), t.market, t.platform].filter(Boolean).join(' Â· ') || 'General task'; return `<article class="task-card" data-task-id="${t.id}"><div class="task-mark ${t.type}"></div><div><h3>${escape(t.title)}</h3><p>${escape(context)} Â· <span class="badge ${t.type}">${t.type || 'To-do'}</span> Â· ${escape(memberName(t.assigneeId))}</p></div><div class="due ${dueClass}">${f.overdue ? 'Overdue Â· ' : ''}${escape(t.dueDate)}<br><span class="badge">${escape(t.status)}</span></div></article>`; }
function campaignName(id) { return state.campaigns.find(c => c.id === id)?.name || ''; }
function bindTaskCards() { document.querySelectorAll('[data-task-id]').forEach(el => el.onclick = () => openTask(el.dataset.taskId)); }

function renderTasks() {
  const fill = (id, values) => { const el = document.getElementById(id); const chosen = el.value; el.innerHTML = `<option value="">${el.options[0]?.text || 'All'}</option>${[...values].sort().map(v => `<option ${v === chosen ? 'selected' : ''}>${escape(v)}</option>`).join('')}`; };
  fill('brandFilter', state.campaigns.map(c => c.brand)); fill('marketFilter', state.tasks.map(t => t.market)); fill('platformFilter', PLATFORM_IDS); fill('assigneeFilter', state.members.map(member => member.name));
  const query = document.getElementById('taskSearch').value.toLowerCase(); const filters = { brand: document.getElementById('brandFilter').value, market: document.getElementById('marketFilter').value, platform: document.getElementById('platformFilter').value, assignee: document.getElementById('assigneeFilter').value, type: document.getElementById('typeFilter').value, status: document.getElementById('statusFilter').value };
  const tasks = state.tasks.filter(t => (!query || t.title.toLowerCase().includes(query)) && (!filters.brand || state.campaigns.find(c => c.id === t.campaignId)?.brand === filters.brand) && (!filters.market || t.market === filters.market) && (!filters.platform || t.platform === filters.platform) && (!filters.assignee || memberName(t.assigneeId) === filters.assignee) && (!filters.type || t.type === filters.type) && (!filters.status || t.status === filters.status));
  document.getElementById('taskTable').innerHTML = `<table><thead><tr><th>Task</th><th>Campaign / Brand</th><th>Assigned to</th><th>Due</th><th>Status</th></tr></thead><tbody>${tasks.map(t => `<tr data-task-id="${t.id}"><td><b>${escape(t.title)}</b><br><span class="badge ${t.type}">${t.type || 'To-do'}</span></td><td>${escape(campaignName(t.campaignId))}</td><td>${escape(memberName(t.assigneeId))}</td><td class="${taskStatus(t).overdue ? 'due overdue' : ''}">${escape(t.dueDate)}</td><td>${escape(t.status)}</td></tr>`).join('') || `<tr><td colspan="5">No tasks match these filters.</td></tr>`}</tbody></table>`;
  bindTaskCards(); document.querySelectorAll('#taskTable tr[data-task-id]').forEach(el => el.onclick = () => openTask(el.dataset.taskId));
}
function renderCampaigns() { document.getElementById('campaignList').innerHTML = state.campaigns.map(c => { const tasks = state.tasks.filter(t => t.campaignId === c.id); return `<article class="campaign"><p class="eyebrow">${escape(BRAND_CATALOG[c.brand]?.division || '')} Â· ${escape(c.market)}</p><h3>${escape(c.name)}</h3><p>${escape(c.brand)} Â· ${tasks.length} generated operational tasks</p><div class="meta"><span>FluxPlanner: ${c.fluxPlanId ? 'linked' : 'spreadsheet import'}</span><span>${tasks.filter(t => t.status === 'Done').length}/${tasks.length} done</span></div></article>`; }).join('') || '<p>No campaigns have been imported yet.</p>'; }
function renderReports() { const reports = state.tasks.filter(t => t.type === 'Report').sort((a,b) => a.dueDate.localeCompare(b.dueDate)); document.getElementById('reportList').innerHTML = reports.map(t => { const f = taskStatus(t); return `<article class="task-card" data-task-id="${t.id}"><div class="task-mark Report"></div><div><h3>${escape(t.title)}</h3><p>${escape(t.objective || 'Objective not set')} Â· Budget ${t.budget || 0} Â· ${t.reportState || 'Awaiting data'}</p></div><div class="due ${f.reportDue ? 'overdue' : ''}">${f.reportDue ? 'Due Â· ' : ''}${t.dueDate}</div></article>`; }).join('') || '<p>No reporting tasks yet.</p>'; bindTaskCards(); }
function renderSettings() { document.getElementById('settingsPanel').innerHTML = `<section class="setting"><h3>Role templates</h3><p>Workflow tasks are assigned by role so the workspace admin can map people without changing the process.</p><ul>${WORKFLOW_TEMPLATE.map(s => `<li>${s.order}. ${s.name} â†’ ${s.role}</li>`).join('')}</ul></section><section class="setting"><h3>Notification channels</h3><p><b>In-app:</b> active<br><b>Email:</b> configure Resend secret + verified sender<br><b>Teams:</b> inactive until IT approves and configures a scoped channel integration.</p></section><section class="setting"><h3>Supermetrics reporting</h3><p>Configure API key and saved-query mappings as Supabase Edge Function secrets. Failed requests leave report tasks available for manual entry.</p></section><section class="setting"><h3>FluxPlanner sync</h3><p>Supabase-only plans. Structural campaign changes originate in FluxPlanner; task state and links stay here. Date collisions are recorded for review.</p></section>`; }

function openTask(id) { activeTask = state.tasks.find(t => t.id === id); if (!activeTask) return; renderTaskDialog(false); }
function newTask() { activeTask = { id: uid('task'), title: '', type: 'To-do', campaignId: '', assigneeId: 'paid-media-owner', dueDate: today(), status: 'Not started', market: '', platform: '', source: 'manual' }; renderTaskDialog(true); }
function renderTaskDialog(isNew) { document.getElementById('taskDialogType').textContent = isNew ? 'NEW TEAM TASK' : `${(activeTask.type || 'To-do').toUpperCase()} Â· ${campaignName(activeTask.campaignId)}`; document.getElementById('taskDialogTitle').textContent = isNew ? 'Create and delegate a task' : activeTask.title; document.getElementById('taskDialogBody').innerHTML = `<div class="task-fields"><label>Task title<input id="editTitle" value="${escape(activeTask.title || '')}" placeholder="What needs to be done?" /></label><label>Task type<select id="editType">${['To-do','Post','Boost','Report'].map(type => `<option ${type === activeTask.type ? 'selected' : ''}>${type}</option>`).join('')}</select></label><label>Campaign<select id="editCampaign">${campaignOptions(activeTask.campaignId)}</select></label><label>Assign to<select id="editAssignee">${memberOptions(activeTask.assigneeId)}</select></label><label>Status<select id="editStatus">${['Not started','In progress','Blocked','Done'].map(s => `<option ${s === activeTask.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Due date<input id="editDue" type="date" value="${activeTask.dueDate}" /></label><label>Live post / supporting link<input id="editLink" type="url" value="${escape(activeTask.liveLink || '')}" placeholder="https://" /></label><label>Notes / results<textarea id="editResults" placeholder="Brief, context, results or next actionâ€¦">${escape(activeTask.results || '')}</textarea></label></div>`; document.getElementById('taskDialog').showModal(); }
function saveTask() { if (!activeTask) return; const title = document.getElementById('editTitle').value.trim(); if (!title) { toast('Add a task title before saving.'); return; } const oldDate = activeTask.dueDate; activeTask.title = title; activeTask.type = document.getElementById('editType').value; activeTask.campaignId = document.getElementById('editCampaign').value; activeTask.assigneeId = document.getElementById('editAssignee').value; activeTask.status = document.getElementById('editStatus').value; activeTask.dueDate = document.getElementById('editDue').value; activeTask.liveLink = document.getElementById('editLink').value; activeTask.results = document.getElementById('editResults').value; if (activeTask.type === 'Report') activeTask.reportState = activeTask.results ? 'Captured manually' : 'Awaiting data'; if (!state.tasks.some(task => task.id === activeTask.id)) state.tasks.unshift(activeTask); if (oldDate !== activeTask.dueDate && activeTask.activationKey) state.syncConflicts.push({ taskId: activeTask.id, type: 'pending_fluxplanner_date_sync', previous: oldDate, requested: activeTask.dueDate, at: new Date().toISOString() }); save(); toast(activeTask.source === 'manual' ? 'Task created and delegated.' : 'Task saved.'); }

function previewWorkbook(file) { const reader = new FileReader(); reader.onload = (event) => { try { if (!window.XLSX) throw new Error('The spreadsheet library did not load. Check your internet connection and reload the page.'); const book = window.XLSX.read(event.target.result, { type: 'array', cellDates: true }); const first = book.Sheets[book.SheetNames[0]]; const rows = normaliseRows(window.XLSX.utils.sheet_to_json(first, { defval: '' })); const brand = document.getElementById('importBrand').value; preview = rows.map(row => ({ ...row, error: validateActivation({ ...row, brand }) })); const valid = preview.filter(r => !r.error); document.getElementById('importPreview').innerHTML = `<b>${valid.length} valid activation rows Â· ${preview.length - valid.length} rejected</b>${preview.slice(0, 20).map(r => `<div class="${r.error ? 'error' : ''}">${escape(r.date)} Â· ${escape(r.activation)} Â· ${escape(r.platform)} Â· ${escape(r.market)}${r.error ? ` â€” ${escape(r.error)}` : ''}</div>`).join('')}`; document.getElementById('confirmImport').disabled = !valid.length; } catch (err) { document.getElementById('importPreview').innerHTML = `<span class="error">Could not read spreadsheet: ${escape(err.message)}</span>`; document.getElementById('confirmImport').disabled = true; } }; reader.readAsArrayBuffer(file); }
function importRows() { const brand = document.getElementById('importBrand').value; const valid = preview.filter(r => !validateActivation({ ...r, brand })); if (!brand || !valid.length) return; const campaignId = uid('campaign'); const markets = [...new Set(valid.map(r => r.market))]; const campaign = { id: campaignId, name: `${brand} Â· ${valid[0].activation} plan`, brand, market: markets.length === 1 ? markets[0] : 'Multiple markets', source: 'spreadsheet', importedAt: new Date().toISOString() }; state.campaigns.unshift(campaign); state.tasks.unshift(...valid.flatMap(row => createActivationTasks(row, campaignId, 'paid-media-owner').map(t => ({ ...t, campaignName: campaign.name })))); save(); document.getElementById('importDialog').close(); toast(`Imported ${valid.length} activations and generated ${valid.length * 3} tasks.`); }
function loadDemo() { const rows = [{ date: '2026-07-24', activation: 'Teaser', assetType: 'Video', platform: 'TikTok', market: 'Nigeria', durationDays: 7, objective: 'Video Views', budget: 120 }, { date: '2026-07-24', activation: 'Teaser', assetType: 'Video', platform: 'Instagram', market: 'Nigeria', durationDays: 5, objective: 'Engagement', budget: 75 }, { date: '2026-07-24', activation: 'Teaser', assetType: 'Video', platform: 'Facebook', market: 'Nigeria', durationDays: 5, objective: 'Reach', budget: 90 }]; const id = uid('campaign'); const campaign = { id, name: "Shalâ€™Artem Bounce Back Competition", brand: "Shal'Artem", market: 'Nigeria', source: 'demo' }; state.campaigns.unshift(campaign); state.tasks.unshift(...rows.flatMap(r => createActivationTasks(r, id, 'paid-media-owner').map(t => ({ ...t, campaignName: campaign.name })))); save(); toast('Shalâ€™Artem example loaded.'); }

document.getElementById('importBrand').innerHTML = brandOptions();
document.getElementById('uploadButton').onclick = () => document.getElementById('importDialog').showModal();
document.getElementById('addTaskButton').onclick = newTask;
document.getElementById('fileInput').onchange = e => e.target.files[0] && previewWorkbook(e.target.files[0]);
document.getElementById('importBrand').onchange = () => { const file = document.getElementById('fileInput').files[0]; if (file) previewWorkbook(file); };
document.getElementById('confirmImport').onclick = event => { event.preventDefault(); importRows(); };
document.getElementById('seedDemo').onclick = loadDemo;
document.getElementById('saveTask').onclick = event => { event.preventDefault(); saveTask(); if (activeTask?.title) document.getElementById('taskDialog').close(); };
document.getElementById('notifications').onclick = () => { document.querySelector('[data-view="overview"]').click(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
['taskSearch','brandFilter','marketFilter','platformFilter','assigneeFilter','typeFilter','statusFilter'].forEach(id => document.getElementById(id).addEventListener(id === 'taskSearch' ? 'input' : 'change', renderTasks));
document.getElementById('viewAllTasks').onclick = () => document.querySelector('[data-view="tasks"]').click();
render();

