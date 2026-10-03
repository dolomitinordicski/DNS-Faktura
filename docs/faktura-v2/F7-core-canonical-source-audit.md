# DNS Faktura v2 — F7 DNS Core Canonical Source Audit

Date: 2026-10-03  
Scope: DNS Core / FAIR sources consumed by Faktura v2.  
Rule: Faktura must not introduce a parallel source when the canonical value already exists upstream.

## Canonical source map

| Business fact | Canonical owner | Runtime source | Faktura access | Faktura rule |
|---|---|---|---|---|
| Organizations | DNS Core | `organizations` / shared canonical data | read | never duplicate |
| Reporting areas | DNS Core | `reportingAreas` / shared canonical data | read | never duplicate |
| Seasons | DNS Core | `seasons` / shared canonical data | read | never duplicate |
| Organization / region logos | DNS Shared Data | `brand/regions/manifest.json` bindings | read | resolve centrally |
| Order catalogue | DNS Data Entry / DNS Core | `orderCatalogItems` | read | every order article comes from this catalogue |
| Ordered quantities | DNS Data Entry | `ticketOrders` + `ticketOrderLines` | read | operational quantity comes only from Data Entry |
| FAIR membership contribution | FAIR | published FAIR billing payload | read | freeze source id/revision/amount in BillingLine |
| IDM Premium program | DNS Core | `idmPremiumPrograms` | read | never hard-code in Faktura |
| IDM organization allocation | DNS Core | `areaAllocationKeys` | read | use canonical revisioned allocation |
| Order article unit prices | DNS Core commercial config | `billingRateConfigs` | admin read/write | one rate per catalogue item + source/revision |
| Additional organization-specific items/services | DNS Core commercial config | `billingSeasonalExtras` | admin read/write | use for graphics, maps, jackets and other extras; do not create a parallel catalogue |
| Confirmation state | Faktura v2 | `fakturaConfirmations` | own | revisioned lifecycle |
| Confirmation token / ledger | Faktura v2 | `fakturaConfirmationTokens`, `fakturaConfirmationLedgers` | own | security / concurrency state |
| Billing snapshot | Faktura v2 | `fakturaBillingSheets` | own | DRAFT mutable; READY/INVOICED immutable |
| Payment | Faktura v2 | `fakturaPayments` | own | operational only |
| Delivery | Faktura v2 | `fakturaDeliveries` | own | order-scoped physical fulfillment |
| Audit events | Faktura v2 | `fakturaEvents` | own | append-only |

## Quantity semantics

Faktura must never substitute source-document quantities for operational quantities.

For order catalogue items:

`orderedQuantity` = value persisted by DNS Data Entry in `ticketOrderLines.quantity`.

Pocketfolder metadata such as `sourcePrinterTotal2026`, commercial-rate `source.totalQuantity`, package size or supplier offer quantities are provenance/reference values only. They are never a Faktura billing quantity.

The order-to-billing path remains:

`Data Entry orderedQuantity -> Confirmation proposed/requested/confirmedQuantity -> BillingLine quantity -> Delivery deliveredQuantity`.

Billing uses CONFIRMED Confirmation quantities, not raw Data Entry order quantities.

## Commercial price semantics

`billingRateConfigs` owns the unit price used for order catalogue items.

The supplier offer may retain:
- supplier
- document label/date
- total source quantity
- total source amount
- pack size
- pack net price
- calculated purchase unit price

These fields explain the rate; they do not override Data Entry quantities.

Faktura billing unit prices are normalized upward to the nearest cent:
- 0.159 -> 0.16
- 0.0901 -> 0.10
- 1.231 -> 1.24
- 0.15 -> 0.15

## Additional services / articles

Existing `billingSeasonalExtras` is the canonical DNS Core source for organization-scoped additional charges.

It already supports:
- organization / reporting-area scope
- description
- quantity
- unit amount
- calculated amount
- source document
- supplier / document date
- revision
- optional category/unit/catalog relationship fields used by the previous Faktura implementation

Examples such as Grafikarbeiten and Kartenarbeiten must be separate source groups/rows, not a new Faktura-side master collection.

The Faktura v2 adapter maps active `billingSeasonalExtras` records into revisioned `MANUAL_SERVICE` BillingLines and revalidates them before READY.

## Production audit evidence

The successful DNS Core Faktura v2 cutover activation audit on 2026-10-03 reported:
- structuralReady: true
- activationReady: true
- orderLines: 263
- activeRates: 15
- activeSeasonalExtras: 0
- allocationKeys: 16
- confirmations: 0 at activation time
- v2 BillingSheets / Deliveries: 0 at activation time

A later order-status audit reported 47 order headers for 2026-27, all still DRAFT at that point. The UI may display these orders, but Confirmation/Billing may not treat them as submitted until Data Entry changes their lifecycle state.

## Non-duplication rules

1. Do not use `fakturaManualSources` as a second commercial catalogue while Core sources above are sufficient.
2. Do not copy Data Entry order quantities into a second persistent Faktura quantity table.
3. Do not derive billing from `sourcePrinterTotal2026` or supplier offer quantities.
4. Do not recreate FAIR or IDM calculations inside Faktura.
5. Do not restore v1 `billingRuns`, `billingLines`, `commercialRates` or `seasonalExtras` engines.
6. UI convenience views may aggregate/group Core records, but persistence stays canonical.
