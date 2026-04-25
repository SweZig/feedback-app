// api/delete-user.js
// Vercel Serverless Function — körs server-side med service_role-nyckeln
// Anropas från AdminPage via fetch('/api/delete-user')
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS-headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId krävs' });
  }

  try {
    // Radera i rätt ordning för att undvika orphans:
    // 1. org_members (refererar user_id)
    // 2. public.users (refererar auth.users.id)
    // 3. auth.users (källan)

    const { error: memberError } = await supabaseAdmin
      .from('org_members')
      .delete()
      .eq('user_id', userId);
    if (memberError) throw memberError;

    const { error: userError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);
    if (userError) throw userError;

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) throw authError;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[delete-user]', err);
    return res.status(500).json({ error: err.message || 'Serverfel' });
  }
}
