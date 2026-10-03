# DNS Faktura v2 — F5 Migration Map v1 -> v2

Status: migration/cutover plan only. No v1 deletion in this phase.

## Strategy

Faktura v2 is not an incremental refactor of Faktura v1.

The target is a clean replacement:
- preserve verified data and source knowledge
- preserve only infrastructure that is still neutral and useful
- rebuild business logic around the v2 domain model
- delete obsolete v1 engines and UI after cutover
- keep one archived v1 tag/branch for historical recovery

## Classification

### KEEP / ADAPT

These contain useful knowledge or neutral infrastructure.

#### src/services/orders.ts
Action: REWRITE AS V2 ADAPTER.

Keep:
- collection names: ticketOrders, ticketOrderLines, orderCatalogItems
- source validation knowledge
- organization/season/catalog relationships

Discard:
- v1 aggregation semantics
- generic active/draft billing interpretation

Target:
- src/v2/adapters/ordersAdapter.ts
- implements DataEntryOrderSource

#### src/services/fairSource.ts
Action: REWRITE AS V2 ADAPTER.

Keep:
- actual FAIR project/source location
- published billing payload mapping
- organization mapping

Discard:
- direct coupling to v1 UI

Target:
- src/v2/adapters/fairAdapter.ts
- implements FairContributionSource

#### src/services/dnsCore.ts
Action: KEEP KNOWLEDGE / REFACTOR BOOTSTRAP.

Keep:
- DNS Core Firebase project configuration
- organizations/reportingAreas/seasons lookup

Target:
- shared Firebase/bootstrap layer once Governance/Foundation propagation is stable

#### src/services/auth.ts
Action: KEEP IF STILL COMPATIBLE.

Authentication is infrastructure, not v1 billing logic.

Revalidate during cutover.

### MIGRATE DATA / REBUILD LOGIC

#### src/services/commercialRates.ts
Action: MIGRATE VERIFIED DATA; REBUILD SERVICE.

Keep:
- billingRateConfigs data
- verified rate revisions
- source documents
- supplier/date/calculation metadata
- prepayment policy where applicable

Do not keep:
- v1 seeding/UI assumptions
- hard-coded season bootstrap as permanent architecture

Target:
- v2 rate source adapter / shared governed rate source

#### src/services/idmPremium.ts
Action: MIGRATE CONFIGURATION; DELETE HARDCODED SERVICE.

Keep:
- verified 2026/27 IDM amount and participants
- allocation principle

Replace with:
- revisioned/configured source
- organization allocation from canonical allocation keys

#### src/services/seasonalExtras.ts
Action: MIGRATE REAL RECORDS ONLY.

Existing meaningful records become:
- MANUAL_SERVICE billing sources/lines

Do not preserve "Seasonal Extras" as a core v2 concept.

### DELETE AFTER CUTOVER

#### src/services/orderBilling.ts
Reason:
v1 derives billing directly from order statuses.

v2 billing derives material quantities from CONFIRMED Confirmation revisions.

Do not adapt.

#### src/services/billingRuns.ts
Reason:
v1 snapshot model is superseded by revisioned BillingSheet.

Delete after cutover.

#### src/services/unifiedBilling.ts
Reason:
mixes source aggregation/readiness into one v1 engine.

Superseded by:
- source adapters
- BillingLine
- BillingSheet
- F3.5 freshness
- F3.6 readiness

Delete after cutover.

#### src/services/unifiedBillingRuns.ts
Reason:
superseded by immutable revisioned BillingSheet persistence.

Delete after cutover.

## UI classification

### DELETE / REBUILD

- BillingRunsPanel.tsx
- CommercialRatesPanel.tsx
- PricingAuditPanel.tsx
- SeasonalExtrasPanel.tsx
- UnifiedBillingPanel.tsx
- FakturaPrintSheet.tsx (business layout must be rebuilt against v2 snapshots)

These embody v1 information architecture.

### POSSIBLE INFRASTRUCTURE REUSE

- LoginScreen.tsx
- SeasonSelector.tsx
- RegionLogos.tsx
- AccessibilityMount.tsx

Reuse only if still compatible with the final Governance/Foundation propagation model.

Do not freeze these now.

## Data migration

### Orders
No migration.

Orders remain owned by DNS Data Entry and are read by v2.

### FAIR
No copy of the FAIR engine.

Read published FAIR result through adapter.
Frozen BillingLine stores source lineage.

### IDM
Move from hard-coded v1 logic to canonical revisioned/configured source.

### Commercial rates
Preserve verified billingRateConfigs and map them to v2 rate contract.

### Seasonal Extras
Export meaningful active records and transform into v2 MANUAL_SERVICE records/lines.

### v1 billingRuns / billingLines
Default: DO NOT import as active v2 business objects.

Optionally archive/export them for historical reference.

They must not seed active Confirmation/BillingSheet state automatically.

## Cutover sequence

1. Governance/Foundation propagation mechanism stable
2. create archival tag/branch for final v1 state
3. implement v2 adapters against real sources
4. implement v2 persistence collections/transactions
5. validate v2 against selected real organizations
6. migrate reusable rates/manual source data
7. build v2 UI on canonical Foundation integration
8. freeze v1 writes
9. switch application entry point to v2
10. verify real operational workflow end-to-end
11. remove v1 business services/components from main
12. keep archive tag/branch only

## Deletion rule

Nothing is deleted from main until:
- v2 can load real Orders
- FAIR/IDM/rates are resolved
- confirmation flow works
- BillingSheet READY/INVOICED works
- payment/delivery workflow works
- persistence tests pass
- production smoke test passes

After those gates, keeping v1 business code in main is considered technical debt and should be removed.

## Final repository target

The final repository should contain:
- one application
- one Faktura domain model
- one persistence model
- canonical Foundation consumption
- no v1 billing engine
- no duplicate source aggregation logic
- no parallel old/new billing UI
