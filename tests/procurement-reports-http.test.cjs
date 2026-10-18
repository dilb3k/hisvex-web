const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { loadSource } = require('./helpers/load-source.cjs');
const { mountReports } = require('./helpers/procurement-report-screen.cjs');
const base = process.env.PROCUREMENT_SIMULATION_URL;

function realClient() {
  const module = { exports: {} }; let owner = null;
  const queue = { setQueueOwner: value => { owner = value; }, getQueueOwner: () => owner, flushOfflineQueue: async () => {}, isTransientQueueFailure: () => true };
  const req = name => name === './i18n' ? { getLanguage: () => 'uz' } : name === './apiErrorMessages' ? { translateApiMessage: x => x } : name === './businessDay' ? { getBusinessDate: () => '2026-10-18' } : name === './offlineQueue' ? queue : name === './manualMutationIntent' ? loadSource('src/lib/manualMutationIntent.ts') : require(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/api.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module, exports: module.exports, require: req, console, atob, crypto, TextEncoder, FormData, Blob, setTimeout, clearTimeout });
  module.exports.default.defaults.baseURL = base;
  const payload = Buffer.from(JSON.stringify({ userId: 'fixture-owner', sessionId: 'fixture-session', scope: 'full' })).toString('base64url');
  module.exports.setApiToken(`fixture.${payload}.signature`);
  return module.exports;
}
async function ready(ui, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 20)); ui.render(); if (predicate()) return; }
  throw Error('The report did not reach the expected HTTP-backed state: ' + ui.text());
}

test('real report UI and Axios client read, filter, page, export and recover through the local Postman simulation', { skip: !base }, async () => {
  const scenario = async body => { const r = await fetch(base + '/__scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200); };
  await scenario({});
  const client = realClient();
  const ui = mountReports({ api: client.procurementApi, clearCache: client.clearApiCache });
  await ready(ui, () => ui.find(n => n.props.className === 'pr-receipt').length === 8 && ui.text().includes('200,000'));
  ui.button('7 kun').props.onClick(); ui.render();
  await ready(ui, () => ui.find(n => n.props.className === 'pr-receipt').length === 20 && ui.text().includes('600,000'));
  ui.button('Keyingi').props.onClick(); ui.render();
  await ready(ui, () => ui.find(n => n.props.className === 'pr-receipt').length === 4);
  assert.equal(ui.button('Keyingi').props.disabled, true);
  ui.button('Yetkazib beruvchi').props.onClick(); ui.render();
  ui.find(n => n.type === 'input' && n.props.maxLength === 120)[0].props.onChange({ target: { value: 'Chorsu' } }); ui.render();
  ui.find(n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} }); ui.render();
  await ready(ui, () => ui.find(n => n.props.className === 'pr-receipt').length === 12 && ui.text().includes('300,000'));
  ui.button('Excel yuklab olish').props.onClick(); ui.render();
  await ready(ui, () => ui.saves.length === 1);
  assert.equal(ui.saves[0], 'kirimlar-2026-10-12-2026-10-18.xlsx');
  await scenario({ failAnalytics: true }); ui.button('Kirimlarni yangilash').props.onClick(); ui.render();
  await ready(ui, () => ui.text().includes('Jami ko‘rsatkichlar yuklanmadi'));
  assert.equal(ui.find(n => n.props.className === 'pr-receipt').length, 12);
  await scenario({ failList: true }); ui.button('Kirimlarni yangilash').props.onClick(); ui.render();
  await ready(ui, () => ui.text().includes('Kirimlar yuklanmadi') && ui.text().includes('300,000'));
  assert.equal(ui.text().includes('Bu davrda kirim yo‘q'), false);
  await scenario({}); ui.button('Kirimlarni yangilash').props.onClick(); ui.render();
  await ready(ui, () => ui.find(n => n.props.className === 'pr-receipt').length === 12 && ui.text().includes('300,000'));
  assert.equal(ui.find(n => n.props.role === 'alert').length, 0);
  ui.unmount();
});
