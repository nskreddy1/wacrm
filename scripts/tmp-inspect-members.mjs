// Temporary diagnostic: dump membership + workspace-profile wiring for the
// two test accounts so we can see what the sidebar role label resolves from.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_zepo_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

async function q(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body;
}

const profiles = await q(
  'profiles?select=user_id,email,account_id,account_role,workspace_profile_id,workspace_role_id,status'
);
console.log('profiles', JSON.stringify(profiles, null, 2));
const members = await q(
  'account_members?select=user_id,account_id,role,status,workspace_profile_id,workspace_role_id'
);
console.log('members', JSON.stringify(members, null, 2));
const wp = await q('workspace_profiles?select=id,account_id,name,system_key');
console.log('workspace_profiles', JSON.stringify(wp, null, 2));
const accounts = await q('accounts?select=id,name,owner_user_id');
console.log('accounts', JSON.stringify(accounts, null, 2));
