// src/utils/storageAdapter.js
//
// Sprint B: Supabase är ensam källa. Dual-write till localStorage,
// READ_FROM-flagga och hydrateResponsesFromSupabase är borttagna.
//
// Exponerar bara det som faktiskt används av appen:
//   - Auth: signIn / signOut / getCurrentUser / onAuthStateChange
//   - saveResponse  (SurveyPage)
//   - getAssembledCustomers  (App.js)
//
// Lågnivå-CRUD för chains/departments/touchpoints är flyttad till
// chainOperations.js. Rapporten läser responses direkt från Supabase
// i ReportPage.js.

import { supabase } from './supabaseClient';

function logError(context, error) {
  console.error(`[storageAdapter] ${context}:`, error?.message || error);
}


// ════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}


// ════════════════════════════════════════════
// SVAR (skrivning)
// ════════════════════════════════════════════

/**
 * Sparar ett enkät-svar till Supabase med tillhörande svarsalternativ
 * och fritext-kommentar i FK-relaterade tabeller.
 *
 * NPS-kategorin beräknas frontend och skickas med i payload — Supabase
 * kan ha trigger som sätter den om den saknas, men vi sätter den
 * explicit för att vara säkra.
 *
 * Uppföljnings-mail (när score ≤ 2) lagras i responses.metadata.followUpEmail
 * eftersom response_comments inte har en email-kolumn.
 */
export async function saveResponse(response) {
  const score = response.score;
  const nps_category =
    score <= 6 ? 'detractor' :
    score <= 8 ? 'passive'   : 'promoter';

  try {
    // Bygg metadata — inkludera followUpEmail om det finns
    const metadata = { ...(response.metadata ?? {}) };
    if (response.followUpEmail?.trim()) {
      metadata.followUpEmail = response.followUpEmail.trim();
    }

    const payload = {
      id:            response.id,
      touchpoint_id: response.touchpointId,
      chain_id:      response.chainId,
      score:         score,
      nps_category:  nps_category,
      session_id:    response.sessionId ?? null,
      responded_at:  response.respondedAt ?? new Date().toISOString(),
      metadata,
    };

    const { data: insertedResponse, error: respError } = await supabase
      .from('responses')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();
    if (respError) throw respError;

    // Spara valda svarsalternativ som text (answer_text), inte UUID
    const selectedTexts = (response.selectedAnswers || []).filter(t => t);
    if (selectedTexts.length > 0) {
      const answerPayload = selectedTexts.map(text => ({
        response_id: insertedResponse.id,
        answer_text: text,
      }));
      const { error: answersError } = await supabase
        .from('response_answers')
        .insert(answerPayload);
      if (answersError) throw answersError;
    }

    // Spara fritext-kommentar
    if (response.comment?.trim()) {
      const { error: commentError } = await supabase
        .from('response_comments')
        .insert({
          response_id: insertedResponse.id,
          comment:     response.comment.trim(),
        });
      if (commentError) throw commentError;
    }

    return { ...response, nps_category };
  } catch (e) {
    logError('saveResponse', e);
    throw e;
  }
}


// ════════════════════════════════════════════
// ASSEMBLY — Bygger ihop nästlat format för komponenter
// ════════════════════════════════════════════

/**
 * Konverterar Supabase-rader (chains + departments + touchpoints) till
 * det nästlade format som SurveyPage, ReportPage och SettingsPage
 * förväntar sig. activeTouchpointId läses från localStorage så att
 * UI-staten (per-användare/per-enhet) följer med direkt vid laddning.
 */
function assembleChain(chain, departments, touchpoints) {
  let activeTouchpointId = null;
  try {
    const map = JSON.parse(localStorage.getItem('npsActiveTouchpointByChain') || '{}');
    activeTouchpointId = map[chain.id] ?? null;
  } catch { /* ignore */ }

  return {
    id:           chain.id,
    name:         chain.name,
    customLogo:   chain.custom_logo || null,
    physicalConfig: chain.config?.physicalConfig || null,
    onlineConfig:   chain.config?.onlineConfig   || null,
    otherConfig:    chain.config?.otherConfig    || null,
    enpsConfig:     chain.config?.enpsConfig     || null,
    departments: (departments || []).map(d => ({
      id:         d.id,
      name:       d.name,
      uniqueCode: d.unique_code || '',
      order:      d.sort_order  || 0,
    })),
    touchpoints: (touchpoints || []).map(t => ({
      id:             t.id,
      name:           t.name,
      departmentId:   t.department_id,
      chainId:        chain.id,
      type:           t.type || 'physical',
      mode:           t.mode || 'app',
      order:          t.sort_order    || 0,
      configOverride: t.config_override || null,
      access_token:   t.access_token  || null,
    })),
    activeTouchpointId,
  };
}

/**
 * Hämtar alla kedjor för en eller flera organisationer från Supabase
 * och bygger ihop dem i nästlat format. Använder 3 queries (inte N+1).
 */
export async function getAssembledCustomers(organizationId) {
  try {
    const orgIds = Array.isArray(organizationId) ? organizationId : [organizationId];
    if (orgIds.length === 0) return [];

    const { data: chains = [], error: chainsError } = await supabase
      .from('chains')
      .select('*')
      .in('organization_id', orgIds)
      .is('deleted_at', null)
      .order('sort_order');
    if (chainsError) throw chainsError;
    if (chains.length === 0) return [];

    const chainIds = chains.map(c => c.id);

    const { data: allDepartments = [] } = await supabase
      .from('departments')
      .select('*')
      .in('chain_id', chainIds)
      .is('deleted_at', null)
      .order('sort_order');

    const { data: allTouchpoints = [] } = await supabase
      .from('touchpoints')
      .select('*')
      .in('chain_id', chainIds)
      .is('deleted_at', null)
      .order('sort_order');

    return chains.map(chain => {
      const departments = allDepartments.filter(d => d.chain_id === chain.id);
      const touchpoints = allTouchpoints.filter(t => t.chain_id === chain.id);
      return assembleChain(chain, departments, touchpoints);
    });
  } catch (e) {
    logError('getAssembledCustomers', e);
    return [];
  }
}
