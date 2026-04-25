// src/utils/userManagement.js
// Användarhantering via Supabase Auth Admin API
// Körs via Vercel Serverless Functions för att skydda service_role-nyckeln

import { supabase } from './supabaseClient';

export const ROLE_LABELS = {
  owner:     'Ägare',
  admin:     'Administratör',
  manager:   'Manager',
  analytiker: 'Analytiker',
};

export const ROLE_ORDER = ['owner', 'admin', 'manager', 'analytiker'];

// ─── Hämta användare i en organisation ───────────────────────

export async function getOrgUsers(organizationId) {
  const { data, error } = await supabase
    .from('org_members')
    .select('id, role, created_at, user_id, users(id, email, display_name, last_login_at)')
    .eq('organization_id', organizationId)
    .order('created_at');

  if (error) throw error;
  return data.map((m) => ({
    memberId:    m.id,
    userId:      m.user_id,
    role:        m.role,
    joinedAt:    m.created_at,
    email:       m.users?.email || '',
    displayName: m.users?.display_name || '',
    lastLogin:   m.users?.last_login_at || null,
  }));
}

// ─── Bjud in användare ────────────────────────────────────────

export async function inviteUser(email, role, organizationId) {
  // Steg 1: Skicka inbjudan via Vercel Serverless Function
  const res = await fetch('/api/invite-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role, organizationId }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Inbjudan misslyckades');
  return data;
}

// ─── Ändra roll ───────────────────────────────────────────────

export async function updateUserRole(memberId, newRole) {
  const { error } = await supabase
    .from('org_members')
    .update({ role: newRole })
    .eq('id', memberId);

  if (error) throw error;
}

// ─── Ta bort användare från organisation ─────────────────────

export async function removeUserFromOrg(memberId) {
  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('id', memberId);

  if (error) throw error;
}

// ─── Hämta alla organisationer (owner-funktion) ───────────────

export async function getAllOrganizations() {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, created_at')
    .is('deleted_at', null)
    .order('name');

  if (error) throw error;
  return data;
}

// ─── Kontrollera roll för inloggad användare ──────────────────

export async function getMyRole(organizationId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('org_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();

  if (error) return null;
  return data.role;
}
