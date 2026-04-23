// src/utils/permissions.js
import { supabase } from './supabaseClient';

// ─── Funktionsgrupper ────────────────────────────────────────

export const PERMISSION_GROUPS = [
  {
    group: 'Fliknavigering',
    features: [
      { key: 'view_tab_survey',   label: 'Se fliken Enkät' },
      { key: 'view_tab_report',   label: 'Se fliken Rapport' },
      { key: 'view_tab_settings', label: 'Se fliken Inställningar' },
      { key: 'view_tab_admin',    label: 'Se fliken Användare' },
    ],
  },
  {
    group: 'Användarhantering',
    features: [
      { key: 'invite_users',   label: 'Bjuda in användare' },
      { key: 'manage_users',   label: 'Redigera/ta bort användare' },
      { key: 'view_users',     label: 'Se användarlista' },
      { key: 'assign_roles',   label: 'Tilldela/byta roller' },
    ],
  },
  {
    group: 'Rapporter & Export',
    features: [
      { key: 'view_overview',    label: 'Se Översikt' },
      { key: 'view_weekly',      label: 'Se Veckoanalys' },
      { key: 'view_touchpoints', label: 'Se Mätpunkter-tab' },
      { key: 'filter_report',    label: 'Filtrera rapport' },
      { key: 'export_csv',       label: 'Exportera CSV' },
      { key: 'export_excel',     label: 'Exportera Excel' },
    ],
  },
  {
    group: 'Kedjor, Avdelningar & Mätpunkter',
    features: [
      { key: 'manage_chains',      label: 'Skapa/redigera/radera kedjor' },
      { key: 'manage_departments', label: 'Skapa/redigera/radera avdelningar' },
      { key: 'manage_touchpoints', label: 'Skapa/redigera/radera mätpunkter' },
    ],
  },
  {
    group: 'Enkätinställningar',
    features: [
      { key: 'manage_config',  label: 'Ändra konfiguration & NPS-fråga' },
      { key: 'manage_answers', label: 'Hantera fördefinierade svar' },
    ],
  },
  {
    group: 'System',
    features: [
      { key: 'manage_backup', label: 'Exportera/importera backup' },
      { key: 'view_admin',    label: 'Se användarhantering' },
    ],
  },
];

// ─── Defaultvärden per spec ───────────────────────────────────

export const DEFAULT_PERMISSIONS = {
  // Fliknavigering — nya i v5.4
  // Enkät och Rapport är synliga för alla roller som standard.
  // Inställningar och Användare är begränsade till owner/admin.
  view_tab_survey:   { owner: true,  admin: true,  manager: true,  analytiker: true  },
  view_tab_report:   { owner: true,  admin: true,  manager: true,  analytiker: true  },
  view_tab_settings: { owner: true,  admin: true,  manager: false, analytiker: false },
  view_tab_admin:    { owner: true,  admin: true,  manager: false, analytiker: false },

  invite_users:      { owner: true,  admin: true,  manager: false, analytiker: false },
  manage_users:      { owner: true,  admin: true,  manager: false, analytiker: false },
  view_users:        { owner: true,  admin: true,  manager: true,  analytiker: false },
  assign_roles:      { owner: true,  admin: true,  manager: false, analytiker: false },

  view_overview:     { owner: true,  admin: true,  manager: true,  analytiker: true  },
  view_weekly:       { owner: true,  admin: true,  manager: true,  analytiker: true  },
  view_touchpoints:  { owner: true,  admin: true,  manager: true,  analytiker: true  },
  filter_report:     { owner: true,  admin: true,  manager: true,  analytiker: true  },
  export_csv:        { owner: true,  admin: true,  manager: true,  analytiker: true  },
  export_excel:      { owner: true,  admin: true,  manager: true,  analytiker: true  },

  manage_chains:     { owner: true,  admin: true,  manager: false, analytiker: false },
  manage_departments:{ owner: true,  admin: true,  manager: false, analytiker: false },
  manage_touchpoints:{ owner: true,  admin: true,  manager: false, analytiker: false },

  manage_config:     { owner: true,  admin: true,  manager: false, analytiker: false },
  manage_answers:    { owner: true,  admin: true,  manager: false, analytiker: false },

  manage_backup:     { owner: true,  admin: false, manager: false, analytiker: false },
  view_admin:        { owner: true,  admin: true,  manager: false, analytiker: false },
};

// ─── Läs permissions från Supabase ───────────────────────────

export async function getPermissions(organizationId) {
  const { data, error } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .single();

  if (error) throw error;

  const stored = data?.settings?.permissions || {};
  // Merga stored med defaults (nya features får defaultvärde)
  const merged = {};
  for (const key of Object.keys(DEFAULT_PERMISSIONS)) {
    merged[key] = { ...DEFAULT_PERMISSIONS[key], ...(stored[key] || {}) };
  }
  return merged;
}

// ─── Spara permissions till Supabase ─────────────────────────

export async function savePermissions(organizationId, permissions) {
  // Hämta befintliga settings för att inte skriva över annat
  const { data, error: fetchError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .single();

  if (fetchError) throw fetchError;

  const currentSettings = data?.settings || {};
  const newSettings = { ...currentSettings, permissions };

  const { error } = await supabase
    .from('organizations')
    .update({ settings: newSettings })
    .eq('id', organizationId);

  if (error) throw error;
}

// ─── Kontrollera om roll har behörighet ──────────────────────

export function can(permissions, role, feature) {
  if (!role || !feature) return false;
  if (role === 'owner') return true; // owner har alltid allt
  return permissions?.[feature]?.[role] ?? DEFAULT_PERMISSIONS[feature]?.[role] ?? false;
}
