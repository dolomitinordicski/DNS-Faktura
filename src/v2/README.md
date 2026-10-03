# DNS Faktura v2 — active runtime core

Faktura v2 is the active production runtime.

The legacy v1 billing engine and panels were removed during the controlled cutover. A pre-cutover recovery branch remains available:

`archive/faktura-v1-pre-v2-cutover-2026-10-03`

## Active architecture

Order source -> Confirmation -> BillingSheet -> READY -> INVOICED -> PaymentCase -> Delivery

Runtime source of truth:
- `src/v2/domain`
- `src/v2/engine`
- `src/v2/application`
- `src/v2/adapters`
- `src/v2/persistence`

Infrastructure retained outside v2:
- `src/services/auth.ts`
- `src/services/dnsCore.ts`
- `src/services/designSystem.ts`

The domain/engine layer remains framework-agnostic.

## Governance

- DNS Foundation dependency is pinned to immutable release tag `foundation-v1.2.0`.
- Canonical DNS Core Firestore rules and governed IDM/rate configuration live in `dns-shared-data`.
- Public Confirmation browser access never receives direct Firestore permissions.
- Firestore transaction/concurrency behavior is covered by emulator integration tests.
- `npm run audit:v2-cutover` fails if known legacy v1 runtime files or tokens reappear.

## CI gates

Every relevant main/PR change validates:
- domain scenarios
- migration/tooling syntax
- no-legacy runtime audit
- Firestore + Functions emulator integration
- TypeScript/Vite build
- Foundation immutable pin

## Public Confirmation Functions

The server-side Functions implementation is complete and emulator-tested:
- `resolvePublicConfirmation`
- `submitPublicConfirmation`

Production deployment is intentionally separate from the internal web cutover.

At the 2026-10-03 cutover, deployment was blocked because Google Cloud APIs required by Cloud Functions were not yet enabled in project `dns-core`, and the CI service account is not authorized to enable project services.

The internal Faktura v2 web runtime remains active and does not expose the public Confirmation UI until those Functions are deployed.
