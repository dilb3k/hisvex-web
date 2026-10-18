# Procurement report UI verification

The local simulation models the existing backend's procurement list, analytics
and receipt-ledger XLSX contracts. It uses fictional receipts. The contract was
read from this project's backend implementation and `src/lib/procurementTypes.ts`;
no external team's mock or production account is used.

Start the local simulation:

```sh
postman simulation run postman/simulations/procurement-reports.sim.yaml --port 4900 --no-history --output ndjson
```

In another terminal, run the actual report component with the real Axios client
and its interceptors against that simulation:

```sh
PROCUREMENT_SIMULATION_URL=http://127.0.0.1:4900/api node --test tests/procurement-reports-http.test.cjs
```

`POST /api/__scenario` controls only this local test fixture. It injects a receipt
503 or an analytics HTML 500 to verify independent errors and recovery. Other
unmodeled routes return 501. The default unit suite skips the HTTP test unless the
simulation URL is supplied. No cloud publication or workspace binding is needed.
