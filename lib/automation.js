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

export function normaliseRows(sheetRows) {
  return sheetRows.map((row) => ({
    date: parseSpreadsheetDate(row.DATE ?? row.Date ?? row.date),
    activation: String(row.ACTIVATION ?? row.Activation ?? row.activation ?? '').trim(),
    assetType: String(row['ASSET TYPE'] ?? row['Asset Type'] ?? '').trim(),
    platform: canonicalPlatform(row.PLATFORM ?? row.Platform ?? ''),
    market: String(row.Country ?? row.COUNTRY ?? row.Market ?? '').trim(),
    durationDays: Number(row.DURATION ?? row.Duration ?? 0) || 0,
    objective: String(row.OBJECTIVE ?? row.Objective ?? '').trim(),
    budget: Number(row.BUDGET ?? row.Budget ?? 0) || 0,
    actualSpend: Number(row['ACTUAL SPEND'] ?? row['Actual Spend'] ?? 0) || 0,
    complete: row.COMPLETE === true || String(row.COMPLETE).toLowerCase() === 'true'
  })).filter((row) => row.date && row.activation && row.platform);
}

export function createActivationTasks(row, campaignId, paidMediaOwner = null) {
  const activationKey = `${campaignId}:${row.activation}:${row.date}:${row.platform}`;
  const common = { campaignId, activationKey, assigneeId: paidMediaOwner, market: row.market, platform: row.platform, activation: row.activation, assetType: row.assetType, objective: row.objective, budget: row.budget, durationDays: row.durationDays, status: 'Not started' };
  const postId = `${activationKey}:post`;
  const boostId = `${activationKey}:boost`;
  return [
    { ...common, id: postId, type: 'Post', title: `${row.activation} Â· ${row.platform} post`, dueDate: row.date },
    { ...common, id: boostId, type: 'Boost', title: `${row.activation} Â· ${row.platform} boost`, dueDate: row.date, dependsOn: postId },
    { ...common, id: `${activationKey}:report`, type: 'Report', title: `${row.activation} Â· ${row.platform} report`, dueDate: addBusinessDays(row.date, 3), dependsOn: boostId, reportState: 'Awaiting data' }
  ];
}

export function taskFlags(task, today = new Date().toISOString().slice(0, 10)) {
  const overdue = !['Done', 'Cancelled'].includes(task.status) && task.dueDate < today;
  return { overdue, boostToday: task.type === 'Boost' && task.dueDate === today, reportDue: task.type === 'Report' && task.dueDate <= today && task.status !== 'Done' };
}

