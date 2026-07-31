// Public connection values for the FluxPlanner-Pro Supabase project.
//
// The publishable key is designed to ship in the browser; it grants nothing on
// its own. Row-level security decides what each signed-in person can read and
// write, which is why 0003 matters more than this file does. Never put the
// service role key here — it bypasses RLS entirely and belongs in Edge Function
// secrets only.
//
// Blank supabaseUrl or supabaseAnonKey runs the interface in local demo mode.
window.PM_CONFIG = {
  supabaseUrl: 'https://yqiufyruxwfnjlcwmfvy.supabase.co',
  supabaseAnonKey: 'sb_publishable_vv7Psg40Ge6BfLoh-v4V2g_Ms8tV9Hl',
  workspaceId: 'regency-shalina',
  timezone: 'Africa/Johannesburg'
};
