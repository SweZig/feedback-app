const STORAGE_KEY = 'npsResponses';

export function getResponses() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function addResponse(score, comment, customerId, predefinedAnswer) {
  const responses = getResponses();
  const newResponse = {
    id: crypto.randomUUID(),
    score,
    comment: comment || '',
    predefinedAnswer: predefinedAnswer || '',
    customerId: customerId || null,
    timestamp: Date.now(),
  };
  responses.push(newResponse);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(responses));
  return newResponse;
}

function filterByCustomer(responses, customerId) {
  if (!customerId) return responses;
  return responses.filter((r) => r.customerId === customerId);
}

export function getFilteredResponses(days, customerId) {
  let responses = filterByCustomer(getResponses(), customerId);
  if (!days) return responses;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return responses.filter((r) => r.timestamp >= cutoff);
}

export function getResponsesByDateRange(from, to, customerId) {
  let responses = filterByCustomer(getResponses(), customerId);
  const fromTs = from ? new Date(from).getTime() : 0;
  const toTs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;
  return responses.filter((r) => r.timestamp >= fromTs && r.timestamp <= toTs);
}
