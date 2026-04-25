// src/utils/migrateToSupabase.js
import { supabase } from './supabaseClient';

// ─── Helpers ────────────────────────────────────────────────

function calcNpsCategory(score) {
  if (score <= 6) return 'detractor';
  if (score <= 8) return 'passive';
  return 'promoter';
}

function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Läs localStorage ────────────────────────────────────────

export function readLocalStorageData() {
  const chains    = JSON.parse(localStorage.getItem('npsCustomers') || '[]');
  const responses = JSON.parse(localStorage.getItem('npsResponses') || '[]');
  return { chains, responses };
}

export function getMigrationSummary() {
  const { chains, responses } = readLocalStorageData();
  const realChains = chains.filter(c => c.id !== 'demo');
  const totalDepts = realChains.reduce((n, c) => n + (c.departments || []).length, 0);
  const totalTps   = realChains.reduce((n, c) => n + (c.touchpoints  || []).length, 0);
  const migratable = responses.filter((r) => r.customerId && r.touchpointId && r.customerId !== 'demo');
  return {
    chains:      realChains.length,
    departments: totalDepts,
    touchpoints: totalTps,
    responses:   responses.length,
    migratable:  migratable.length,
    skipped:     responses.length - migratable.length,
    alreadyDone: !!localStorage.getItem('migrated_at'),
  };
}

// ─── Huvudfunktion ───────────────────────────────────────────

export async function migrateToSupabase(onProgress) {
  const log = (msg, pct) => { console.log('[migrate]', msg); onProgress?.(msg, pct); };

  // ── Kontrollera session ──
  log('Kontrollerar session...', 2);
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    return {
      success: false,
      migrated: 0,
      skipped: 0,
      errors: ['Ingen aktiv session — logga ut och in igen och försök på nytt.'],
    };
  }
  log(`Inloggad som: ${session.user.email}`, 5);

  const { chains, responses } = readLocalStorageData();
  const realChains = chains.filter(c => c.id !== 'demo');
  const errors = [];

  // ── 1. Organisationer ──
  log('Migrerar organisationer...', 10);
  for (const chain of realChains) {
    const slug = toSlug(chain.name) || chain.id;
    const { error } = await supabase
      .from('organizations')
      .upsert({
        id:       chain.id,
        slug:     slug,
        name:     chain.name,
        locale:   'sv',
        settings: { customLogo: chain.customLogo || null },
      }, { onConflict: 'id' });

    if (error) {
      console.error('[migrate] Organisation fel:', error);
      // Tidig avbrytning om RLS blockerar
      if (error.message?.includes('row-level security')) {
        return {
          success: false,
          migrated: 0,
          skipped: 0,
          errors: [
            '⚠ RLS blockerar insättningar. Kör SQL-kommandona nedan i Supabase SQL Editor, sedan migration igen:',
            'ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;',
            'ALTER TABLE chains DISABLE ROW LEVEL SECURITY;',
            'ALTER TABLE departments DISABLE ROW LEVEL SECURITY;',
            'ALTER TABLE touchpoints DISABLE ROW LEVEL SECURITY;',
            'ALTER TABLE responses DISABLE ROW LEVEL SECURITY;',
            'ALTER TABLE response_comments DISABLE ROW LEVEL SECURITY;',
          ],
        };
      }
      errors.push(`Organisation "${chain.name}": ${error.message}`);
    }
  }

  // ── 2. Kedjor ──
  log('Migrerar kedjor...', 25);
  for (const chain of realChains) {
    const config = {
      physicalConfig: chain.physicalConfig || {},
      onlineConfig:   chain.onlineConfig   || {},
      otherConfig:    chain.otherConfig    || {},
      enpsConfig:     chain.enpsConfig     || {},
    };

    const { error } = await supabase
      .from('chains')
      .upsert({
        id:              chain.id,
        organization_id: chain.id,
        name:            chain.name,
        config:          config,
        sort_order:      0,
        is_active:       true,
      }, { onConflict: 'id' });

    if (error) errors.push(`Kedja "${chain.name}": ${error.message}`);
  }

  // ── 3. Avdelningar ──
  log('Migrerar avdelningar...', 40);
  for (const chain of realChains) {
    for (const dept of (chain.departments || [])) {
      const { error } = await supabase
        .from('departments')
        .upsert({
          id:         dept.id,
          chain_id:   chain.id,
          name:       dept.name,
          sort_order: dept.order ?? 0,
        }, { onConflict: 'id' });

      if (error) errors.push(`Avdelning "${dept.name}": ${error.message}`);
    }
  }

  // ── 4. Mätpunkter ──
  log('Migrerar mätpunkter...', 55);
  for (const chain of realChains) {
    for (const tp of (chain.touchpoints || [])) {
      const configOverride = {
        type: tp.type || 'physical',
        mode: tp.mode || 'app',
        ...(tp.configOverride || {}),
      };

      const { error } = await supabase
        .from('touchpoints')
        .upsert({
          id:              tp.id,
          chain_id:        chain.id,
          department_id:   tp.departmentId || null,
          name:            tp.name,
          sort_order:      tp.order ?? 0,
          is_active:       true,
          config_override: configOverride,
        }, { onConflict: 'id' });

      if (error) errors.push(`Mätpunkt "${tp.name}": ${error.message}`);
    }
  }

  // ── 5. Svar ──
  log('Migrerar svar...', 70);
  const migratable = responses.filter(
    (r) => r.customerId && r.touchpointId && r.customerId !== 'demo'
  );
  let migrated = 0;

  for (const resp of migratable) {
    const respondedAt = resp.timestamp
      ? new Date(resp.timestamp).toISOString()
      : new Date().toISOString();

    const { data: inserted, error: respErr } = await supabase
      .from('responses')
      .upsert({
        id:            resp.id,
        touchpoint_id: resp.touchpointId,
        chain_id:      resp.customerId,
        score:         resp.score,
        nps_category:  calcNpsCategory(resp.score),
        session_id:    resp.id,
        responded_at:  respondedAt,
        metadata:      {},
      }, { onConflict: 'id' })
      .select()
      .single();

    if (respErr) {
      errors.push(`Svar ${resp.id}: ${respErr.message}`);
      continue;
    }

    if (resp.comment?.trim()) {
      const { error: commentErr } = await supabase
        .from('response_comments')
        .upsert({
          response_id: inserted.id,
          comment:     resp.comment.trim(),
        }, { onConflict: 'response_id' });

      if (commentErr) errors.push(`Kommentar för svar ${resp.id}: ${commentErr.message}`);
    }

    migrated++;
  }

  // ── 6. Markera som migrerat ──
  log('Slutför...', 95);
  localStorage.setItem('migrated_at', new Date().toISOString());
  localStorage.setItem('migration_errors', JSON.stringify(errors));

  log('Klar!', 100);
  return {
    success:  errors.length === 0,
    migrated,
    skipped:  responses.length - migratable.length,
    errors,
  };
}
