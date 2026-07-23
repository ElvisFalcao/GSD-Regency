// Place this file at supabase/functions/granola-task-sync/index.ts when deploying with the Supabase CLI.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-granola-sync-secret' };
type Action = { key?: string; title: string; owner?: string; dueDate?: string; status?: string; notes?: string; campaignId?: string };

function extractActions(notes: string): Action[] {
  const actions: Action[] = [];
  notes.split('\n').forEach((line, index) => {
    const item = line.match(/^\s*(?:[-*]\s*)?(?:\[\s*\]\s*)?(?:ACTION|TODO)\s*:\s*(.+)$/i) || line.match(/^\s*[-*]\s*\[\s*\]\s*(.+)$/);
    if (!item?.[1]) return;
    const full = item[1].trim(); const owner = full.match(/^([^:â€“-]{2,50})\s*[:â€“-]\s*(.+)$/); const date = full.match(/\s+(?:by|due)\s+(\d{4}-\d{2}-\d{2})\s*$/i);
    const title = (owner ? owner[2] : full).replace(/\s+(?:by|due)\s+\d{4}-\d{2}-\d{2}\s*$/i, '').trim();
    if (title.length >= 4) actions.push({ key: `line-${index}`, title, owner: owner?.[1]?.trim(), dueDate: date?.[1], status: 'Not started' });
  });
  return actions;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const expectedSecret = Deno.env.get('GRANOLA_SYNC_SECRET');
  if (!expectedSecret || request.headers.get('x-granola-sync-secret') !== expectedSecret) return Response.json({ error: 'Unauthorised Granola sync' }, { status: 401, headers: cors });
  const payload = await request.json();
  if (!payload.workspaceId || !payload.meetingId || !payload.title) return Response.json({ error: 'workspaceId, meetingId and title are required' }, { status: 400, headers: cors });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: meeting, error: meetingError } = await supabase.from('pm_meetings').upsert({ workspace_id: payload.workspaceId, source: 'granola', external_meeting_id: payload.meetingId, title: payload.title, meeting_date: payload.meetingDate || null, notes: payload.notes || '', source_url: payload.sourceUrl || null, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,source,external_meeting_id' }).select().single();
  if (meetingError) return Response.json({ error: meetingError.message }, { status: 400, headers: cors });
  const actions: Action[] = Array.isArray(payload.actions) ? payload.actions : extractActions(payload.notes || '');
  const { data: members } = await supabase.from('pm_members').select('id, display_name').eq('workspace_id', payload.workspaceId); const tasks = [];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]; const assignee = members?.find((member) => action.owner && member.display_name.toLowerCase().includes(action.owner.toLowerCase())); const actionKey = action.key || `action-${index}`;
    const task = { workspace_id: payload.workspaceId, campaign_id: action.campaignId || null, activation_key: `granola:${payload.meetingId}:${actionKey}`, task_type: 'To-do', title: action.title, assignee_id: assignee?.id || null, due_date: action.dueDate || new Date().toISOString().slice(0, 10), status: action.status || 'Not started', source_meeting_id: meeting.id, source_action_key: actionKey, results: { notes: action.notes || '', granolaMeetingId: payload.meetingId }, updated_at: new Date().toISOString() };
    const { data: existing, error: existingError } = await supabase.from('pm_tasks').select('id').eq('workspace_id', payload.workspaceId).eq('source_meeting_id', meeting.id).eq('source_action_key', actionKey).maybeSingle();
    if (existingError) return Response.json({ error: existingError.message }, { status: 400, headers: cors });
    const query = existing ? supabase.from('pm_tasks').update(task).eq('id', existing.id) : supabase.from('pm_tasks').insert(task); const { data, error } = await query.select('id, title, status, assignee_id, due_date').single();
    if (error) return Response.json({ error: error.message, action: action.title }, { status: 400, headers: cors }); tasks.push(data);
  }
  return Response.json({ meetingId: meeting.id, createdOrUpdated: tasks.length, tasks }, { headers: cors });
});

