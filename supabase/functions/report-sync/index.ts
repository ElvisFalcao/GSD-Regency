import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = request.headers.get('Authorization');
  if (!auth) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { taskId } = await request.json();
  const { data: task, error } = await supabase.from('pm_tasks').select('*, pm_campaigns!inner(brand, workspace_id)').eq('id', taskId).single();
  if (error || task.task_type !== 'Report') return Response.json({ error: 'Reporting task not found' }, { status: 404, headers: cors });
  const campaign = task.pm_campaigns;
  const { data: mapping } = await supabase.from('pm_reporting_mappings').select('*').eq('workspace_id', campaign.workspace_id).eq('brand', campaign.brand).eq('market', task.market).eq('platform', task.platform).eq('enabled', true).maybeSingle();
  if (!mapping) { await supabase.from('pm_tasks').update({ report_state: 'Manual entry required' }).eq('id', taskId); return Response.json({ state: 'Manual entry required' }, { headers: cors }); }
  const apiKey = Deno.env.get('SUPERMETRICS_API_KEY');
  if (!apiKey) return Response.json({ error: 'Supermetrics is not configured' }, { status: 503, headers: cors });
  const response = await fetch(`https://api.supermetrics.com/enterprise/v2/query/${mapping.supermetrics_query_id}/data/json`, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
  if (!response.ok) { await supabase.from('pm_tasks').update({ report_state: 'Manual entry required' }).eq('id', taskId); return Response.json({ state: 'Manual entry required', providerStatus: response.status }, { headers: cors }); }
  const results = await response.json();
  await supabase.from('pm_tasks').update({ report_state: 'Imported from Supermetrics', results, status: 'Done', updated_at: new Date().toISOString() }).eq('id', taskId);
  return Response.json({ state: 'Imported from Supermetrics', results }, { headers: cors });
});

