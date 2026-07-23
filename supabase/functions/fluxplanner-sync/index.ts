import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const keyFor = (row: Record<string, unknown>) => String(row.rowKey || `${row.activationId || row.activation}:${row.platform}`);

/**
 * Contract for the FluxPlanner patch:
 * - every activation receives a stable `id` when first created;
 * - every generated plan row stores `rowKey: `${activationId}:${platform}``.
 * This avoids matching a changed date by its old date string.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!bearer) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await request.json();
  const { data: plan } = await admin.from('plans').select('*').eq('id', body.planId).eq('user_id', user.id).single();
  if (!plan) return Response.json({ error: 'Plan not found' }, { status: 404, headers: cors });
  if (body.action === 'read') return Response.json({ plan: plan.data, updatedAt: plan.updated_at }, { headers: cors });
  if (body.action !== 'update_dates' || !Array.isArray(body.updates)) return Response.json({ error: 'Unsupported action' }, { status: 400, headers: cors });
  const snapshot = structuredClone(plan.data);
  const rows = snapshot?.planData?.rows || [];
  const updates = new Map(body.updates.map((update: Record<string, unknown>) => [String(update.rowKey), String(update.date)]));
  let updated = 0;
  for (const row of rows) { const nextDate = updates.get(keyFor(row)); if (nextDate) { row.date = nextDate; updated += 1; } }
  if (!updated) return Response.json({ error: 'No stable row keys matched; update FluxPlanner first.' }, { status: 409, headers: cors });
  await admin.from('plans').update({ data: snapshot, updated_at: new Date().toISOString() }).eq('id', plan.id);
  return Response.json({ updated }, { headers: cors });
});

