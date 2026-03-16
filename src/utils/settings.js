const CUSTOMERS_KEY = 'npsCustomers';
const ACTIVE_KEY = 'npsActiveCustomerId';
const DEMO_ID = 'demo';

function createDemoCustomer() {
  return {
    id: DEMO_ID,
    name: 'Demo',
    npsColorMode: 'colored',
    freeTextEnabled: true,
    countdownSeconds: 6,
    predefinedAnswersEnabled: false,
    predefinedAnswers: [],
    customLogo: null,
  };
}

export function getCustomers() {
  try {
    const data = localStorage.getItem(CUSTOMERS_KEY);
    const customers = data ? JSON.parse(data) : [];
    if (!customers.find((c) => c.id === DEMO_ID)) {
      customers.unshift(createDemoCustomer());
      saveCustomers(customers);
    }
    const demo = customers.find((c) => c.id === DEMO_ID);
    const rest = customers.filter((c) => c.id !== DEMO_ID);
    return [demo, ...rest];
  } catch {
    return [createDemoCustomer()];
  }
}

export const DEMO_CUSTOMER_ID = DEMO_ID;

function saveCustomers(customers) {
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
}

export function getActiveCustomerId() {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveCustomerId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveCustomer() {
  const id = getActiveCustomerId();
  const customers = getCustomers();
  if (!id) {
    setActiveCustomerId(DEMO_ID);
    return customers.find((c) => c.id === DEMO_ID) || null;
  }
  return customers.find((c) => c.id === id) || customers[0] || null;
}

export function addCustomer(name) {
  const customers = getCustomers();
  const customer = {
    id: crypto.randomUUID(),
    name,
    npsColorMode: 'colored',
    freeTextEnabled: true,
    countdownSeconds: 6,
    predefinedAnswersEnabled: false,
    predefinedAnswers: [],
    customLogo: null,
  };
  customers.push(customer);
  saveCustomers(customers);
  setActiveCustomerId(customer.id);
  return customer;
}

export function updateCustomer(id, updates) {
  const customers = getCustomers();
  const index = customers.findIndex((c) => c.id === id);
  if (index === -1) return null;
  customers[index] = { ...customers[index], ...updates };
  saveCustomers(customers);
  return customers[index];
}

export function reorderCustomers(orderedIds) {
  const customers = getCustomers();
  const map = Object.fromEntries(customers.map((c) => [c.id, c]));
  const demo = map[DEMO_ID];
  const reordered = [demo, ...orderedIds.filter((id) => id !== DEMO_ID).map((id) => map[id]).filter(Boolean)];
  saveCustomers(reordered);
}

export function deleteCustomer(id) {
  if (id === DEMO_ID) return;
  const customers = getCustomers().filter((c) => c.id !== id);
  saveCustomers(customers);
  if (getActiveCustomerId() === id) {
    const next = customers[0];
    localStorage.setItem(ACTIVE_KEY, next ? next.id : '');
  }
}
