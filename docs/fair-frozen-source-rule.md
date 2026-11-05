# Faktura v2 — frozen FAIR source rule

The FAIR amounts used in Faktura must come from **the frozen/published FAIR
billing snapshot for the relevant season**. The billing workflow must not replace
that basis with later editable or live FAIR calculations.

Before any further FAIR integration work:
- Identify and confirm the canonical immutable FAIR snapshot document and its
  version/revision with the FAIR owners.
- Verify that the adapter reads that snapshot, not an editable FAIR worksheet.
- Verify the exact retained snapshot identifiers in billing source provenance.
- Do not introduce a late-stage comparison against mutable FAIR data when
  transitioning a Billing Sheet from DRAFT to READY.
- Changes to a frozen FAIR snapshot, if formally reissued, must be handled
  through an explicit billing revision/audit process, never silent repricing.

This note clarifies the approved business rule only. No FAIR source, transaction,
Firestore schema, permissions, or deployment behavior is changed by this PR.
