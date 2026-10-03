# DNS Faktura v2 — F4 Persistence Contracts

Status: design contract only. No production Firebase writes in this phase.

## Goal

Translate the F0–F3 domain model into a persistence design that is explicit enough to implement later without changing business semantics.

The persistence layer must preserve:
- ownership boundaries
- immutable history
- revision lineage
- transactional guards
- append-only audit
- source references
- exact organization + season scope

## Proposed Faktura-owned collections

### fakturaConfirmations

One document per confirmation revision.

Document id:
`confirmationId`

Fields:
- id
- seasonId
- organizationId
- orderId
- revision
- status
- acceptanceTextVersion
- lines[]
- sentAt?
- confirmedAt?
- confirmedBy?
- supersedesConfirmationId?
- supersededByConfirmationId?
- supersededAt?
- supersededBy?
- voidedAt?
- voidedBy?
- lifecycleReason?
- createdAt
- createdBy
- updatedAt

Rules:
- CONFIRMED, SUPERSEDED and VOIDED revisions are never rewritten as business data
- replacement finalization must be transactional
- confirmation history is queried by orderId + revision

### fakturaBillingSheets

One document per billing sheet revision.

Document id:
`billingSheetId`

Fields:
- id
- seasonId
- organizationId
- revision
- status
- lines[]
- totalAmount
- supersedesBillingSheetId?
- revisionReason?
- createdAt
- readyAt?
- invoicedAt?
- createdBy
- updatedAt

Rules:
- only DRAFT may be edited
- READY/INVOICED are frozen snapshots
- new revision gets new document id
- no in-place rollback to DRAFT

### fakturaPayments

One document per billing sheet.

Document id:
`billingSheetId`

Fields:
- billingSheetId
- required
- status
- paidAt?
- reference?
- updatedAt
- updatedBy

This is operational payment status only.

### fakturaDeliveries

One document per delivery record.

Document id:
`deliveryId`

Fields:
- id
- seasonId
- organizationId
- orderId
- billingSheetId
- confirmationIds[]
- status
- lines[]
- createdAt
- createdBy
- updatedAt
- updatedBy

### fakturaManualSources

Optional revisioned source records for reusable manual/service inputs.

Use only when a manual line needs its own persistent source lifecycle.

Fields:
- id
- seasonId
- organizationId
- revision
- category
- description
- quantity
- unit
- customUnitLabel?
- unitPrice
- sourceDocument?
- notes?
- active
- createdAt
- createdBy

Simple one-off manual lines may remain embedded in a DRAFT Billing Sheet until frozen.

### fakturaEvents

Append-only audit log.

Document id:
`eventId`

Fields:
- id
- type
- occurredAt
- actorId
- actorLabel?
- seasonId
- organizationId
- entityType
- entityId
- entityRevision?
- payload

Rules:
- create only
- normal application flow never updates or deletes historical events

## External read-only sources

Faktura v2 consumes but does not own:
- Data Entry Orders
- FAIR contribution sources
- IDM charges
- DNS Core organizations, seasons and catalog items
- billing rate sources

Faktura stores source ids + revisions in frozen BillingLines.

## Transaction boundaries

### T1 — Confirm a confirmation batch

Read:
- Order snapshot
- all active CONFIRMED confirmations for relevant order lines
- target confirmation draft/sent state

Validate:
- remaining quantity
- latest revision
- legal transition

Write atomically:
- target confirmation -> CONFIRMED
- audit event

### T2 — Finalize correction replacement

Read:
- original CONFIRMED
- replacement CONFIRMED candidate
- other active confirmations

Validate:
- lineage
- sequential revision
- remaining quantities excluding original
- same season / organization / order

Write atomically:
- original -> SUPERSEDED
- replacement finalized
- audit events

### T3 — Mark Billing Sheet READY

Read:
- current DRAFT sheet
- current source revisions
- current confirmation states

Validate:
- F3.6 readiness
- source freshness
- required sources
- same revision still current

Write atomically:
- DRAFT -> READY
- readyAt
- audit event

### T4 — Mark Billing Sheet INVOICED

Read:
- READY sheet

Validate:
- exact status READY
- no competing transition

Write atomically:
- READY -> INVOICED
- invoicedAt
- audit event

### T5 — Mark payment

Read:
- payment case
- billing sheet

Validate:
- payment belongs to exact billing sheet

Write atomically:
- payment status
- audit event

### T6 — Create / update delivery

Read:
- INVOICED billing sheet
- payment case
- delivery

Validate:
- F3.7 release rules
- delivered quantity <= confirmed/invoiced material quantity
- exact billing linkage

Write atomically:
- delivery
- audit event

## Concurrency principles

1. Never trust client-side remaining quantity calculations alone.
2. All quantity-consuming transitions require a transaction.
3. Revision numbers must be checked and incremented transactionally.
4. READY and INVOICED documents must be protected against normal update.
5. Audit events are written in the same transaction as the state transition they describe.

## Query/index needs

Expected compound queries:
- confirmations by seasonId + organizationId
- confirmations by orderId + revision
- confirmations by orderId + status
- billing sheets by seasonId + organizationId + revision
- billing sheets by seasonId + status
- deliveries by seasonId + organizationId + status
- events by entityType + entityId + occurredAt
- events by seasonId + organizationId + occurredAt

Exact Firestore composite indexes will be generated only when the adapter is implemented.

## Security / role assumptions

Faktura internal collections are not public.

Later rules should distinguish at minimum:
- DNS admin/operator
- public confirmation token flow
- read-only/internal viewers if needed

The public confirmation module must not expose arbitrary Faktura documents. It should resolve only a scoped confirmation token and allowed confirmation payload.

## Public confirmation token contract

Do not use confirmation document ids as public access tokens.

Persist a separate token record or token hash with:
- token id/hash
- confirmation id
- expiresAt?
- active
- createdAt
- usedAt?
- revokedAt?

The public endpoint may:
- read only the referenced confirmation payload needed for confirmation
- submit one response/change request
- never enumerate confirmations

## Migration rule

No existing v1 collection is renamed or repurposed in place during F4.

Migration is handled later in F5.
