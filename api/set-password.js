// api/set-password.js
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS-headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, password, organizationId, role } = req.body;

  if (!userId || !password || !organizationId || !role) {
    return res.status(400).json({ error: 'userId, password, organizationId och role krävs' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Lösenordet måste vara minst 8 tecken' });
  }

  try {
    // Sätt lösenordet via admin API
    const { data: userData, error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password,
    });
    if (passwordError) throw passwordError;

    const email = userData?.user?.email;
    if (!email) throw new Error('Kunde inte läsa e-post från användaren');

    // Städa eventuella orphan-rader i public.users med samma e-post
    // men annat id (från tidigare raderade användare som lämnat orphans).
    const { data: orphans } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .neq('id', userId);

    if (orphans && orphans.length > 0) {
      const orphanIds = orphans.map(o => o.id);
      await supabaseAdmin.from('org_members').delete().in('user_id', orphanIds);
      await supabaseAdmin.from('users').delete().in('id', orphanIds);
    }

    // Säkerställ att användaren finns i users-tabellen
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .upsert({ id: userId, email }, { onConflict: 'id' });
    if (usersError) throw usersError;

    // Skapa org_members-rad
    const { error: memberError } = await supabaseAdmin
      .from('org_members')
      .upsert({
        organization_id: organizationId,
        user_id:         userId,
        role,
      }, { onConflict: 'organization_id,user_id' });
    if (memberError) throw memberError;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[set-password]', err);
    return res.status(500).json({ error: err.message || 'Serverfel' });
  }
}
