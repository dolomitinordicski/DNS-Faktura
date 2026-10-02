# DNS Faktura v2 — F2 Data Ownership & Contracts

## Ownership

### DNS Data Entry
Owns:
- Order
- OrderLine
- orderedQuantity
- operational catalog selection

Faktura consumes order snapshots read-only.

### FAIR
Owns:
- membership contribution calculations
- final FAIR contribution source values

Faktura consumes a versioned FAIR billing source.

### DNS Shared / DNS_Core
Owns shared master data only:
- organizations
- reporting areas
- seasons
- shared catalog items
- reusable configuration explicitly promoted to shared scope

No Faktura-v2 domain schema is pushed into dns-shared-data during this isolated phase.

### Faktura v2
Owns:
- confirmations
- confirmation revisions
- requested/confirmed quantities
- billing sheets
- billing lines
- operational payment status
- delivery records
- manual/service lines
- audit lineage

## Contract principles

1. External inputs are immutable snapshots inside Faktura workflows.
2. Faktura references source IDs and source revisions.
3. Faktura never silently mutates upstream records.
4. READY billing snapshots are immutable; later changes create a new revision.
5. Confirmation changes create explicit revisions or change requests.
6. Manual/service lines remain local unless deliberately promoted to shared catalog/master data.

## External contract placeholders

During F0-F3 these remain local TypeScript contracts under src/v2/contracts.

No Firestore collections are created or modified yet.
