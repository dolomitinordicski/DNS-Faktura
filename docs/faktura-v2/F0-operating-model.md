# DNS Faktura v2 — F0 Operating Model

Status: draft / isolated refactor branch  
Scope: business logic only. No UI, Foundation, Design System or dns-shared-data changes.

## Purpose

DNS Faktura is an **Order-to-Billing Workspace**.

It coordinates the operational path from an area order to confirmation, billing readiness, payment and delivery. It is not accounting software and does not issue the legally binding fiscal invoice.

## Core business flow

1. An area creates an order in DNS Data Entry.
2. DNS prepares one or more confirmation batches from selected order lines.
3. A confirmation may contain only selected groups or items, e.g. wristbands + tickets, while Pocketfolders remain outside.
4. The area receives a unique confirmation link.
5. The area may:
   - confirm the proposed quantities unchanged; or
   - request different quantities.
6. If quantities are changed, the confirmation enters CHANGE_REQUESTED and requires DNS review.
7. Once confirmed, confirmed quantities become eligible for billing.
8. For categories requiring prepayment:
   CONFIRMED -> BILLABLE -> INVOICED -> PAID -> READY_FOR_DELIVERY.
9. Delivery is tracked separately from order confirmation.
10. A billing sheet per organization and season aggregates FAIR, IDM, confirmed orders and manual/service lines.

## Fundamental quantity rule

Never collapse quantities into one field.

- orderedQuantity: requested in DNS Data Entry
- proposedQuantity: sent in a confirmation
- confirmedQuantity: formally accepted
- invoicedQuantity: included in an invoice/billing export
- deliveredQuantity: physically delivered

Historical quantities are never overwritten silently.

## Confirmation rule

A Confirmation is not a delivery receipt.

It is an **electronic order confirmation** and may happen before physical delivery.

One Order may have multiple Confirmation Batches.

## Billing rule

Order billing must use **confirmedQuantity**, never raw orderedQuantity.

Manual/service lines may use arbitrary units:
- piece
- hour
- flat
- km
- custom

## Scope boundaries

IN:
- order confirmation workflow
- partial confirmation batches
- change requests
- billing readiness
- operational payment status
- delivery readiness
- delivery tracking
- manual/service billing lines
- source/audit lineage
- immutable/revisioned snapshots

OUT:
- official invoice numbering
- VAT accounting
- journal entries
- payment reconciliation with bank
- statutory accounting records
- XGLA4 integration
- Foundation / Design System decisions

## Guiding principle

Build from real operational objects and transitions:
Order -> Confirmation -> Billing Sheet -> Payment -> Delivery.

Firebase collections, UI screens and shared-data contracts are implementation details to be defined after the domain model is stable.
