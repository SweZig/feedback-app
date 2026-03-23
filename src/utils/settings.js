const CHAINS_KEY = 'npsCustomers';
const ACTIVE_KEY = 'npsActiveCustomerId';
const DEMO_ID = 'demo';

export const TYPE_LABELS = {
  physical: 'Fysisk plats',
  online: 'Online',
  other: 'Övriga',
  enps: 'eNPS',
};

const DEFAULT_NPS_QUESTION = 'På en skala från 0–10, hur troligt är det att du skulle rekommendera oss till vänner och bekanta?';

const DEFAULT_PREDEFINED_ANSWERS = [
  { text: 'Jag fick dålig service', polarity: 'negative' },
  { text: 'Butiken gav ett rörigt intryck', polarity: 'negative' },
  { text: 'Det var för lång väntetid', polarity: 'negative' },
  { text: 'Jag fick ej hjälp när jag behövde', polarity: 'negative' },
  { text: 'Jag fann inte produkten jag sökte', polarity: 'negative' },
  { text: 'Inget av ovanstående', polarity: null },
];

export const MODE_LABELS = {
  app: 'Enkät',
  qr: 'QR-kod',
  link: 'Webblänk',
  embed: 'Inbäddad kod',
};

const DEFAULT_PHYSICAL_CONFIG = {
  npsColorMode: 'colored',
  npsQuestion: DEFAULT_NPS_QUESTION,
  freeTextEnabled: true,
  countdownSeconds: 6,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_PREDEFINED_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

const DEFAULT_ONLINE_CONFIG = {
  npsQuestion: DEFAULT_NPS_QUESTION,
  freeTextEnabled: true,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_PREDEFINED_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

const DEFAULT_OTHER_CONFIG = {
  npsQuestion: DEFAULT_NPS_QUESTION,
  freeTextEnabled: true,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_PREDEFINED_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

const DEFAULT_ENPS_CONFIG = {
  npsQuestion: 'På en skala från 0–10, hur troligt är det att du skulle rekommendera oss som arbetsgivare till en vän eller kollega?',
  freeTextEnabled: true,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_PREDEFINED_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

export function getDefaultConfig(type) {
  if (type === 'physical') return { ...DEFAULT_PHYSICAL_CONFIG };
  if (type === 'online') return { ...DEFAULT_ONLINE_CONFIG };
  if (type === 'enps') return { ...DEFAULT_ENPS_CONFIG };
  return { ...DEFAULT_OTHER_CONFIG };
}

// Chain config is the base, configOverride is layered on top.
// This ensures followUpEnabled (and all other chain-level settings) always flow through.
export function getEffectiveConfig(chain, touchpointId) {
  const tp = (chain?.touchpoints || []).find((t) => t.id === touchpointId);
  if (!tp) return { ...DEFAULT_PHYSICAL_CONFIG };
  const type = tp.type || 'physical';
  const chainConfig =
    type === 'physical'
      ? { ...DEFAULT_PHYSICAL_CONFIG, ...(chain?.physicalConfig || {}) }
      : type === 'online'
      ? { ...DEFAULT_ONLINE_CONFIG, ...(chain?.onlineConfig || {}) }
      : type === 'enps'
      ? { ...DEFAULT_ENPS_CONFIG, ...(chain?.enpsConfig || {}) }
      : { ...DEFAULT_OTHER_CONFIG, ...(chain?.otherConfig || {}) };
  // configOverride overrides individual settings on top of chain config
  return { ...chainConfig, ...(tp.configOverride || {}) };
}

function createDemoChain() {
  return {
    id: DEMO_ID,
    name: 'Demo',
    customLogo: null,
    physicalConfig: { ...DEFAULT_PHYSICAL_CONFIG },
    onlineConfig: { ...DEFAULT_ONLINE_CONFIG },
    otherConfig: { ...DEFAULT_OTHER_CONFIG },
    enpsConfig: { ...DEFAULT_ENPS_CONFIG },
    departments: [],
    touchpoints: [],
    activeTouchpointId: null,
  };
}

function migrateAnswers(answers) {
  return (answers || []).map((a) => (typeof a === 'string' ? { text: a, polarity: null } : a));
}

function migrateChain(c) {
  const oldDeptTypeMap = {};
  (c.departments || []).forEach((d) => { if (d.type) oldDeptTypeMap[d.id] = d.type; });
  const touchpoints = (c.touchpoints || []).map((t, i) => ({
    mode: 'app', order: i, type: t.type || oldDeptTypeMap[t.departmentId] || 'physical', configOverride: null, ...t,
  }));
  const departments = (c.departments || []).map((d, i) => ({
    id: d.id, name: d.name, uniqueCode: d.uniqueCode || '', order: typeof d.order === 'number' ? d.order : i,
  }));
  const physicalConfig = { ...DEFAULT_PHYSICAL_CONFIG, ...(c.physicalConfig || {}) };
  physicalConfig.predefinedAnswers = migrateAnswers(physicalConfig.predefinedAnswers);
  const onlineConfig = { ...DEFAULT_ONLINE_CONFIG, ...(c.onlineConfig || {}) };
  onlineConfig.predefinedAnswers = migrateAnswers(onlineConfig.predefinedAnswers);
  const otherConfig = { ...DEFAULT_OTHER_CONFIG, ...(c.otherConfig || {}) };
  otherConfig.predefinedAnswers = migrateAnswers(otherConfig.predefinedAnswers);
  const enpsConfig = { ...DEFAULT_ENPS_CONFIG, ...(c.enpsConfig || {}) };
  enpsConfig.predefinedAnswers = migrateAnswers(enpsConfig.predefinedAnswers);
  // Migrate predefinedAnswers in touchpoint configOverrides
  const migratedTouchpoints = touchpoints.map((t) => {
    if (!t.configOverride) return t;
    return { ...t, configOverride: { ...t.configOverride, predefinedAnswers: migrateAnswers(t.configOverride.predefinedAnswers) } };
  });
  return {
    customLogo: null, activeTouchpointId: null,
    ...c,
    physicalConfig, onlineConfig, otherConfig, enpsConfig,
    departments, touchpoints: migratedTouchpoints,
  };
}

function saveChains(chains) {
  localStorage.setItem(CHAINS_KEY, JSON.stringify(chains));
}

export function getChains() {
  try {
    const data = localStorage.getItem(CHAINS_KEY);
    const chains = data ? JSON.parse(data) : [];
    const migrated = chains.map(migrateChain);
    if (!migrated.find((c) => c.id === DEMO_ID)) {
      migrated.unshift(createDemoChain());
      saveChains(migrated);
    }
    const demo = migrated.find((c) => c.id === DEMO_ID);
    const rest = migrated.filter((c) => c.id !== DEMO_ID);
    return [demo, ...rest];
  } catch { return [createDemoChain()]; }
}

export const getCustomers = getChains;
export const DEMO_CUSTOMER_ID = DEMO_ID;
export const DEMO_CHAIN_ID = DEMO_ID;

export function getActiveChainId() { return localStorage.getItem(ACTIVE_KEY); }
export const getActiveCustomerId = getActiveChainId;

export function setActiveChainId(id) { localStorage.setItem(ACTIVE_KEY, id); }
export const setActiveCustomerId = setActiveChainId;

export function getActiveChain() {
  const id = getActiveChainId();
  const chains = getChains();
  if (!id) { setActiveChainId(DEMO_ID); return chains.find((c) => c.id === DEMO_ID) || null; }
  return chains.find((c) => c.id === id) || chains[0] || null;
}
export const getActiveCustomer = getActiveChain;

export function addChain(name) {
  const chains = getChains();
  const chain = {
    id: crypto.randomUUID(), name, customLogo: null,
    physicalConfig: { ...DEFAULT_PHYSICAL_CONFIG },
    onlineConfig: { ...DEFAULT_ONLINE_CONFIG },
    otherConfig: { ...DEFAULT_OTHER_CONFIG },
    enpsConfig: { ...DEFAULT_ENPS_CONFIG },
    departments: [], touchpoints: [], activeTouchpointId: null,
  };
  chains.push(chain);
  saveChains(chains);
  setActiveChainId(chain.id);
  return chain;
}
export const addCustomer = addChain;

export function updateChain(id, updates) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  chains[idx] = { ...chains[idx], ...updates };
  saveChains(chains);
  return chains[idx];
}
export const updateCustomer = updateChain;

export function reorderChains(orderedIds) {
  const chains = getChains();
  const map = Object.fromEntries(chains.map((c) => [c.id, c]));
  saveChains([map[DEMO_ID], ...orderedIds.filter((id) => id !== DEMO_ID).map((id) => map[id]).filter(Boolean)]);
}
export const reorderCustomers = reorderChains;

export function deleteChain(id) {
  if (id === DEMO_ID) return;
  const chains = getChains().filter((c) => c.id !== id);
  saveChains(chains);
  if (getActiveChainId() === id) localStorage.setItem(ACTIVE_KEY, chains[0]?.id || '');
}
export const deleteCustomer = deleteChain;

export function addDepartment(chainId, name, uniqueCode) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return null;
  const depts = chains[idx].departments || [];
  const dept = { id: crypto.randomUUID(), name, uniqueCode: uniqueCode || '', order: depts.length };
  chains[idx] = { ...chains[idx], departments: [...depts, dept] };
  saveChains(chains);
  return dept;
}

export function updateDepartment(chainId, deptId, updates) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  chains[idx].departments = (chains[idx].departments || []).map((d) =>
    d.id === deptId ? { ...d, ...updates } : d
  );
  saveChains(chains);
}

export function deleteDepartment(chainId, deptId) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  const departments = (chains[idx].departments || []).filter((d) => d.id !== deptId);
  const removedTpIds = new Set(
    (chains[idx].touchpoints || []).filter((t) => t.departmentId === deptId).map((t) => t.id)
  );
  const touchpoints = (chains[idx].touchpoints || []).filter((t) => t.departmentId !== deptId);
  const activeTouchpointId = removedTpIds.has(chains[idx].activeTouchpointId)
    ? null : chains[idx].activeTouchpointId;
  chains[idx] = { ...chains[idx], departments, touchpoints, activeTouchpointId };
  saveChains(chains);
}

export function reorderDepartments(chainId, orderedIds) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  const map = Object.fromEntries((chains[idx].departments || []).map((d) => [d.id, d]));
  chains[idx].departments = orderedIds.map((id, i) => ({ ...map[id], order: i })).filter(Boolean);
  saveChains(chains);
}

export function migrateTouchpointsFromDept(chainId, sourceDeptId) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return { added: 0, skipped: 0 };
  const chain = chains[idx];
  const sourceTps = (chain.touchpoints || [])
    .filter((t) => t.departmentId === sourceDeptId)
    .sort((a, b) => a.order - b.order);
  if (sourceTps.length === 0) return { added: 0, skipped: 0 };
  const otherDepts = (chain.departments || []).filter((d) => d.id !== sourceDeptId);
  let added = 0; let skipped = 0;
  let allTps = [...(chain.touchpoints || [])];
  otherDepts.forEach((dept) => {
    const existingNames = new Set(allTps.filter((t) => t.departmentId === dept.id).map((t) => t.name.toLowerCase()));
    const deptTpCount = allTps.filter((t) => t.departmentId === dept.id).length;
    sourceTps.forEach((srcTp, i) => {
      if (existingNames.has(srcTp.name.toLowerCase())) { skipped++; return; }
      allTps.push({ id: crypto.randomUUID(), name: srcTp.name, departmentId: dept.id, type: srcTp.type, mode: srcTp.mode, order: deptTpCount + i, configOverride: null });
      added++;
    });
  });
  chains[idx] = { ...chains[idx], touchpoints: allTps };
  saveChains(chains);
  return { added, skipped };
}

export function addTouchpoint(chainId, name, departmentId, type = 'physical') {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return null;
  const tps = chains[idx].touchpoints || [];
  const deptTps = tps.filter((t) => t.departmentId === departmentId);
  const tp = { id: crypto.randomUUID(), name, departmentId, type, mode: 'app', order: deptTps.length, configOverride: null };
  chains[idx] = { ...chains[idx], touchpoints: [...tps, tp] };
  saveChains(chains);
  return tp;
}

export function updateTouchpoint(chainId, tpId, updates) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  chains[idx].touchpoints = (chains[idx].touchpoints || []).map((t) =>
    t.id === tpId ? { ...t, ...updates } : t
  );
  saveChains(chains);
}

export function deleteTouchpoint(chainId, tpId) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  const touchpoints = (chains[idx].touchpoints || []).filter((t) => t.id !== tpId);
  const activeTouchpointId = chains[idx].activeTouchpointId === tpId ? null : chains[idx].activeTouchpointId;
  chains[idx] = { ...chains[idx], touchpoints, activeTouchpointId };
  saveChains(chains);
}

export function reorderTouchpoints(chainId, departmentId, orderedIds) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  const other = (chains[idx].touchpoints || []).filter((t) => t.departmentId !== departmentId);
  const map = Object.fromEntries(
    (chains[idx].touchpoints || []).filter((t) => t.departmentId === departmentId).map((t) => [t.id, t])
  );
  chains[idx].touchpoints = [...other, ...orderedIds.map((id, i) => ({ ...map[id], order: i })).filter(Boolean)];
  saveChains(chains);
}

export function setActiveTouchpoint(chainId, tpId) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  chains[idx] = { ...chains[idx], activeTouchpointId: tpId };
  saveChains(chains);
}

export function applyConfigToType(chainId, type) {
  const chains = getChains();
  const idx = chains.findIndex((c) => c.id === chainId);
  if (idx === -1) return;
  const chain = chains[idx];
  const configKey = type === 'physical' ? 'physicalConfig' : type === 'online' ? 'onlineConfig' : 'otherConfig';
  const config = chain[configKey] || getDefaultConfig(type);
  chains[idx].touchpoints = (chain.touchpoints || []).map((t) =>
    t.type === type ? { ...t, configOverride: { ...config } } : t
  );
  saveChains(chains);
}

export function getTouchpointUrl(tpId) {
  return `${window.location.origin}${window.location.pathname}?tp=${tpId}`;
}
