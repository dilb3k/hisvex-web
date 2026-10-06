const { test } = require('node:test'), assert = require('node:assert/strict');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadSource } = require('./helpers/load-source.cjs');
const i18n = loadSource('src/lib/i18n.ts');
const fixture = { id: 'a'.repeat(24), userId: 'u', username: '<shop>', phone: '+998901234567', telegramUserId: '123', tier: 'pro', durationMonths: 6, amount: 125000.3, method: 'manual_card', status: 'completed', createdAt: '2026-10-04T04:00:00Z', approvedAt: '2026-10-04T05:00:00Z', approvedBy: 'bot:1', hasReceipt: true, receiptAmount: 125000.3, sender: { name: 'Owner', card: '•••• 9012' }, reference: 'reference', needsReconciliation: false };
function harness({ role = 'superAdmin', pending = false, selected = false, fail = false } = {}) {
  let cursor = 0, tree; const states = [], effects = [], requests = [];
  const data = { items: [fixture, { ...fixture, id: 'b'.repeat(24), username: 'second', status: 'pending' }], summary: { total: 51, settledAmount: 125000.3, settledCount: 1, pendingAmount: 1000, pendingCount: 1, rejectedCount: 2 }, page: 1, totalPages: 3 };
  const defaults = [{}, '', 1, 0, pending ? null : data, pending, false, selected ? fixture : null, 'token'];
  const user = { role, scope: undefined }, auth = { user, token: 'token' };
  const store = Object.assign(selector => selector(auth), { getState: () => auth });
  const react = { ...require('react'), useState(initial) { const i = cursor++; if (!(i in states)) states[i] = i < defaults.length ? defaults[i] : typeof initial === 'function' ? initial() : initial; return [states[i], value => states[i] = typeof value === 'function' ? value(states[i]) : value]; }, useEffect(fn, deps) { const i = cursor++; const previous = effects[i]; if (!previous || deps.some((d, j) => d !== previous.deps[j])) { previous?.cleanup?.(); effects[i] = { fn, deps, pending: true }; } } };
  // useEffect consumes hook slots too; initialise only the state calls.
  let stateCursor = 0;
  react.useState = initial => { const i = stateCursor++; if (!(i in states)) states[i] = i < defaults.length ? defaults[i] : typeof initial === 'function' ? initial() : initial; return [states[i], value => states[i] = typeof value === 'function' ? value(states[i]) : value]; };
  const module = loadSource('src/app/dashboard/payments/page.tsx', {
    react, '@/lib/authStore': { useAuthStore: store }, '@/lib/i18n': i18n,
    '@/lib/sharedStyles': { formatMoney: value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) + " so'm" },
    '@/lib/useEscapeKey': { useEscapeToClose() {} }, '@/components/StatusViews': { ErrorBanner: () => 'retry-banner' },
    '@/lib/api': { clearApiCache() {}, adminPaymentsApi: { list: async params => { requests.push(params); if (fail) throw Error('offline'); return data; }, receipt: async () => { throw Error('must load receipts on explicit click only'); } } },
    './payments.module.css': new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) }),
  });
  const render = () => { cursor = 0; stateCursor = 0; tree = module.default(); return tree; };
  const flush = async () => { for (let i = 0; i < 3; i++) { for (const effect of effects.filter(Boolean)) if (effect.pending) { effect.pending = false; effect.cleanup = effect.fn(); } await new Promise(resolve => setImmediate(resolve)); render(); } };
  return { render, flush, requests, html: () => renderToStaticMarkup(tree), states };
}
test('admin history renders both payment states, full totals/pagination and escapes account names', () => {
  const h = harness(); h.render(); const html = h.html();
  assert.ok(html.includes('To‘lovlar tarixi')); assert.ok(html.includes('1 / 3 sahifa · 51 ta to‘lov'));
  assert.ok(html.includes('&lt;shop&gt;')); assert.equal(html.includes('<shop>'), false);
  for (const label of ['To‘langan', 'Kutilmoqda', 'Karta orqali', '125,000.3']) assert.ok(html.includes(label));
  assert.ok(html.includes('type="date"')); assert.equal(h.requests.length, 0);
});
test('admin history localises its labels in Russian and detail view keeps card numbers masked', () => {
  i18n.setLanguage('ru'); const h = harness({ selected: true }); h.render(); const html = h.html();
  for (const label of ['История платежей', 'Детали платежа', '•••• 9012', 'Открыть чек']) assert.ok(html.includes(label));
  assert.equal(html.includes('paymentHistory'), false); assert.equal(html.includes('8600'), false);
  i18n.setLanguage('uz');
});
test('ordinary accounts render no payment data and never issue a history request', async () => {
  const h = harness({ role: 'admin', pending: true }); h.render(); await h.flush(); assert.equal(h.html(), ''); assert.equal(h.requests.length, 0);
});
test('history loads a bounded page and shows a retry state after a request fails instead of invented zero totals', async () => {
  const h = harness({ pending: true, fail: true }); h.render(); await h.flush();
  assert.equal(h.requests[0].page, 1); assert.equal(h.requests[0].limit, 25);
  assert.ok(h.html().includes('retry-banner')); assert.equal(h.html().includes('125,000'), false);
});
