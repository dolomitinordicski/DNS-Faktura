# DNS Faktura v2 — F1 Domain Model

## Aggregate: Order

Owned externally by DNS Data Entry.

Fields:
- id
- seasonId
- organizationId
- createdAt
- submittedAt
- status: DRAFT | SUBMITTED
- lines[]

OrderLine:
- id
- catalogItemId
- category
- label
- orderedQuantity
- unit

Order data is treated as source input. Faktura does not rewrite historical order quantities.

## Aggregate: Confirmation

Owned by Faktura.

Confirmation:
- id
- seasonId
- organizationId
- orderId
- revision
- status
- createdAt
- sentAt?
- confirmedAt?
- confirmedBy?
- lines[]
- acceptanceTextVersion

ConfirmationLine:
- orderLineId
- catalogItemId
- proposedQuantity
- requestedQuantity?
- confirmedQuantity?
- unit

A confirmation is a selectable batch; it does not need to include every order line.

## Aggregate: BillingSheet

Owned by Faktura, one working sheet per organization and season.

BillingSheet:
- id
- seasonId
- organizationId
- revision
- status: DRAFT | READY | INVOICED
- lines[]
- totalAmount
- sourceCompleteness

BillingLine source types:
- FAIR
- IDM
- ORDER_CONFIRMATION
- MANUAL_SERVICE

Common line shape:
- id
- sourceType
- sourceId
- description
- quantity
- unit
- unitPrice
- amount
- sourceRevision?
- sourceDocument?
- notes?

ORDER_CONFIRMATION lines must derive quantity from confirmedQuantity.

## Aggregate: PaymentCase

Operational status only.

- billingSheetId
- required
- status: OPEN | PAID
- paidAt?
- reference?

No bank or accounting reconciliation is implied.

## Aggregate: Delivery

Owned by Faktura.

Delivery:
- id
- organizationId
- seasonId
- orderId
- confirmationIds[]
- status: PENDING | PARTIAL | DELIVERED
- lines[]

DeliveryLine:
- catalogItemId
- confirmedQuantity
- deliveredQuantity
- remainingQuantity

A Lieferschein may be generated from Delivery without prices.

## Manual / Service line

Manual billing positions are not catalog items by default.

Examples:
- Grafik Pocketfolder Drei Zinnen
- Kartografie
- Korrekturen
- Sondertransport

A service line may optionally reference a catalog item for context, but this does not make it an orderCatalogItem.
