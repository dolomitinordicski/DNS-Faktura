# DNS Faktura v2 — F6 Backend Audit & Cutover Gap Analysis

Status: audit after F0–F5.10.  
Scope: backend/domain/application/persistence only. UI/Foundation integration remains intentionally outside F6.

## Executive status

The v2 core flow is structurally implemented:

Order source -> Confirmation -> Billing assembly -> readiness -> DRAFT -> READY -> INVOICED -> PaymentCase -> Delivery

However, the backend is **not yet cutover-ready**.

F6 found:
- several areas that PASS as designed
- three local defects/residual bypasses fixed immediately
- several pre-cutover blockers that require explicit F6.x work before production use

## PASS

### Domain separation
PASS.

Domain/engine code remains framework-agnostic and does not import React or Firebase.

### Ownership boundaries
PASS.

Faktura reads upstream sources but does not write into:
- Data Entry orders
- FAIR
- IDM allocation source
- organizations/seasons/catalog
- commercial rate source

Faktura-owned persistence is isolated under `faktura*` collections.

### Confirmation quantity model
PASS with one replacement lifecycle blocker listed below.

The model distinguishes:
- orderedQuantity
- proposedQuantity
- requestedQuantity
- confirmedQuantity

A changed public response does not consume quantity until DNS approval.

### Billing lineage
PASS.

Material BillingLines freeze:
- Confirmation source id/revision
- orderId
- commercial rate id/revision
- quantity
- unit price
- amount

FAIR/IDM lines freeze source id/revision and amount.

### Billing immutability
PASS.

READY/INVOICED are frozen snapshots. New changes require new revisions.

### Invoicing + PaymentCase atomicity
PASS.

The canonical READY -> INVOICED path also creates PaymentCase and audit events in the same Firestore transaction.

### Delivery
PASS.

Delivery is order-scoped, not BillingSheet-global.

Persistence reconstructs the expected Delivery from persisted BillingSheet + PaymentCase before accepting creation.

Overdelivery is blocked.

### Audit events
PASS for implemented transactional flows.

State changes write events in the same Firestore transaction where technically possible.

### Public token entropy / hashing
PASS at the cryptographic data-model level.

- 32 random bytes
- SHA-256 stored
- raw token not persisted
- one-shot state
- expiry/revoke fields

Runtime exposure remains BLOCKED pending secure public endpoint/rules.

---

## FIXED DURING F6

### F6-FIX-01 — Data Entry source-order status drift
Severity before fix: HIGH.

Problem:
The v2 Orders adapter accepted only Data Entry status `submitted`.

An order that had already been submitted but later moved operationally to `confirmed` or `fulfilled` disappeared from the v2 source and could make a Confirmation appear to have no source Order.

Fix:
The adapter now treats:
- submitted
- confirmed
- fulfilled

as valid previously-submitted source orders and maps them to v2 `SUBMITTED`.

It still excludes:
- draft
- cancelled

Important:
This does **not** reinterpret Data Entry `confirmed/fulfilled` as v2 confirmed quantity.

### F6-FIX-02 — self-contained MANUAL_SERVICE freshness
Severity before fix: MEDIUM.

Problem:
A one-off MANUAL_SERVICE line without its own revisioned external source was treated as MISSING_SOURCE.

Fix:
MANUAL_SERVICE with no sourceRevision is considered a self-contained frozen DRAFT line and does not require an external freshness snapshot.

If a future reusable manual source has a sourceRevision, normal freshness rules still apply.

### F6-FIX-03 — bypass persistence paths
Severity before fix: HIGH.

Removed:
- standalone `BillingSheetRepository.markInvoicedTransaction()`
- standalone token `create()`
- standalone token `markUsedTransaction()`

Reason:
These paths could bypass the canonical atomic workflows.

Canonical paths are now:
- READY -> INVOICED only through InvoicingRepository, which also creates PaymentCase
- token creation only through DRAFT -> SENT dispatch
- token consumption only through public response transaction

---

# PRE-CUTOVER BLOCKERS

## F6-B01 — Firestore security rules
Severity: CRITICAL at audit time. **Implementation addressed in F6.1; activation pending.**

F6.1 confirmed that canonical DNS Core rules are owned by `dns-shared-data`, not this consumer repository.

A dedicated rules change is implemented in `dns-shared-data` PR #145 and emulator-tested successfully.

The code defines sensitive collections:
- fakturaConfirmations
- fakturaConfirmationTokens
- fakturaConfirmationLedgers
- fakturaBillingSheets
- fakturaPayments
- fakturaDeliveries
- fakturaEvents

but F6 cannot verify runtime authorization policy.

F6.1 implementation:
1. canonical ownership confirmed in `dns-shared-data`
2. public direct access denied
3. current client access restricted to active `dns-admin`
4. public confirmation moved behind HTTPS Functions
5. emulator tests added and green
6. rules remain independently deployed from UI

Activation still requires PR #145 to be merged/deployed before public Confirmation UI is enabled.

## F6-B02 — secure public confirmation execution boundary
Severity: CRITICAL at audit time. **Implementation addressed in F6.1; deployment pending.**

The direct browser Firestore lookup was removed from the client architecture.

F6.1 now provides server-side HTTPS Functions for resolve/submit. The server hashes the raw token, uses Firebase Admin for lookup, enforces expiry with server time, and returns only a scoped public payload.

Original audit problem:
The prior implementation resolved a public token with a Firestore query on `tokenHash`.

That requires query/read capability against the token collection and conflicts with the intended least-privilege model where public users must not enumerate Faktura records.

Also, public response currently accepts an application-provided `occurredAt`; that timestamp must not be trusted as the authoritative clock for token expiry or audit.

F6.1 implementation:
- HTTPS backend endpoints implemented
- server-side token hashing/lookup
- server-trusted current time
- scoped response payload
- no direct public Firestore permission
- deterministic one-shot token transaction
- stable audit principal separate from submitted human label

Production exposure still requires Functions deployment and the canonical rules deployment. App Check / platform throttling can be added as launch hardening when the public UI exists.

## F6-B03 — READY freshness does not currently re-read every live source
Severity: CRITICAL.

Current F5.6 behavior:
- commercial rates are actively re-read
- FAIR/IDM/Confirmation freshness can still rely on snapshots captured during assembly

Therefore a source can change between assembly and READY evaluation without necessarily being detected.

Required:
- re-read current Confirmation records before READY
- re-read current FAIR contribution revision
- re-read current IDM allocation/program revision
- compare current source id/revision against frozen DRAFT lines
- for DNS-Core-local sources, revalidate again inside the READY Firestore transaction where practical
- FAIR lives in another Firebase project and cannot join the same Firestore transaction; define the accepted cross-project consistency strategy explicitly

Recommended cross-project rule:
- published FAIR revisions must be immutable
- re-read FAIR immediately before READY
- freeze exact FAIR revision in BillingLine
- later FAIR revisions create staleness/new BillingSheet revision, never mutate frozen READY

## F6-B04 — correction replacement has an intermediate double-active state
Severity: CRITICAL.

Current sequence can be:
1. original = CONFIRMED
2. correction = CHANGE_REQUESTED
3. DNS approval makes correction = CONFIRMED
4. separate transaction later marks original = SUPERSEDED

Between 3 and 4:
- original and replacement can both appear CONFIRMED
- listActiveByOrder can expose both
- Billing assembly could potentially see both
- ledger intentionally still represents the original until finalization

Required:
Do not expose a replacement as active CONFIRMED before the original is superseded.

Preferred fix:
combine correction approval + original SUPERSEDED + ledger replacement + audit events in one atomic transaction.

Alternative:
introduce a non-active state such as APPROVED_REPLACEMENT_PENDING_FINALIZATION.

The first option is preferred because it reduces state-space and race windows.

---

# HIGH PRIORITY BEFORE CUTOVER

## F6-H01 — MANUAL_SERVICE application path is incomplete
Severity: HIGH.

The engine supports MANUAL_SERVICE, but the main Billing orchestrator has no explicit input/persistence workflow for DNS operators to add/edit manual/service lines.

Required:
- application command for add/update/remove manual line while BillingSheet is DRAFT
- validation
- optional revisioned `fakturaManualSources` only for reusable sources
- audit policy for edits
- ensure READY freezes them normally

## F6-H02 — IDM program definition remains transitional hardcoding
Severity: HIGH.

2026/27 program data is still hardcoded in the v2 Firebase backend:
- 15,000 EUR per reporting area
- participating reportingAreaIds
- source label
- program revision = 1

The organization allocation keys themselves are real DNS Core data.

Required:
move IDM program definition into a governed revisioned source before future seasons / production cutover.

The adapter contract can remain unchanged.

## F6-H03 — Confirmation ledger bootstrap/migration strategy
Severity: HIGH.

The ledger is correct if all active v2 Confirmations were created through v2.

Before importing or preserving any historical confirmed Confirmation data, the migration must build:
`fakturaConfirmationLedgers/{orderId}`

from the active confirmed set.

Required migration invariant:
ledger totals must exactly equal active non-superseded/non-voided confirmed quantities before public confirmation is enabled.

## F6-H04 — Firestore emulator integration tests missing
Severity: HIGH.

Current scenario tests are pure/in-memory and validate domain behavior well, but they do not prove:
- Firestore transaction retry semantics
- concurrent quantity consumption
- frozen snapshot rules
- duplicate event protection
- token one-shot behavior under concurrent requests
- actual security rules

Required before cutover:
Firebase Emulator Suite integration tests for all transactional repositories and rules.

## F6-H05 — Firestore indexes not versioned
Severity: HIGH.

The repository defines queries that will require indexes depending on deployed rules/index state.

Required:
version `firestore.indexes.json` (or canonical equivalent) for:
- confirmation queries by order
- BillingSheets by season + organization
- event lookup needs
- any admin/status lists introduced by UI

---

# MEDIUM / CLEANUP

## F6-M01 — duplicate Firestore codecs/helpers
Severity: MEDIUM.

`billingRecordFromData`, `paymentRecordFromData`, and `cleanForFirestore` are duplicated across persistence adapters.

Required before final cleanup:
extract canonical codecs/serializers so validation behavior cannot drift.

## F6-M02 — public actor identity semantics
Severity: MEDIUM.

Public `actorLabel` is currently also used as audit `actorId`.

Recommended:
store a stable system principal such as:
`public-confirmation-token:{tokenId}`

and keep submitted human name as `actorLabel`.

This avoids treating an unverified typed name as an authenticated identifier.

## F6-M03 — source validation is structural, not schema-versioned
Severity: MEDIUM.

Adapters validate required fields manually but do not persist/source a schema version.

Recommended:
introduce explicit source schema versions once shared Governance contracts stabilize.

## F6-M04 — repository still contains migration-only unsafe helper
Severity: MEDIUM.

`putBillingDraftUnsafeForMigrationOnly()` is deliberately named unsafe.

Keep only until migration tooling is completed.
It must not be imported by production UI/application code and should be removed after migration.

---

# F6 CUTOVER GATES

Backend may be called **cutover-ready** only when all of the following are true:

- [x] Domain scenarios green
- [x] TypeScript/Vite build green
- [x] Orders/FAIR/IDM/rates adapters exist
- [x] Confirmation quantity model exists
- [x] Billing assembly/readiness exists
- [x] DRAFT/READY persistence exists
- [x] atomic INVOICED + PaymentCase exists
- [x] order-scoped Delivery exists
- [x] audit events exist
- [x] token hash/one-shot domain model exists
- [ ] Firestore security rules defined and tested
- [ ] secure public token execution boundary implemented
- [ ] READY performs live freshness re-check of FAIR/IDM/Confirmations
- [ ] correction replacement made single-safe lifecycle
- [ ] MANUAL_SERVICE application workflow completed
- [ ] IDM program source canonicalized
- [ ] ledger bootstrap/migration invariant implemented
- [ ] Firestore emulator concurrency/rules suite green
- [ ] Firestore indexes versioned
- [ ] unsafe migration helpers removed or isolated from production bundle
- [ ] final v1 -> v2 dry-run performed
- [ ] v1 archived/tagged before destructive cleanup

## F6 result

The v2 backend architecture is viable and the main operational path is implemented.

F6 does **not** recommend UI/cutover yet.

Recommended next sequence:

1. F6.1 secure public confirmation boundary + Firestore rules
2. F6.2 live READY freshness / transaction revalidation
3. F6.3 atomic correction replacement
4. F6.4 MANUAL_SERVICE application path
5. F6.5 emulator concurrency + rules tests
6. F6.6 migration dry-run / ledger bootstrap / index manifest
7. only then: Foundation-propagation integration, v2 UI, hard v1 cutover
