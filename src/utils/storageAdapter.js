// src/utils/storageAdapter.js
//
// FAS 1 — Parallell körning
// Läser från localStorage (primär källa)
// Skriver till BÅDE localStorage och Supabase
//
// När Fas 2 (renodlad backend) är klar:
// → Byt READ_FROM till 'supabase'
// → Ta bort all localStorage-logik

import { supabase } from './supabaseClient';

// ── Konfiguration ────────────────────────────────────────────
const READ_FROM = 'localStorage'; // 'localStorage' | 'supabase'
const LOG_SYNC  = false;          // sätt true för debugging

function log(...args) {
  if (LOG_SYNC) console.log('[storageAdapter]', ...args);
}

function logError(context, error) {
  console.error(`[storageAdapter] ${context}:`, error?.message || error);
}


// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════

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


// ════════════════════════════════════════════════════════════
// ORGANISATIONER
// ════════════════════════════════════════════════════════════

export async function getOrganizations() {
  if (READ_FROM === 'localStorage') {
    // localStorage har ingen organisations-entitet — returnera nuvarande kund
    const customers = JSON.parse(localStorage.getItem('customers') || '[]');
    return customers;
  }

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .is('deleted_at', null)
    .order('name');

  if (error) { logError('getOrganizations', error); return []; }
  return data;
}

export async function getOrganizationById(id) {
  if (READ_FROM === 'localStorage') {
    const customers = JSON.parse(localStorage.getItem('customers') || '[]');
    return customers.find(c => c.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) { logError('getOrganizationById', error); return null; }
  return data;
}


// ════════════════════════════════════════════════════════════
// KEDJOR (chains)
// ════════════════════════════════════════════════════════════

export async function getChains(organizationId) {
  if (READ_FROM === 'localStorage') {
    const all = JSON.parse(localStorage.getItem('chains') || '[]');
    return organizationId
      ? all.filter(c => c.organizationId === organizationId || c.customerId === organizationId)
      : all;
  }

  const { data, error } = await supabase
    .from('chains')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sort_order');

  if (error) { logError('getChains', error); return []; }
  return data;
}

export async function getChainById(chainId) {
  if (READ_FROM === 'localStorage') {
    const all = JSON.parse(localStorage.getItem('chains') || '[]');
    return all.find(c => c.id === chainId) ?? null;
  }

  const { data, error } = await supabase
    .from('chains')
    .select('*')
    .eq('id', chainId)
    .single();

  if (error) { logError('getChainById', error); return null; }
  return data;
}

export async function saveChain(chain) {
  // ── localStorage ──
  const all = JSON.parse(localStorage.getItem('chains') || '[]');
  const idx = all.findIndex(c => c.id === chain.id);
  if (idx >= 0) { all[idx] = chain; } else { all.push(chain); }
  localStorage.setItem('chains', JSON.stringify(all));

  // ── Supabase (fire-and-forget i Fas 1) ──
  try {
    const payload = {
      id:              chain.id,
      organization_id: chain.organizationId || chain.customerId,
      name:            chain.name,
      config:          chain.config || {},
      sort_order:      chain.sortOrder ?? 0,
      is_active:       chain.isActive ?? true,
    };

    const { error } = await supabase
      .from('chains')
      .upsert(payload, { onConflict: 'id' });

    if (error) throw error;
    log('saveChain ✓', chain.id);
  } catch (e) {
    logError('saveChain (Supabase)', e);
  }

  return chain;
}

export async function deleteChain(chainId) {
  // ── localStorage ──
  const all = JSON.parse(localStorage.getItem('chains') || '[]');
  localStorage.setItem('chains', JSON.stringify(all.filter(c => c.id !== chainId)));

  // ── Supabase — soft delete ──
  try {
    const { error } = await supabase
      .from('chains')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', chainId);

    if (error) throw error;
    log('deleteChain ✓', chainId);
  } catch (e) {
    logError('deleteChain (Supabase)', e);
  }
}


// ════════════════════════════════════════════════════════════
// AVDELNINGAR (departments)
// ════════════════════════════════════════════════════════════

export async function getDepartments(chainId) {
  if (READ_FROM === 'localStorage') {
    const all = JSON.parse(localStorage.getItem('departments') || '[]');
    return chainId ? all.filter(d => d.chainId === chainId) : all;
  }

  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('chain_id', chainId)
    .is('deleted_at', null)
    .order('sort_order');

  if (error) { logError('getDepartments', error); return []; }
  return data;
}

export async function saveDepartment(department) {
  // ── localStorage ──
  const all = JSON.parse(localStorage.getItem('departments') || '[]');
  const idx = all.findIndex(d => d.id === department.id);
  if (idx >= 0) { all[idx] = department; } else { all.push(department); }
  localStorage.setItem('departments', JSON.stringify(all));

  // ── Supabase ──
  try {
    const payload = {
      id:         department.id,
      chain_id:   department.chainId,
      name:       department.name,
      sort_order: department.sortOrder ?? 0,
    };

    const { error } = await supabase
      .from('departments')
      .upsert(payload, { onConflict: 'id' });

    if (error) throw error;
    log('saveDepartment ✓', department.id);
  } catch (e) {
    logError('saveDepartment (Supabase)', e);
  }

  return department;
}

export async function deleteDepartment(departmentId) {
  const all = JSON.parse(localStorage.getItem('departments') || '[]');
  localStorage.setItem('departments', JSON.stringify(all.filter(d => d.id !== departmentId)));

  try {
    const { error } = await supabase
      .from('departments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', departmentId);

    if (error) throw error;
    log('deleteDepartment ✓', departmentId);
  } catch (e) {
    logError('deleteDepartment (Supabase)', e);
  }
}


// ════════════════════════════════════════════════════════════
// MÄTPUNKTER (touchpoints)
// ════════════════════════════════════════════════════════════

export async function getTouchpoints(chainId) {
  if (READ_FROM === 'localStorage') {
    const all = JSON.parse(localStorage.getItem('touchpoints') || '[]');
    return chainId ? all.filter(t => t.chainId === chainId) : all;
  }

  const { data, error } = await supabase
    .from('touchpoints')
    .select('*')
    .eq('chain_id', chainId)
    .is('deleted_at', null)
    .order('sort_order');

  if (error) { logError('getTouchpoints', error); return []; }
  return data;
}

export async function getTouchpointById(touchpointId) {
  if (READ_FROM === 'localStorage') {
    const all = JSON.parse(localStorage.getItem('touchpoints') || '[]');
    return all.find(t => t.id === touchpointId) ?? null;
  }

  const { data, error } = await supabase
    .from('touchpoints')
    .select('*')
    .eq('id', touchpointId)
    .single();

  if (error) { logError('getTouchpointById', error); return null; }
  return data;
}

export async function saveTouchpoint(touchpoint) {
  // ── localStorage ──
  const all = JSON.parse(localStorage.getItem('touchpoints') || '[]');
  const idx = all.findIndex(t => t.id === touchpoint.id);
  if (idx >= 0) { all[idx] = touchpoint; } else { all.push(touchpoint); }
  localStorage.setItem('touchpoints', JSON.stringify(all));

  // ── Supabase ──
  try {
    const payload = {
      id:              touchpoint.id,
      chain_id:        touchpoint.chainId,
      department_id:   touchpoint.departmentId ?? null,
      name:            touchpoint.name,
      sort_order:      touchpoint.sortOrder ?? 0,
      is_active:       touchpoint.isActive ?? true,
      config_override: touchpoint.configOverride ?? null,
    };

    const { error } = await supabase
      .from('touchpoints')
      .upsert(payload, { onConflict: 'id' });

    if (error) throw error;
    log('saveTouchpoint ✓', touchpoint.id);
  } catch (e) {
    logError('saveTouchpoint (Supabase)', e);
  }

  return touchpoint;
}

export async function deleteTouchpoint(touchpointId) {
  const all = JSON.parse(localStorage.getItem('touchpoints') || '[]');
  localStorage.setItem('touchpoints', JSON.stringify(all.filter(t => t.id !== touchpointId)));

  try {
    const { error } = await supabase
      .from('touchpoints')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', touchpointId);

    if (error) throw error;
    log('deleteTouchpoint ✓', touchpointId);
  } catch (e) {
    logError('deleteTouchpoint (Supabase)', e);
  }
}


// ════════════════════════════════════════════════════════════
// SVAR (responses)
// ════════════════════════════════════════════════════════════

export async function getResponses(chainId) {
  if (READ_FROM === 'localStorage') {
    const all = JSON.parse(localStorage.getItem('responses') || '[]');
    return chainId ? all.filter(r => r.chainId === chainId) : all;
  }

  const { data, error } = await supabase
    .from('responses')
    .select('*, response_answers(*), response_comments(*)')
    .eq('chain_id', chainId)
    .order('responded_at', { ascending: false });

  if (error) { logError('getResponses', error); return []; }
  return data;
}

export async function saveResponse(response) {
  // Räkna ut NPS-kategori
  const score = response.score;
  const nps_category =
    score <= 6 ? 'detractor' :
    score <= 8 ? 'passive'   : 'promoter';

  // ── localStorage ──
  const all = JSON.parse(localStorage.getItem('responses') || '[]');
  const enriched = { ...response, nps_category };
  const idx = all.findIndex(r => r.id === response.id);
  if (idx >= 0) { all[idx] = enriched; } else { all.push(enriched); }
  localStorage.setItem('responses', JSON.stringify(all));

  // Skriv även till npsResponses-nyckeln i det format storage.js/ReportPage förväntar sig:
  // - timestamp som millisekunder (för tidsfiltrering)
  // - predefinedAnswer som sträng (inte array)
  // - customerId för kedjefiltrering
  const npsAll = JSON.parse(localStorage.getItem('npsResponses') || '[]');
  const npsEnriched = {
    id:               response.id,
    score:            score,
    comment:          response.comment || '',
    predefinedAnswer: response.selectedAnswers?.[0] || '',
    customerId:       response.chainId,
    touchpointId:     response.touchpointId,
    followUpEmail:    response.followUpEmail || '',
    timestamp:        new Date(response.respondedAt || Date.now()).getTime(),
    nps_category:     nps_category,
  };
  const npsIdx = npsAll.findIndex(r => r.id === response.id);
  if (npsIdx >= 0) { npsAll[npsIdx] = npsEnriched; } else { npsAll.push(npsEnriched); }
  localStorage.setItem('npsResponses', JSON.stringify(npsAll));

  // ── Supabase ──
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

    log('saveResponse ✓', response.id);
  } catch (e) {
    logError('saveResponse (Supabase)', e);
  }

  return enriched;
}


// ════════════════════════════════════════════════════════════
// FÖRDEFINIERADE SVAR (predefined answers)
// ════════════════════════════════════════════════════════════

export async function getPredefinedAnswers(touchpointId) {
  if (READ_FROM === 'localStorage') {
    // I nuvarande app ligger predefined answers inuti touchpoint-objektet
    const all = JSON.parse(localStorage.getItem('touchpoints') || '[]');
    const tp  = all.find(t => t.id === touchpointId);
    return tp?.predefinedAnswers ?? [];
  }

  const { data, error } = await supabase
    .from('predefined_answers')
    .select('*')
    .eq('touchpoint_id', touchpointId)
    .order('sort_order');

  if (error) { logError('getPredefinedAnswers', error); return []; }
  return data;
}

export async function savePredefinedAnswers(touchpointId, answers) {
  // ── localStorage — uppdatera inuti touchpoint-objektet ──
  const all = JSON.parse(localStorage.getItem('touchpoints') || '[]');
  const idx = all.findIndex(t => t.id === touchpointId);
  if (idx >= 0) {
    all[idx].predefinedAnswers = answers;
    localStorage.setItem('touchpoints', JSON.stringify(all));
  }

  // ── Supabase — ersätt alla svar för denna mätpunkt ──
  try {
    // Ta bort befintliga
    const { error: deleteError } = await supabase
      .from('predefined_answers')
      .delete()
      .eq('touchpoint_id', touchpointId);

    if (deleteError) throw deleteError;

    // Lägg till nya
    if (answers.length > 0) {
      const payload = answers.map((a, i) => ({
        touchpoint_id: touchpointId,
        text:          a.text,
        polarity:      a.polarity ?? 'neutral',
        sort_order:    i,
      }));

      const { error: insertError } = await supabase
        .from('predefined_answers')
        .insert(payload);

      if (insertError) throw insertError;
    }

    log('savePredefinedAnswers ✓', touchpointId);
  } catch (e) {
    logError('savePredefinedAnswers (Supabase)', e);
  }
}


// ════════════════════════════════════════════════════════════
// KEDJA-CONFIG (ärvning chain → touchpoint)
// ════════════════════════════════════════════════════════════

/**
 * Returnerar effektiv config för en mätpunkt:
 * chain.config fusionerat med touchpoint.configOverride (om det finns)
 */
export function resolveConfig(chain, touchpoint) {
  const chainConfig     = chain?.config ?? {};
  const overrideConfig  = touchpoint?.configOverride ?? null;
  return overrideConfig
    ? { ...chainConfig, ...overrideConfig }
    : chainConfig;
}


// ════════════════════════════════════════════════════════════
// MIGRERINGSVERKTYG (Fas 2)
// ════════════════════════════════════════════════════════════

/**
 * Hämtar all localStorage-data för en organisation
 * och returnerar den som ett strukturerat objekt.
 * Används av migreringsverktyget i Fas 2.
 */
export function getAllLocalStorageData(organizationId) {
  return {
    chains:      JSON.parse(localStorage.getItem('chains')      || '[]'),
    departments: JSON.parse(localStorage.getItem('departments') || '[]'),
    touchpoints: JSON.parse(localStorage.getItem('touchpoints') || '[]'),
    responses:   JSON.parse(localStorage.getItem('responses')   || '[]'),
    exportedAt:  new Date().toISOString(),
    organizationId,
  };
}


// ════════════════════════════════════════════════════════════
// ASSEMBLY — Bygger ihop nästlat format för komponenter
// ════════════════════════════════════════════════════════════

/**
 * Intern hjälpfunktion.
 * Konverterar Supabase-rader till det nästlade format
 * som SurveyPage, ReportPage och SettingsPage förväntar sig.
 */
function assembleChain(chain, departments, touchpoints) {
  // activeTouchpointId är UI-state (per-användare/per-enhet) och lever i
  // localStorage — settings.js skriver till nyckeln 'npsActiveTouchpointByChain'.
  // Vi läser här så att chain-objektet alltid innehåller rätt aktiv mätpunkt
  // direkt från Supabase-laddningen, utan att App.js behöver merge:a separat.
  let activeTouchpointId = null;
  try {
    const map = JSON.parse(localStorage.getItem('npsActiveTouchpointByChain') || '{}');
    activeTouchpointId = map[chain.id] ?? null;
  } catch { /* ignore */ }

  return {
    id:           chain.id,
    name:         chain.name,
    customLogo:   chain.custom_logo || null,
    // Config-block — null-värden hanteras av getEffectiveConfig i settings.js
    physicalConfig: chain.config?.physicalConfig || null,
    onlineConfig:   chain.config?.onlineConfig   || null,
    otherConfig:    chain.config?.otherConfig     || null,
    enpsConfig:     chain.config?.enpsConfig      || null,
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
 * och bygger ihop dem i nästlat format.
 * Accepterar ett enskilt ID (string) eller flera (array).
 * Använder 3 queries (inte N+1) för effektivitet.
 */
export async function getAssembledCustomers(organizationId) {
  try {
    const orgIds = Array.isArray(organizationId) ? organizationId : [organizationId];
    if (orgIds.length === 0) return [];

    // 1 — Hämta alla kedjor för organisationerna
    const { data: chains = [], error: chainsError } = await supabase
      .from('chains')
      .select('*')
      .in('organization_id', orgIds)
      .is('deleted_at', null)
      .order('sort_order');

    if (chainsError) throw chainsError;
    if (chains.length === 0) return [];

    const chainIds = chains.map(c => c.id);

    // 2 — Hämta alla avdelningar för dessa kedjor
    const { data: allDepartments = [] } = await supabase
      .from('departments')
      .select('*')
      .in('chain_id', chainIds)
      .is('deleted_at', null)
      .order('sort_order');

    // 3 — Hämta alla mätpunkter för dessa kedjor
    const { data: allTouchpoints = [] } = await supabase
      .from('touchpoints')
      .select('*')
      .in('chain_id', chainIds)
      .is('deleted_at', null)
      .order('sort_order');

    // Bygg ihop nästlat format per kedja
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

/**
 * Hämtar och bygger ihop en enskild kedja från Supabase.
 * Används när en specifik kedja behöver laddas om.
 */
export async function getAssembledChain(chainId) {
  try {
    const { data: chain, error } = await supabase
      .from('chains')
      .select('*')
      .eq('id', chainId)
      .is('deleted_at', null)
      .single();

    if (error || !chain) return null;

    const { data: departments = [] } = await supabase
      .from('departments')
      .select('*')
      .eq('chain_id', chainId)
      .is('deleted_at', null)
      .order('sort_order');

    const { data: touchpoints = [] } = await supabase
      .from('touchpoints')
      .select('*')
      .eq('chain_id', chainId)
      .is('deleted_at', null)
      .order('sort_order');

    return assembleChain(chain, departments, touchpoints);
  } catch (e) {
    logError('getAssembledChain', e);
    return null;
  }
}


// ════════════════════════════════════════════════════════════
// RAPPORT-HYDRERING
// ════════════════════════════════════════════════════════════

/**
 * Hämtar alla svar för en kedja från Supabase och skriver dem
 * till npsResponses i localStorage (i det format ReportPage förväntar sig).
 * Supabase är källan till sanning — localStorage fungerar som lokal cache.
 */
export async function hydrateResponsesFromSupabase(chainId) {
  if (!chainId) return;
  try {
    const { data: responses = [], error } = await supabase
      .from('responses')
      .select('*, response_answers(answer_text), response_comments(*)')
      .eq('chain_id', chainId)
      .order('responded_at', { ascending: false });

    if (error) throw error;

    // Transformera Supabase-format → storage.js-format som ReportPage förväntar sig
    const formatted = responses.map(r => ({
      id:               r.id,
      score:            r.score,
      comment:          r.response_comments?.[0]?.comment || '',
      predefinedAnswer: r.response_answers?.[0]?.answer_text || '',
      customerId:       r.chain_id,
      touchpointId:     r.touchpoint_id,
      timestamp:        new Date(r.responded_at).getTime(),
      followUpEmail:    r.metadata?.followUpEmail || '',
      nps_category:     r.nps_category,
    }));

    // Skriv till npsResponses — Supabase är master, ersätt helt
    localStorage.setItem('npsResponses', JSON.stringify(formatted));
    log('hydrateResponsesFromSupabase ✓', formatted.length, 'svar för kedja', chainId);
  } catch (e) {
    logError('hydrateResponsesFromSupabase', e);
  }
}