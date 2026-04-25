const STORAGE_KEY = 'npsResponses';

export function getResponses() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

export function addResponse(score, comment, customerId, predefinedAnswer, touchpointId, followUpEmail) {
  const responses = getResponses();
  const newResponse = {
    id: crypto.randomUUID(),
    score,
    comment: comment || '',
    predefinedAnswer: predefinedAnswer || '',
    customerId: customerId || null,
    touchpointId: touchpointId || null,
    followUpEmail: followUpEmail || '',
    timestamp: Date.now(),
  };
  responses.push(newResponse);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(responses));
  return newResponse;
}

function applyFilters(responses, { customerId, touchpointIds }) {
  if (customerId) responses = responses.filter((r) => r.customerId === customerId);
  if (touchpointIds !== null) responses = responses.filter((r) => touchpointIds.includes(r.touchpointId));
  return responses;
}

export function getFilteredResponses(days, customerId, touchpointIds = null) {
  let responses = applyFilters(getResponses(), { customerId, touchpointIds });
  if (!days) return responses;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return responses.filter((r) => r.timestamp >= cutoff);
}

export function getResponsesByDateRange(from, to, customerId, touchpointIds = null) {
  let responses = applyFilters(getResponses(), { customerId, touchpointIds });
  const fromTs = from ? new Date(from).getTime() : 0;
  const toTs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;
  return responses.filter((r) => r.timestamp >= fromTs && r.timestamp <= toTs);
}

export function resetChainResponses(chainId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getResponses().filter((r) => r.customerId !== chainId)));
    return true;
  } catch { return false; }
}

export function resetTouchpointResponses(touchpointId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getResponses().filter((r) => r.touchpointId !== touchpointId)));
    return true;
  } catch { return false; }
}
