// api/invite-user.js
// Vercel Serverless Function — körs server-side med service_role-nyckeln
// Anropas från AdminPage via fetch('/api/invite-user')

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, role, organizationId } = req.body;

  if (!email || !role || !organizationId) {
    return res.status(400).json({ error: 'email, role och organizationId krävs' });
  }

  const validRoles = ['admin', 'manager', 'analytiker'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Ogiltig roll' });
  }

  try {
    // Skicka inbjudan via Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { organization_id: organizationId, role },
      redirectTo: `${process.env.REACT_APP_SITE_URL || 'https://feedbackapp.store'}/`,
    });

    if (error) throw error;

    // Skapa rad i users-tabellen om den inte finns
    await supabaseAdmin
      .from('users')
      .upsert({ id: data.user.id, email }, { onConflict: 'id' });

    // Skapa org_members-rad
    const { error: memberError } = await supabaseAdmin
      .from('org_members')
      .upsert({
        organization_id: organizationId,
        user_id:         data.user.id,
        role,
      }, { onConflict: 'organization_id,user_id' });

    if (memberError) throw memberError;

    return res.status(200).json({ success: true, userId: data.user.id });
  } catch (err) {
    console.error('[invite-user]', err);
    return res.status(500).json({ error: err.message || 'Serverfel' });
  }
}
