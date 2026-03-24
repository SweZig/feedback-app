// api/add-org-member.js
// Anropas från LoginPage efter att inbjuden användare satt sitt lösenord

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, organizationId, role } = req.body;

  if (!userId || !organizationId || !role) {
    return res.status(400).json({ error: 'userId, organizationId och role krävs' });
  }

  const validRoles = ['admin', 'manager', 'analytiker'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Ogiltig roll' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('org_members')
      .upsert({
        organization_id: organizationId,
        user_id:         userId,
        role,
      }, { onConflict: 'organization_id,user_id' });

    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[add-org-member]', err);
    return res.status(500).json({ error: err.message || 'Serverfel' });
  }
}
