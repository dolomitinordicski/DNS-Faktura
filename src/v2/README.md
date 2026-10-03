# Faktura v2 — isolated domain refactor

This directory is intentionally isolated from the current Faktura UI.

## Rules for this phase

- no React imports
- no Foundation / Design System changes
- no dns-shared-data changes
- no Firestore writes
- no merge to main until governance/foundation work is ready
- domain rules first, adapters and UI later

## Current phases

- F0 Operating Model: docs/faktura-v2/F0-operating-model.md
- F1 Domain Model: docs/faktura-v2/F1-domain-model.md
- F2 Data Ownership: docs/faktura-v2/F2-data-ownership.md
- F3 State Machines: docs/faktura-v2/F3-state-machines.md

## Engine modules

- confirmationEngine.ts
- billingEngine.ts
- deliveryEngine.ts

These modules must stay framework-agnostic.
