// Read contract: comp-bar-server/backend/src/modules/procurements/{controller,
// repository,analytics,ledger,model}.ts and src/lib/procurementTypes.ts.
// Fictional data only. Diagnostic scenario controls are local test facilities.
const http = require('node:http');
const rows = Array.from({ length: 24 }, (_, i) => ({
  localId: `fixture-${i}`, date: `2026-10-${18 - i % 3}`, createdAt: '2026-10-18T09:00:00Z',
  supplier: i % 2 ? 'Atlas' : 'Chorsu', createdByUsername: 'fixture-operator', createdByScope: 'procurement',
  totalCost: 25000, items: [{ productId: 'fixture-apple', name: 'Olma', unit: 'kg', quantity: 2.5, buyPrice: 10000, lineCost: 25000, isNewProduct: false }],
})).sort((a, b) => b.date.localeCompare(a.date) || b.localId.localeCompare(a.localId));
function send(res, status, value, type = 'application/json') { res.writeHead(status, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(value) : value); }
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/__scenario') {
    await pm.state.set('procurement-read:scenario', req.body || {});
    return send(res, 200, { success: true });
  }
  if (req.method !== 'GET') return send(res, 501, { success: false, error: { message: 'Only the report read contract is modeled' } });
  const scenario = await pm.state.get('procurement-read:scenario') || {};
  const filter = url.searchParams;
  const selected = rows.filter(row => (!filter.get('from') || row.date >= filter.get('from')) && (!filter.get('to') || row.date <= filter.get('to')) && (!filter.get('supplier') || row.supplier === filter.get('supplier')));
  if (url.pathname === '/procurements') {
    if (scenario.failList) return send(res, 503, { success: false, error: { message: 'Simulated receipt read failure' } });
    const page = Number(filter.get('page') || 1), limit = Math.min(Number(filter.get('limit') || 100), 100);
    return send(res, 200, { success: true, data: selected.slice((page - 1) * limit, page * limit) });
  }
  if (url.pathname === '/procurements/analytics') {
    if (scenario.failAnalytics) return send(res, 500, '<html>Simulated upstream failure</html>', 'text/html');
    return send(res, 200, { success: true, data: {
      from: filter.get('from'), to: filter.get('to'), period: 'custom', granularity: 'day', supplier: filter.get('supplier'), generatedAt: '2026-10-18T09:00:00Z',
      totalProcurementSpend: selected.length * 25000, totalBatchesCount: selected.length, totalItemsProcured: { dona: 0, kg: selected.length * 2.5 },
      averageBatchValue: selected.length ? 25000 : 0, inventoryValue: 0, totalRevenue: 0, grossProfit: 0, costOfGoodsSold: 0, cashFlowBalance: 0, costTrends: [], topCostProducts: [], inventoryValuation: 'last_purchase_price', salesBasis: 'recognized_revenue',
    } });
  }
  if (url.pathname === '/procurements/export' && filter.get('report') === 'receipts' && filter.get('format') === 'xlsx') {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Kirimlar');
    sheet.addRow(['Sana', 'Yetkazib beruvchi', 'Jami']);
    for (const row of selected) sheet.addRow([row.date, row.supplier, row.totalCost]);
    return send(res, 200, await workbook.xlsx.writeBuffer(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  send(res, 501, { success: false, error: { message: 'Read endpoint not modeled' } });
}).listen(process.env.PORT || 4500);
