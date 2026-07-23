import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Trigger daily via Supabase Cron. Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY.
Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
  const { data: tasks } = await supabase.from('pm_tasks').select('*, pm_members(email, display_name), pm_campaigns(name)').lte('due_date', today).not('status', 'in', '(Done,Cancelled)');
  for (const task of tasks || []) {
    const member = task.pm_members; if (!member?.email) continue;
    const subject = `${task.due_date < today ? 'Overdue' : 'Due today'}: ${task.title}`;
    await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: Deno.env.get('RESEND_FROM') || 'Regency Project Manager <notifications@regency.global>', to: [member.email], subject, html: `<p>${subject}</p><p>${task.pm_campaigns?.name || ''} Â· ${task.market || ''} Â· ${task.platform || ''}</p>` }) });
  }
  return Response.json({ sentFor: tasks?.length || 0 });
});

