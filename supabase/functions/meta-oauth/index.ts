import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Meta connection, in two steps.
 *
 * ?action=start (called by GSD with a signed-in manager's JWT) answers with
 * the Facebook consent URL. The callback (Meta redirects the browser here,
 * so it carries no JWT — verify_jwt is off and a signed state parameter
 * stands in for it) exchanges the code for a long-lived user token, walks
 * the user's pages, Instagram accounts and ad accounts, and stores their
 * tokens in pm_platform_connections — a table with RLS enabled and no
 * policies, readable by nothing but the service role.
 *
 * In dev mode this connects assets the signed-in Meta user admins. Shalina's
 * own assets follow App Review and Business Verification.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const WORKSPACE = 'regency-shalina';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };

const env = (key: string) => Deno.env.get(key) ?? '';
const selfUrl = () => `${env('SUPABASE_URL')}/functions/v1/meta-oauth`;

async function hmac(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('META_APP_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Headers set explicitly after construction: passed through the constructor's
// options object they arrived at the browser as text/plain, which rendered
// the page as raw source and mis-decoded every non-ASCII character.
function page(title: string, body: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;background:#f4f8f7"><div style="max-width:460px;background:#fff;border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(21,50,61,.15)"><h2 style="margin:0 0 10px;color:#1d3540">${title}</h2><div style="color:#51666e;font-size:14px;line-height:1.6">${body}</div></div></body></html>`;
  const response = new Response(new TextEncoder().encode(html));
  response.headers.set('content-type', 'text/html; charset=utf-8');
  return response;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(request.url);

  if (!env('META_APP_ID') || !env('META_APP_SECRET')) {
    return Response.json({ error: 'Set META_APP_ID and META_APP_SECRET in Edge Function secrets first.' }, { status: 503, headers: cors });
  }

  // --- step 1: a signed-in GSD manager asks for the consent URL ------------
  if (url.searchParams.get('action') === 'start') {
    const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!bearer) return Response.json({ error: 'Sign in first' }, { status: 401, headers: cors });
    const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${bearer}` } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors });
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const { data: member } = await admin.from('pm_members').select('access_level, email')
      .eq('workspace_id', WORKSPACE).eq('user_id', user.id).maybeSingle();
    if (!member || !['owner', 'admin'].includes(member.access_level)) {
      return Response.json({ error: 'Only Shane, Elvis or Zaida can connect Meta' }, { status: 403, headers: cors });
    }

    const stamp = `${Date.now()}:${member.email ?? user.email ?? ''}`;
    const state = `${stamp}:${await hmac(stamp)}`;
    // Business apps prefer a login Configuration — a permission bundle built
    // in the app dashboard, passed as config_id — over raw scopes. Raw scopes
    // stay as the fallback, and Meta only accepts each one after it has been
    // added inside its use case.
    const configId = env('META_CONFIG_ID');
    const scopes = [
      'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights',
      'instagram_basic', 'instagram_content_publish', 'ads_read', 'ads_management', 'business_management'
    ].join(',');
    const grant = configId ? `config_id=${configId}` : `scope=${scopes}`;
    const consent = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${env('META_APP_ID')}&redirect_uri=${encodeURIComponent(selfUrl())}&state=${encodeURIComponent(state)}&${grant}`;
    return Response.json({ url: consent }, { headers: cors });
  }

  // --- step 2: Meta redirects back with a code -----------------------------
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (!code) {
    const reason = url.searchParams.get('error_description') || 'No authorisation code arrived.';
    return page('Meta connection failed', reason);
  }
  const parts = state.split(':');
  const sig = parts.pop() ?? '';
  const stamp = parts.join(':');
  if (sig !== await hmac(stamp) || Date.now() - Number(parts[0]) > 15 * 60_000) {
    return page('Meta connection failed', 'The connection link is stale or was tampered with. Start again from GSD Workspace settings.');
  }
  const connectedBy = parts[1] || null;

  const tokenRes = await fetch(`${GRAPH}/oauth/access_token?client_id=${env('META_APP_ID')}&client_secret=${env('META_APP_SECRET')}&redirect_uri=${encodeURIComponent(selfUrl())}&code=${code}`);
  const shortToken = (await tokenRes.json()) as { access_token?: string; error?: { message: string } };
  if (!shortToken.access_token) return page('Meta connection failed', shortToken.error?.message ?? 'Code exchange failed.');

  const longRes = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${env('META_APP_ID')}&client_secret=${env('META_APP_SECRET')}&fb_exchange_token=${shortToken.access_token}`);
  const long = (await longRes.json()) as { access_token?: string; expires_in?: number };
  const userToken = long.access_token ?? shortToken.access_token;
  const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;

  const me = await (await fetch(`${GRAPH}/me?fields=id,name&access_token=${userToken}`)).json();
  const pages = await (await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${userToken}`)).json();
  const adAccounts = await (await fetch(`${GRAPH}/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${userToken}`)).json();

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const rows: Record<string, unknown>[] = [{
    workspace_id: WORKSPACE, platform: 'meta', kind: 'user', external_id: String(me.id ?? 'unknown'),
    name: me.name ?? null, access_token: userToken, token_expires_at: expiresAt, connected_by: connectedBy,
    metadata: {}, updated_at: new Date().toISOString()
  }];
  const names: string[] = [];
  for (const p of pages.data ?? []) {
    names.push(p.name);
    // Page tokens obtained from a long-lived user token do not expire.
    rows.push({ workspace_id: WORKSPACE, platform: 'meta', kind: 'page', external_id: String(p.id), name: p.name, access_token: p.access_token, token_expires_at: null, connected_by: connectedBy, metadata: {}, updated_at: new Date().toISOString() });
    if (p.instagram_business_account) {
      names.push(`@${p.instagram_business_account.username ?? p.instagram_business_account.id}`);
      rows.push({ workspace_id: WORKSPACE, platform: 'meta', kind: 'instagram', external_id: String(p.instagram_business_account.id), name: p.instagram_business_account.username ?? null, access_token: p.access_token, token_expires_at: null, connected_by: connectedBy, metadata: { page_id: p.id }, updated_at: new Date().toISOString() });
    }
  }
  for (const a of adAccounts.data ?? []) {
    names.push(a.name ?? a.id);
    rows.push({ workspace_id: WORKSPACE, platform: 'meta', kind: 'ad_account', external_id: String(a.id), name: a.name ?? null, access_token: userToken, token_expires_at: expiresAt, connected_by: connectedBy, metadata: { account_status: a.account_status }, updated_at: new Date().toISOString() });
  }
  const { error } = await admin.from('pm_platform_connections')
    .upsert(rows, { onConflict: 'workspace_id,platform,kind,external_id' });
  if (error) return page('Meta connection failed', `Could not store the connection: ${error.message}`);

  return page('✅ Meta connected', `Connected as <b>${me.name ?? 'unknown'}</b>: ${names.length ? names.map((n) => `<br>• ${n}`).join('') : 'no pages or ad accounts found on this Meta user'}.<br><br>Close this tab and return to GSD — the connections appear in Workspace settings.`);
});
