// src/utils/chainOperations.js
//
// Sprint B: Alla CRUD-operationer för kedjor, avdelningar och mätpunkter
// kör direkt mot Supabase. Inga localStorage-anrop, ingen dual-write.
//
// Kontrakt:
//   - Alla funktioner är async.
//   - Vid fel kastas ett Error med svensk text — anroparen (SettingsPage)
//     fångar och visar `alert("Fel: " + e.message)`.
//   - addX returnerar det nya objektet i nästlat UI-format så att
//     SettingsPage kan göra t.ex. setExpandedDeptId(dept.id) direkt.
//   - update/delete/reorder returnerar void.
//   - Soft-delete används genomgående (sätter deleted_at). Hård-delete
//     bara för responses/answers/comments via reset*-funktionerna.

import { supabase } from './supabaseClient';

// ────────────────────────────────────────────
// Hjälpare — Supabase-rad → nästlat UI-format
// ────────────────────────────────────────────

/**
 * Genererar en URL-vänlig slug från ett namn + de första 8 tecknen av
 * en UUID. UUID-suffixet garanterar unikhet även när två kedjor har
 * samma eller liknande namn.
 *   "ICA Stockholm" + uuid abc12345-... → "ica-stockholm-abc12345"
 *   "Företag åäö"   + uuid def67890-... → "foretag-aao-def67890"
 */
function generateSlug(name, id) {
  const base = (name || '')
    .toLowerCase()
    .normalize('NFD')                  // dela upp accenter (å → a + ̊)
    .replace(/[\u0300-\u036f]/g, '')   // ta bort accenttecknen
    .replace(/[^a-z0-9]+/g, '-')       // icke-alfanumeriskt → bindestreck
    .replace(/^-+|-+$/g, '');          // trimma bindestreck från kanter
  const shortId = id.slice(0, 8);
  return base ? `${base}-${shortId}` : shortId;
}

function rowToChain(row) {
  return {
    id: row.id,
    name: row.name,
    customLogo: row.custom_logo || null,
    physicalConfig: row.config?.physicalConfig || null,
    onlineConfig:   row.config?.onlineConfig   || null,
    otherConfig:    row.config?.otherConfig    || null,
    enpsConfig:     row.config?.enpsConfig     || null,
    departments: [],
    touchpoints: [],
  };
}

function rowToDepartment(row) {
  return {
    id: row.id,
    name: row.name,
    uniqueCode: row.unique_code || '',
    order: row.sort_order || 0,
  };
}

function rowToTouchpoint(row) {
  return {
    id: row.id,
    name: row.name,
    departmentId: row.department_id,
    chainId: row.chain_id,
    type: row.type || 'physical',
    mode: row.mode || 'app',
    order: row.sort_order || 0,
    configOverride: row.config_override || null,
    access_token: row.access_token || null,
  };
}


// ════════════════════════════════════════════
// KEDJOR
// ════════════════════════════════════════════

export async function addChain(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Kedjans namn får inte vara tomt');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Ingen inloggad användare');

  const newId = crypto.randomUUID();
  const slug = generateSlug(trimmed, newId);

  // 1 — Organization
  // Triggern `trg_add_owner_on_new_org` skapar automatiskt en
  // `org_members`-rad med role='owner' för auth.uid() här, så vi
  // behöver inte (och får inte) göra det manuellt.
  const { error: orgErr } = await supabase
    .from('organizations')
    .insert({ id: newId, name: trimmed, slug });
  if (orgErr) throw new Error(`Kunde inte skapa organisation (${orgErr.message})`);

  // 2 — Chain (id = organization_id, 1-till-1)
  const { data: chainRow, error: chainErr } = await supabase
    .from('chains')
    .insert({
      id: newId,
      organization_id: newId,
      name: trimmed,
      config: {},
      sort_order: 0,
      is_active: true,
    })
    .select()
    .single();
  if (chainErr) {
    // Rulla tillbaka. Triggern skapade en org_members-rad — vi är owner
    // på den nyss skapade organisationen, så DELETE-policyn tillåter oss
    // att städa den. Sedan tar vi bort organisationen.
    await supabase.from('org_members').delete().eq('organization_id', newId);
    await supabase.from('organizations').delete().eq('id', newId);
    throw new Error(`Kunde inte skapa kedja (${chainErr.message})`);
  }

  return rowToChain(chainRow);
}

/**
 * Generisk uppdatering av en kedja.
 * updates kan innehålla: name, customLogo, config, sortOrder.
 * Övriga fält ignoreras.
 */
export async function updateChain(chainId, updates) {
  const payload = {};
  if (updates.name       !== undefined) payload.name        = updates.name;
  if (updates.customLogo !== undefined) payload.custom_logo = updates.customLogo;
  if (updates.config     !== undefined) payload.config      = updates.config;
  if (updates.sortOrder  !== undefined) payload.sort_order  = updates.sortOrder;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase
    .from('chains')
    .update(payload)
    .eq('id', chainId);
  if (error) throw new Error(`Kunde inte uppdatera kedja (${error.message})`);
}

export async function deleteChain(chainId) {
  const { error } = await supabase
    .from('chains')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', chainId);
  if (error) throw new Error(`Kunde inte radera kedja (${error.message})`);
}

export async function reorderChains(orderedChainIds) {
  if (!orderedChainIds || orderedChainIds.length === 0) return;
  const results = await Promise.all(
    orderedChainIds.map((id, i) =>
      supabase.from('chains').update({ sort_order: i }).eq('id', id)
    )
  );
  const failed = results.find(r => r.error);
  if (failed) throw new Error(`Kunde inte ordna om kedjor (${failed.error.message})`);
}


// ════════════════════════════════════════════
// AVDELNINGAR
// ════════════════════════════════════════════

export async function addDepartment(chainId, name, uniqueCode) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Avdelningens namn får inte vara tomt');

  // sort_order = nuvarande antal levande avdelningar i kedjan
  const { count } = await supabase
    .from('departments')
    .select('id', { count: 'exact', head: true })
    .eq('chain_id', chainId)
    .is('deleted_at', null);

  const newId = crypto.randomUUID();
  const { data, error } = await supabase
    .from('departments')
    .insert({
      id: newId,
      chain_id: chainId,
      name: trimmed,
      unique_code: (uniqueCode || '').trim(),
      sort_order: count || 0,
    })
    .select()
    .single();
  if (error) throw new Error(`Kunde inte skapa avdelning (${error.message})`);
  return rowToDepartment(data);
}

/**
 * updates kan innehålla: name, uniqueCode, order
 */
export async function updateDepartment(deptId, updates) {
  const payload = {};
  if (updates.name       !== undefined) payload.name        = updates.name;
  if (updates.uniqueCode !== undefined) payload.unique_code = updates.uniqueCode;
  if (updates.order      !== undefined) payload.sort_order  = updates.order;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase
    .from('departments')
    .update(payload)
    .eq('id', deptId);
  if (error) throw new Error(`Kunde inte uppdatera avdelning (${error.message})`);
}

export async function deleteDepartment(deptId) {
  // Soft-delete touchpoints under avdelningen FÖRST, sedan avdelningen.
  // Båda delarna måste lyckas — om touchpoints failar avstår vi från att
  // soft-deletera avdelningen för att undvika "föräldralösa" tps som
  // pekar på en raderad parent.
  const ts = new Date().toISOString();

  const { error: tpErr } = await supabase
    .from('touchpoints')
    .update({ deleted_at: ts })
    .eq('department_id', deptId)
    .is('deleted_at', null);
  if (tpErr) throw new Error(`Kunde inte radera mätpunkter under avdelningen (${tpErr.message})`);

  const { error: deptErr } = await supabase
    .from('departments')
    .update({ deleted_at: ts })
    .eq('id', deptId);
  if (deptErr) throw new Error(`Kunde inte radera avdelning (${deptErr.message})`);
}

export async function reorderDepartments(orderedDeptIds) {
  if (!orderedDeptIds || orderedDeptIds.length === 0) return;
  const results = await Promise.all(
    orderedDeptIds.map((id, i) =>
      supabase.from('departments').update({ sort_order: i }).eq('id', id)
    )
  );
  const failed = results.find(r => r.error);
  if (failed) throw new Error(`Kunde inte ordna om avdelningar (${failed.error.message})`);
}


// ════════════════════════════════════════════
// MÄTPUNKTER
// ════════════════════════════════════════════

export async function addTouchpoint(chainId, name, departmentId, type = 'physical') {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Mätpunktens namn får inte vara tomt');

  // sort_order = nuvarande antal levande tps i avdelningen
  const { count } = await supabase
    .from('touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('chain_id', chainId)
    .eq('department_id', departmentId)
    .is('deleted_at', null);

  const newId = crypto.randomUUID();
  const { data, error } = await supabase
    .from('touchpoints')
    .insert({
      id: newId,
      chain_id: chainId,
      department_id: departmentId,
      name: trimmed,
      type,
      mode: 'app',
      sort_order: count || 0,
      is_active: true,
      config_override: null,
    })
    .select()
    .single();
  if (error) throw new Error(`Kunde inte skapa mätpunkt (${error.message})`);
  return rowToTouchpoint(data);
}

/**
 * updates kan innehålla: name, type, mode, order, configOverride,
 * departmentId, access_token
 */
export async function updateTouchpoint(tpId, updates) {
  const payload = {};
  if (updates.name           !== undefined) payload.name            = updates.name;
  if (updates.type           !== undefined) payload.type            = updates.type;
  if (updates.mode           !== undefined) payload.mode            = updates.mode;
  if (updates.order          !== undefined) payload.sort_order      = updates.order;
  if (updates.configOverride !== undefined) payload.config_override = updates.configOverride;
  if (updates.departmentId   !== undefined) payload.department_id   = updates.departmentId;
  if (updates.access_token   !== undefined) payload.access_token    = updates.access_token;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase
    .from('touchpoints')
    .update(payload)
    .eq('id', tpId);
  if (error) throw new Error(`Kunde inte uppdatera mätpunkt (${error.message})`);
}

export async function deleteTouchpoint(tpId) {
  const { error } = await supabase
    .from('touchpoints')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', tpId);
  if (error) throw new Error(`Kunde inte radera mätpunkt (${error.message})`);
}

export async function reorderTouchpoints(orderedTpIds) {
  if (!orderedTpIds || orderedTpIds.length === 0) return;
  const results = await Promise.all(
    orderedTpIds.map((id, i) =>
      supabase.from('touchpoints').update({ sort_order: i }).eq('id', id)
    )
  );
  const failed = results.find(r => r.error);
  if (failed) throw new Error(`Kunde inte ordna om mätpunkter (${failed.error.message})`);
}


// ════════════════════════════════════════════
// SPECIELLA OPERATIONER
// ════════════════════════════════════════════

/**
 * Skriver kedjans config för en given typ till alla mätpunkter av
 * samma typ som configOverride. Används av "Tillämpa på alla X
 * mätpunkter"-knappen i Konfiguration-fliken.
 */
export async function applyConfigToType(chainId, type, config) {
  const { error } = await supabase
    .from('touchpoints')
    .update({ config_override: config })
    .eq('chain_id', chainId)
    .eq('type', type)
    .is('deleted_at', null);
  if (error) throw new Error(`Kunde inte tillämpa konfiguration (${error.message})`);
}

/**
 * Synkar mätpunkter från en avdelning till alla andra avdelningar i kedjan.
 * Befintliga mätpunkter (case-insensitive name match) uppdateras med samma
 * type/mode/configOverride som källan; saknas en mätpunkt skapas den.
 *
 * Returnerar { added, updated, skipped }.
 */
export async function migrateTouchpointsFromDept(chainId, sourceDeptId) {
  // 1 — Källans mätpunkter
  const { data: sourceTps = [], error: srcErr } = await supabase
    .from('touchpoints')
    .select('*')
    .eq('chain_id', chainId)
    .eq('department_id', sourceDeptId)
    .is('deleted_at', null)
    .order('sort_order');
  if (srcErr) throw new Error(`Kunde inte hämta källmätpunkter (${srcErr.message})`);
  if (sourceTps.length === 0) return { added: 0, updated: 0, skipped: 0 };

  // 2 — Övriga avdelningar
  const { data: otherDepts = [], error: deptErr } = await supabase
    .from('departments')
    .select('id')
    .eq('chain_id', chainId)
    .neq('id', sourceDeptId)
    .is('deleted_at', null);
  if (deptErr) throw new Error(`Kunde inte hämta avdelningar (${deptErr.message})`);
  if (otherDepts.length === 0) return { added: 0, updated: 0, skipped: 0 };

  // 3 — Alla existerande mätpunkter i övriga avdelningar (för match)
  const otherDeptIds = otherDepts.map(d => d.id);
  const { data: existingTps = [], error: existErr } = await supabase
    .from('touchpoints')
    .select('*')
    .eq('chain_id', chainId)
    .in('department_id', otherDeptIds)
    .is('deleted_at', null);
  if (existErr) throw new Error(`Kunde inte hämta existerande mätpunkter (${existErr.message})`);

  // 4 — Diffa: vad ska uppdateras, vad ska skapas, vad är redan identiskt
  const inserts = [];
  const updates = [];
  let added = 0, updated = 0, skipped = 0;

  for (const dept of otherDepts) {
    const deptTpCount = existingTps.filter(t => t.department_id === dept.id).length;

    sourceTps.forEach((src, i) => {
      const existing = existingTps.find(
        t => t.department_id === dept.id &&
             (t.name || '').toLowerCase() === (src.name || '').toLowerCase()
      );

      if (existing) {
        const sameType   = existing.type === src.type;
        const sameMode   = existing.mode === src.mode;
        const sameConfig = JSON.stringify(existing.config_override) === JSON.stringify(src.config_override);
        if (sameType && sameMode && sameConfig) {
          skipped++;
        } else {
          updates.push({
            id: existing.id,
            type: src.type,
            mode: src.mode,
            config_override: src.config_override,
          });
          updated++;
        }
      } else {
        inserts.push({
          id: crypto.randomUUID(),
          chain_id: chainId,
          department_id: dept.id,
          name: src.name,
          type: src.type,
          mode: src.mode,
          sort_order: deptTpCount + i,
          is_active: true,
          config_override: src.config_override,
        });
        added++;
      }
    });
  }

  // 5 — Skriv. Inserts först (en batch), sedan updates parallellt.
  if (inserts.length > 0) {
    const { error: insErr } = await supabase.from('touchpoints').insert(inserts);
    if (insErr) throw new Error(`Kunde inte skapa nya mätpunkter (${insErr.message})`);
  }
  if (updates.length > 0) {
    const updateResults = await Promise.all(
      updates.map(({ id, ...rest }) =>
        supabase.from('touchpoints').update(rest).eq('id', id)
      )
    );
    const failed = updateResults.find(r => r.error);
    if (failed) throw new Error(`Kunde inte uppdatera mätpunkt (${failed.error.message})`);
  }

  return { added, updated, skipped };
}


// ════════════════════════════════════════════
// NOLLSTÄLLNING AV SVAR
// ════════════════════════════════════════════
//
// Hård-delete (inte soft) eftersom svar inte har deleted_at-kolumn.
// FK-ordning: response_answers + response_comments först, sedan responses.

async function deleteResponsesByIds(ids) {
  if (ids.length === 0) return 0;

  const { error: ansErr } = await supabase
    .from('response_answers').delete().in('response_id', ids);
  if (ansErr) throw new Error(`Kunde inte radera svarsalternativ (${ansErr.message})`);

  const { error: comErr } = await supabase
    .from('response_comments').delete().in('response_id', ids);
  if (comErr) throw new Error(`Kunde inte radera kommentarer (${comErr.message})`);

  const { error: respErr } = await supabase
    .from('responses').delete().in('id', ids);
  if (respErr) throw new Error(`Kunde inte radera svar (${respErr.message})`);

  return ids.length;
}

export async function resetChainResponses(chainId) {
  const { data = [], error } = await supabase
    .from('responses').select('id').eq('chain_id', chainId);
  if (error) throw new Error(`Kunde inte hämta svar (${error.message})`);
  const deleted = await deleteResponsesByIds(data.map(r => r.id));
  return { deleted };
}

export async function resetTouchpointResponses(touchpointId) {
  const { data = [], error } = await supabase
    .from('responses').select('id').eq('touchpoint_id', touchpointId);
  if (error) throw new Error(`Kunde inte hämta svar (${error.message})`);
  const deleted = await deleteResponsesByIds(data.map(r => r.id));
  return { deleted };
}
