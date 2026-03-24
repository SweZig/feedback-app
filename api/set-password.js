// api/set-password.js
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, password, organizationId, role } = req.body;
  console.log('[set-password] userId:', userId, 'organizationId:', organizationId, 'role:', role);

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

    // Säkerställ att användaren finns i users-tabellen
    const email = userData?.user?.email;
    await supabaseAdmin
      .from('users')
      .upsert({ id: userId, email }, { onConflict: 'id' });

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
