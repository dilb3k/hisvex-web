# Procurement reports simulation context

## Purpose

Runs the actual report component and Axios client against the existing local
procurement mock. Setup and commands are in `../README.md`.

## Execution

Use Postman CLI 1.74.0 and the commands in `../README.md`. Wait for the NDJSON
`listening` event and use its `/api` address. Stop the simulation after testing.

## Assumptions

- Observed 2026-10-27: tests use fictional receipts and a fixture token; this
  verifies client HTTP behavior, not production authentication or database writes.
- Observed 2026-10-27: this managed sandbox requires approval for both listening
  on the local port and connecting to it.

## Observations

<!-- begin:observations -->
2026-10-27: the only member, `procurement-read`, served requests. Listing,
filtering, pagination, XLSX download, independent 500/503 errors and recovery
passed in `tests/procurement-reports-http.test.cjs`.
<!-- end:observations -->

## What didn't work

- 2026-10-27: a sandboxed client failed with `connect EPERM 127.0.0.1:4900`;
  the same test passed with approved local network access.
