// api/invite-user.js
// Vercel Serverless Function — körs server-side med service_role-nyckeln
// Anropas från AdminPage via fetch('/api/invite-user')

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

  const { email, role, organizationId } = req.body;

  if (!email || !role || !organizationId) {
    return res.status(400).json({ error: 'email, role och organizationId krävs' });
  }

  const validRoles = ['admin', 'manager', 'analytiker'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Ogiltig roll' });
  }

  // Använd REACT_APP_SITE_URL om den finns, annars Vercel-URL, annars feedbackapp.store
  const siteUrl =
    process.env.REACT_APP_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://feedbackapp.store');

  try {
    // Skicka inbjudan via Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { organization_id: organizationId, role },
      redirectTo: `${siteUrl}/`,
    });

    if (error) throw error;

    // Skapa rad i users-tabellen
    await supabaseAdmin
      .from('users')
      .upsert({ id: data.user.id, email }, { onConflict: 'id' });

    // org_members skapas INTE här — görs i LoginPage efter att användaren satt lösenord

    return res.status(200).json({ success: true, userId: data.user.id });
  } catch (err) {
    console.error('[invite-user]', err);
    return res.status(500).json({ error: err.message || 'Serverfel' });
  }
}
