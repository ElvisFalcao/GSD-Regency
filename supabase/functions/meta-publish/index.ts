import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Publishes a Post task to a connected Facebook page.
 *
 * The browser sends { taskId, pageId, message, link? } with the caller's JWT.
 * The function checks the caller is a workspace manager, fetches the page's
 * vaulted token (pm_platform_connections never leaves the server), posts via
 * the Graph API, then writes the outcome back onto the task: live_link gets
 * the post URL, status becomes Done, and the post id is kept in results for
 * the metrics sync to find later.
 *
 * verify_jwt is off because browser preflights carry no JWT and would die at
 * the gateway; authentication happens here instead, same as meta-oauth.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const WORKSPACE = 'regency-shalina';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
const env = (key: string) => Deno.env.get(key) ?? '';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers: cors });

  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!bearer) return Response.json({ error: 'Sign in first' }, { status: 401, headers: cors });
  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${bearer}` } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors });

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: member } = await admin.from('pm_members').select('id, email, access_level')
    .eq('workspace_id', WORKSPACE).eq('user_id', user.id).maybeSingle();
  if (!member || !['owner', 'admin'].includes(member.access_level)) {
    return Response.json({ error: 'Only Shane, Elvis or Zaida can publish' }, { status: 403, headers: cors });
  }

  const { taskId, pageId, message, link, mediaUrl, mediaType } = await request.json().catch(() => ({}));
  if (!taskId || !pageId || !String(message ?? '').trim()) {
    return Response.json({ error: 'taskId, pageId and a message are required' }, { status: 400, headers: cors });
  }

  const { data: task } = await admin.from('pm_tasks').select('id, task_type, platform, results')
    .eq('id', taskId).eq('workspace_id', WORKSPACE).maybeSingle();
  if (!task) return Response.json({ error: 'Task not found' }, { status: 404, headers: cors });
  if (task.platform === 'Instagram') {
    return Response.json({ error: 'Instagram publishing needs the Instagram connection — reconnect Meta with the Instagram permissions ticked.' }, { status: 400, headers: cors });
  }

  const { data: conn } = await admin.from('pm_platform_connections')
    .select('external_id, name, access_token')
    .eq('workspace_id', WORKSPACE).eq('platform', 'meta').eq('kind', 'page').eq('external_id', String(pageId))
    .maybeSingle();
  if (!conn) return Response.json({ error: 'That page is not connected. Check Workspace settings.' }, { status: 404, headers: cors });

  // Text, photo and video use three different Graph endpoints. The caption
  // parameter differs per endpoint too — Facebook's API, not our choice.
  const caption = String(message).trim();
  let endpoint = `${GRAPH}/${conn.external_id}/feed`;
  const body = new URLSearchParams({ access_token: conn.access_token });
  if (mediaUrl && mediaType === 'photo') {
    endpoint = `${GRAPH}/${conn.external_id}/photos`;
    body.set('url', String(mediaUrl));
    body.set('caption', caption);
  } else if (mediaUrl && mediaType === 'video') {
    endpoint = `${GRAPH}/${conn.external_id}/videos`;
    body.set('file_url', String(mediaUrl));
    body.set('description', caption);
  } else {
    body.set('message', caption);
    if (link) body.set('link', String(link));
  }
  const graphRes = await fetch(endpoint, { method: 'POST', body });
  const posted = (await graphRes.json()) as { id?: string; post_id?: string; error?: { message: string } };
  const postId = posted.post_id ?? posted.id;
  if (!postId) {
    return Response.json({ error: posted.error?.message ?? 'Facebook rejected the post.' }, { status: 502, headers: cors });
  }

  const postUrl = mediaType === 'video'
    ? `https://www.facebook.com/watch/?v=${postId}` // videos process async; this resolves once ready
    : `https://www.facebook.com/${postId}`;
  // Merge, never replace: results also carries notes and meeting keys.
  const results = { ...(task.results ?? {}), metaPostId: postId, mediaType: mediaType ?? null, publishedAt: new Date().toISOString(), publishedBy: member.email, publishedTo: conn.name };
  await admin.from('pm_tasks').update({
    status: 'Done', live_link: postUrl, results, updated_at: new Date().toISOString()
  }).eq('id', task.id);
  await admin.from('pm_task_activity').insert({
    task_id: task.id, actor_id: member.id, event_type: 'published',
    detail: { postId, page: conn.name, mediaType: mediaType ?? null }
  });

  return Response.json({ id: postId, url: postUrl, page: conn.name }, { headers: cors });
});
