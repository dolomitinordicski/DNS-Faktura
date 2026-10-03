# DNS Faktura v2 — Final F6 / Cutover Audit

Date: 2026-10-03

## Verdict

**INTERNAL V2 CUTOVER: COMPLETE**

**PUBLIC CONFIRMATION FUNCTIONS: IMPLEMENTED + TESTED, PRODUCTION DEPLOY PENDING GCP API ENABLEMENT**

The active DNS Faktura runtime is v2. Legacy v1 billing logic is no longer part of the application runtime.

## Cutover evidence

### Repository / rollback
- PR #25 (v2 backend) merged.
- PR #31 (definitive runtime cutover) merged.
- Recovery branch created before destructive cleanup:
  `archive/faktura-v1-pre-v2-cutover-2026-10-03`.

### Legacy removal
Removed runtime concepts/files include:
- orderBilling
- unifiedBilling
- billingRuns / unifiedBillingRuns
- seasonalExtras runtime
- hardcoded IDM service
- legacy FAIR/orders billing adapters
- old billing/pricing/seasonal-extras/unified panels

The permanent command `npm run audit:v2-cutover` verifies these do not return.

Current non-v2 service layer is limited to infrastructure:
- auth
- dnsCore bootstrap
- shared Design System/Foundation bridge

### Foundation
PASS.

Pinned to immutable:
`@dolomitinordicski/dns-shared-data#foundation-v1.2.0`

Foundation pin CI gate passes.

### Security rules
PASS / ACTIVE.

Canonical DNS Core rules were merged from `dns-shared-data` PR #149 and deployed successfully.

Faktura collections are not public Firestore surfaces. Public token resolution/submission is designed behind server-side Functions.

### Canonical economic sources
PASS / ACTIVE.

- 15 active 2026/27 commercial rates normalized with explicit `prepaymentRequired=true`.
- IDM Premium program 2026/27 moved from Faktura hardcode to revisioned DNS Core configuration.
- IDM source revision now composes program + allocation revisions deterministically.
- READY revalidates IDM program + allocation atomically inside DNS Core.

### Migration / data dry-run
PASS.

Production read-only audit returned:
- structuralReady = true
- 0 v2 Confirmations requiring migration
- 0 ledgers requiring bootstrap
- 0 active seasonal extras requiring conversion
- 0 v1 billingRuns
- 0 v1 billingLines
- 263 Data Entry order lines
- 15 active commercial rates
- 16 allocation keys

No ambiguous business data required reinterpretation.

### Firestore indexes
PASS BY DESIGN.

The only proposed new composite index was for `fakturaBillingSheets(seasonId, organizationId)`.

To avoid a deployment/IAM dependency, the runtime query was simplified to:
- Firestore filter by `seasonId`
- organization filter in application code

Therefore no new Faktura composite index is required.

### Confirmation lifecycle
PASS.

- one-shot public token model
- server clock for public expiry/audit
- transactional quantity ledger
- changed public response does not consume quantity
- correction approval atomically performs replacement CONFIRMED + original SUPERSEDED + ledger swap

No supported double-active correction state remains.

### Billing READY
PASS.

Before READY:
- persisted DRAFT is authoritative
- FAIR is reread live cross-project
- IDM is reread live
- Confirmation records are reread
- commercial rates are reread

Inside DNS Core READY transaction:
- DRAFT version guard
- Confirmation exact revision/value guard
- commercial rate exact revision/value guard
- IDM program + allocation guard
- duplicate audit-event guard

### Invoicing / payment / delivery
PASS.

- READY -> INVOICED + PaymentCase is atomic.
- Payment OPEN -> PAID is transactional and audited.
- Delivery is order-scoped.
- partial/full delivery and overdelivery rules are enforced.

### MANUAL_SERVICE
PASS.

One-off manual lines can be ADD/UPDATE/REMOVE only on DRAFT, with optimistic concurrency, total recalculation and atomic audit.

### Emulator / concurrency
PASS.

Permanent emulator suite verifies:
- competing Confirmation quantity consumption
- correction replacement race
- concurrent manual DRAFT edits
- READY source change / duplicate transition
- concurrent public-token submission
- audit-event uniqueness

### Web runtime / deploy
PASS.

Post-merge:
- TypeScript/Vite build: success
- v2 no-legacy audit: success
- domain scenarios: success
- emulator integration: success
- GitHub Pages build/deploy: success

## Remaining external activation item

### Public Confirmation Cloud Functions

Code and emulator tests are complete, but first production deployment failed before function creation because the following Google Cloud APIs are not enabled in project `dns-core`:

- `cloudfunctions.googleapis.com`
- `cloudbuild.googleapis.com`
- `artifactregistry.googleapis.com`

The GitHub service account can deploy governed DNS data/rules but does not have permission to enable Google Cloud services.

Required one-time owner action:
enable those APIs in Google Cloud project `dns-core`.

After they are enabled, rerun the manual Faktura Functions deployment workflow. Until then:
- internal Faktura v2 remains usable;
- the public Confirmation UI must remain disabled/unlinked;
- no direct public Firestore fallback is permitted.

## Final architecture status

The active application no longer has a v1/v2 dual runtime.

**Faktura v2 is the canonical runtime.**
