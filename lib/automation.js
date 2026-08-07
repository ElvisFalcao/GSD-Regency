export const TIMEZONE = 'Africa/Johannesburg';

export const BRAND_CATALOG = {
  Germol: { division: 'Consumer', markets: ['Angola', 'South Africa'], custodian: 'Misbah Shaikh', campaignLead: 'Mamta Taliwala' },
  Flodent: { division: 'Consumer', markets: ['Angola', 'South Africa'], custodian: 'Misbah Shaikh', campaignLead: 'Mamta Taliwala' },
  Aco: { division: 'Consumer', markets: ['Angola'], custodian: 'Misbah Shaikh', campaignLead: 'Mamta Taliwala' },
  Shaltoux: { division: 'OTX', markets: ['Nigeria', 'Ghana', 'Zambia', 'Angola'], custodian: 'Monisha Bhasin', campaignLead: 'Mamta Taliwala' },
  "Shal'Artem": { division: 'OTX', markets: ['Nigeria', 'Ghana'], custodian: 'Anuj Gairola', campaignLead: 'Kartik Sons' },
  Ibucap: { division: 'OTX', markets: ['Nigeria'], custodian: 'Anuj Gairola', campaignLead: 'Kartik Sons' }
};

export const PLATFORM_IDS = ['Facebook', 'Instagram', 'TikTok', 'YouTube'];
export const WORKFLOW_TEMPLATE = [
  ['Content Idea', 'Strategy'], ['Character Selection', 'Creative'], ['Reference Images', 'Creative'],
  ['Storyboard Development', 'Creative'], ['Internal Review', 'Content Lead'], ['Client Approval', 'Approval Coordinator'],
  ['Production Setup', 'Production'], ['AI Video Generation', 'Creative'], ['Editing & Animation', 'Video Editor'],
  ['Quality Control', 'Content Lead'], ['Publishing', 'Paid Media Owner'], ['Promotion', 'Paid Media Owner'],
  ['Community Management', 'Community Manager'], ['Reporting', 'Paid Media Owner']
].map(([name, role], order) => ({ name, role, order: order + 1 }));

export function canonicalPlatform(value = '') {
  const normalized = String(value).trim().toLowerCase();
  if (normalized.includes('youtube')) return 'YouTube';
  if (normalized.includes('instagram')) return 'Instagram';
  if (normalized.includes('facebook')) return 'Facebook';
  if (normalized.includes('tiktok')) return 'TikTok';
  return String(value).trim();
}

export function parseSpreadsheetDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString().slice(0, 10);
}

export function addBusinessDays(isoDate, count) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  let added = 0;
  while (added < count) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

export function validateActivation({ brand, market, platform, date, activation }) {
  const catalog = BRAND_CATALOG[brand];
  if (!catalog) return 'Choose a recognised Shalina brand.';
  if (!catalog.markets.includes(market)) return `${brand} is not active in ${market}.`;
  if (!PLATFORM_IDS.includes(platform)) return `Unsupported platform: ${platform || 'blank'}.`;
  if (platform === 'TikTok' && !['Nigeria', 'South Africa'].includes(market)) return `TikTok is not available in ${market}.`;
  if (!date) return `Missing scheduled date for ${activation || 'activation'}.`;
  return null;
}

// Budget plans do not agree on where the table starts. Some open with the
// headings; others carry a title row like "IBUCAP Cold & Flu" first, which
// makes every column parse as _1, _2, _3 and silently discards the file.
// Look for the row that actually names the columns.
export function findHeaderRow(grid, limit = 15) {
  const wanted = ['DATE', 'ACTIVATION', 'PLATFORM', 'ASSET TYPE', 'OBJECTIVE'];
  for (let index = 0; index < Math.min(grid.length, limit); index += 1) {
    const cells = (grid[index] || []).map((cell) => String(cell ?? '').trim().toUpperCase());
    if (wanted.filter((heading) => cells.includes(heading)).length >= 2) return index;
  }
  return -1;
}

// Money arrives as "$225.81", "R3 511,29", "1,234.56" or a plain number,
// depending on who built the sheet. Number() returns NaN for all but the last,
// which would import every budget as zero.
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  // Whichever separator comes last is the decimal point; the other groups digits.
  const normalised = lastComma > lastDot
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/,/g, '');
  const amount = Number(normalised);
  return Number.isFinite(amount) ? amount : 0;
}

// A published FluxPlanner plan, mapped to the same row shape the spreadsheet
// import produces so everything downstream — validation, content grouping,
// task generation, financials — is one pipeline with two doors.
//
// FluxPlanner rows differ from the Excel export in small ways: dates are
// DD/MM/YYYY strings, platform ids are lowercase ('tiktok'), the rand figure
// is called zarValue, and subtotal spacer rows are flagged _isSubtotal.
// Which brand a published plan belongs to. Prefer what the author declared at
// publish time; fall back to the campaign name for plans published before the
// brand was recorded ("Test Germol" names its brand). The fallback only
// answers when exactly one brand matches — a guess is worse than a question.
export function detectBrand(planName = '', declaredBrand = '') {
  if (BRAND_CATALOG[declaredBrand]) return declaredBrand;
  const name = String(planName).toLowerCase();
  const matches = Object.keys(BRAND_CATALOG).filter((brand) => name.includes(brand.toLowerCase()));
  return matches.length === 1 ? matches[0] : null;
}

export function fluxPlanRows(snapshot) {
  const rows = snapshot?.planData?.rows || [];
  return rows
    .filter((row) => !row._isSubtotal)
    .map((row) => ({
      date: parseSpreadsheetDate(row.date),
      activation: String(row.activation ?? '').trim(),
      assetType: String(row.assetType ?? '').trim(),
      platform: canonicalPlatform(row.platform),
      market: String(row.country ?? '').trim(),
      durationDays: Number(row.duration) || 0,
      objective: String(row.objective ?? '').trim(),
      budget: parseMoney(row.budget),
      actualSpend: parseMoney(row.actualSpend),
      randValue: parseMoney(row.zarValue),
      complete: row.complete === true
    }))
    .filter((row) => row.date && row.activation && row.platform);
}

export function normaliseRows(sheetRows) {
  return sheetRows.map((row) => ({
    date: parseSpreadsheetDate(row.DATE ?? row.Date ?? row.date),
    activation: String(row.ACTIVATION ?? row.Activation ?? row.activation ?? '').trim(),
    assetType: String(row['ASSET TYPE'] ?? row['Asset Type'] ?? '').trim(),
    platform: canonicalPlatform(row.PLATFORM ?? row.Platform ?? ''),
    market: String(row.Country ?? row.COUNTRY ?? row.Market ?? '').trim(),
    durationDays: Number(row.DURATION ?? row.Duration ?? 0) || 0,
    objective: String(row.OBJECTIVE ?? row.Objective ?? '').trim(),
    budget: parseMoney(row.BUDGET ?? row.Budget ?? 0),
    actualSpend: parseMoney(row['ACTUAL SPEND'] ?? row['Actual Spend'] ?? 0),
    // The same money in rand at the rate the plan was built with. Keeping it
    // avoids re-converting later at a rate nobody wrote down.
    randValue: parseMoney(row['RAND VALUE'] ?? row['Rand Value'] ?? 0),
    complete: row.COMPLETE === true || String(row.COMPLETE).toLowerCase() === 'true'
  })).filter((row) => row.date && row.activation && row.platform);
}

// Asset type decides who makes the thing. The plan names a craft, not a person,
// so it maps to a role and the role maps to whoever holds it — which keeps
// routing correct when someone covers leave or changes job.
//
// Order matters: 'AI Video' has to be tested before the bare 'video' rule,
// otherwise every AI video routes to the editor.
export const ASSET_TYPE_ROLES = [
  [/\bai\b|generative|synthetic/, 'AI Video'],
  [/static|image|poster|key\s*visual|\bkv\b|carousel|banner/, 'Static Design'],
  [/video|reel|animation|motion|edit/, 'Video Editor'],
  [/copy|caption|script|article/, 'Content Lead']
];

export function roleForAssetType(assetType = '') {
  const text = String(assetType).trim().toLowerCase();
  if (!text) return 'Creative';
  const match = ASSET_TYPE_ROLES.find(([pattern]) => pattern.test(text));
  return match ? match[1] : 'Creative';
}

// The produced asset, grouped by activation, asset type and date. One Teaser
// video serves four platform rows; making four identical tasks would be wrong.
// Due before the launch so there is something to publish on the day.
export const CONTENT_LEAD_DAYS = 3;

export function groupContentTasks(rows, campaignId) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.activation}:${row.assetType || 'Asset'}:${row.date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        activation: row.activation, assetType: row.assetType || 'Asset', date: row.date,
        market: row.market, platforms: [], roleSlot: roleForAssetType(row.assetType)
      });
    }
    groups.get(key).platforms.push(row.platform);
  }
  return [...groups.values()].map((group) => ({
    campaignId,
    activationKey: `${campaignId}:${group.activation}:${group.date}:content:${group.assetType}`,
    type: 'Content',
    title: `${group.activation} · ${group.assetType} for ${group.platforms.join(', ')}`,
    roleSlot: group.roleSlot,
    market: group.market,
    activation: group.activation,
    assetType: group.assetType,
    dueDate: subtractBusinessDays(group.date, CONTENT_LEAD_DAYS),
    status: 'Not started',
    platforms: group.platforms
  }));
}

export function subtractBusinessDays(isoDate, count) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  let removed = 0;
  while (removed < count) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) removed += 1;
  }
  return date.toISOString().slice(0, 10);
}

export function createActivationTasks(row, campaignId, paidMediaOwner = null) {
  const activationKey = `${campaignId}:${row.activation}:${row.date}:${row.platform}`;
  const common = { campaignId, activationKey, assigneeId: paidMediaOwner, market: row.market, platform: row.platform, activation: row.activation, assetType: row.assetType, objective: row.objective, budget: row.budget, durationDays: row.durationDays, status: 'Not started' };
  const postId = `${activationKey}:post`;
  const boostId = `${activationKey}:boost`;
  return [
    { ...common, id: postId, type: 'Post', title: `${row.activation} · ${row.platform} post`, dueDate: row.date },
    { ...common, id: boostId, type: 'Boost', title: `${row.activation} · ${row.platform} boost`, dueDate: row.date, dependsOn: postId },
    { ...common, id: `${activationKey}:report`, type: 'Report', title: `${row.activation} · ${row.platform} report`, dueDate: addBusinessDays(row.date, 3), dependsOn: boostId, reportState: 'Awaiting data' }
  ];
}

// "Where are we with each post?" — one placement per activation × platform,
// its four stages chained in delivery order: the asset being made, the post
// going live, the boost running, the report captured. The current stage is the
// first one a person still owes; everything after it is waiting on that.
//
// Manual to-dos and granola tasks have no pipeline and are excluded — this
// answers for planned posts only.
const PIPELINE_STAGES = ['content', 'post', 'boost', 'report'];

export function buildPostPipeline(tasks, today = new Date().toISOString().slice(0, 10)) {
  const contents = tasks.filter((t) => t.type === 'Content');
  const placements = new Map();

  for (const task of tasks) {
    if (!['Post', 'Boost', 'Report'].includes(task.type)) continue;
    const key = task.activationKey || '';
    if (!key || key.startsWith('manual:') || key.startsWith('granola:')) continue;
    if (!placements.has(key)) placements.set(key, { key, campaignId: task.campaignId, platform: task.platform, market: task.market, stages: {} });
    placements.get(key).stages[task.type.toLowerCase()] = task;
  }

  const result = [];
  for (const placement of placements.values()) {
    // Key shape: campaignId:activation:date:platform. The uuid holds no
    // colons, so activation (which might) is everything between the ends.
    const parts = placement.key.split(':');
    placement.platformKey = parts.pop();
    placement.date = parts.pop();
    const campaignId = parts.shift();
    placement.activation = parts.join(':');
    placement.stages.content = contents.find((c) => c.activationKey?.startsWith(`${campaignId}:${placement.activation}:${placement.date}:content:`)) || null;

    const chain = PIPELINE_STAGES.map((stage) => [stage, placement.stages[stage]]).filter(([, task]) => task);
    const open = chain.find(([, task]) => !['Done', 'Cancelled'].includes(task.status));
    placement.current = open ? open[0] : 'complete';
    placement.currentTask = open ? open[1] : null;
    placement.overdue = Boolean(open && open[1].dueDate && open[1].dueDate < today);
    placement.blocked = Boolean(open && open[1].status === 'Blocked');
    result.push(placement);
  }

  return result.sort((a, b) => a.date.localeCompare(b.date) || a.activation.localeCompare(b.activation) || a.platform.localeCompare(b.platform));
}

// Which connected Facebook page a task most likely publishes to. The brand
// must appear in the page name or there is no guess at all — a wrong default
// here posts to the wrong country's page, so "no guess, pick by hand" beats
// clever. Market narrows it when page names carry it ("Germol Care SA" vs
// "Germol Care Kenya").
export function guessPage(pages, brand = '', market = '') {
  const norm = (value) => String(value).toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const brandKey = norm(brand);
  if (!brandKey) return null;
  const MARKET_TOKENS = {
    'south africa': ['south africa', ' sa '], nigeria: ['nigeria'], ghana: ['ghana'],
    zambia: ['zambia'], angola: ['angola'], kenya: ['kenya']
  };
  const tokens = MARKET_TOKENS[norm(market)] || (market ? [norm(market)] : []);
  let best = null;
  let bestScore = 0;
  for (const page of pages) {
    const name = ` ${norm(page.name || '')} `;
    let score = 0;
    if (name.includes(brandKey)) score += 2;
    if (tokens.some((token) => name.includes(token))) score += 1;
    if (score > bestScore) { bestScore = score; best = page; }
  }
  return bestScore >= 2 ? best : null;
}

export function taskFlags(task, today = new Date().toISOString().slice(0, 10)) {
  const overdue = !['Done', 'Cancelled'].includes(task.status) && task.dueDate < today;
  return { overdue, boostToday: task.type === 'Boost' && task.dueDate === today, reportDue: task.type === 'Report' && task.dueDate <= today && task.status !== 'Done' };
}
