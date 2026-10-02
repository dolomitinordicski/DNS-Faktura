# DNS Faktura v2 — F3 State Machines

## Order
DRAFT -> SUBMITTED

Order lifecycle is owned by DNS Data Entry.

## Confirmation
DRAFT -> SENT

From SENT:
- unchanged acceptance -> CONFIRMED
- changed quantities -> CHANGE_REQUESTED

CHANGE_REQUESTED -> CONFIRMED after DNS approval  
CHANGE_REQUESTED -> DRAFT when DNS rejects/reworks and issues a new revision

Terminal historical confirmation revisions are never edited in place.

## Billing Sheet
DRAFT -> READY -> INVOICED

READY means:
- all mandatory source lines are complete
- all ORDER_CONFIRMATION quantities are confirmed
- all required prices exist
- snapshot revision is frozen

Any later business change requires a new DRAFT revision.

## Payment
OPEN -> PAID

Used operationally only.

For lines/categories with prepaymentRequired = true:
delivery readiness requires PAID.

## Delivery
PENDING -> PARTIAL -> DELIVERED

A delivery may remain PARTIAL while remainingQuantity > 0.

## Important guards

- SENT confirmation cannot be confirmed if any requested quantity is pending DNS review.
- ORDER_CONFIRMATION billing cannot use a SENT or CHANGE_REQUESTED confirmation.
- deliveredQuantity cannot exceed confirmedQuantity unless a new confirmation/revision exists.
- READY billing snapshots are immutable.
