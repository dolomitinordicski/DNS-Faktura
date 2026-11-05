# Workspace staff SSO acceptance

The staff identity is `dns-core-staff` on `dns-core`, matching Workspace main.
`dns-digital-pass` is reserved for public customers. Never share that identity
with Faktura or pass credentials through URLs, iframe messages or query strings.
Existing `users/{uid}` active + `dns-admin` checks and server rules remain required.

## Automated preparation

- `npm run test:workspace-auth`: execute production Firebase initialization and
  profile checks using mocked SDK boundaries; verify staff/customer separation,
  reuse, incompatible project/API key rejection and non-admin/inactive denials.
- `npm run build` and `npm run audit:v2-cutover`.
- Run the existing Faktura v2 domain and Firestore/Functions emulator workflow.
- CI runs the auth regression suite before any Pages artifact is published.

## Browser acceptance after an explicitly authorized release

Use the same browser profile and origin `https://dolomitinordicski.github.io`.
Do not use a public customer or edit production invoices for this check.

1. Sign in to Workspace as an active DNS admin. Open Faktura through its tool
   drawer. The iframe must resolve staff authentication without another login.
2. Open Faktura as a standalone tool in the same browser. The same staff account
   must appear; check read-only listing of the intended 2026-27 billing season.
3. Repeat with an active non-admin test identity. Faktura must deny access, both
   embedded and standalone; no invoice data should be rendered.
4. Repeat with an inactive profile; deny. Repeat signed out; require staff login.
5. Log out of Workspace, reload Faktura, and confirm protected content is gone.
   Sign in again; confirm that a delayed old profile lookup cannot restore a
   previous user's admin state after logout or account switch.
6. In an isolated test profile verify that Digital Pass customer sign-in/sign-out
   does not replace the Workspace/Faktura staff session.
7. Check Workspace, Data Entry and Flyer Studio navigation and their existing
   permission checks. Do not deploy their pending auth migrations implicitly.

Record browser/version, deployed Workspace and Faktura SHAs, each identity role
(no passwords/tokens), iframe and standalone result. A successful build or mocked
unit test is not evidence that the live browser SSO acceptance has passed.

## Review blocker

At inspection time Bergtripper had repository permission `read`; owner
dolomitinordicski had `admin`. Read-only reviews do not satisfy required reviews.
Keep the ruleset intact. An independent eligible reviewer must have write access,
and review the final push. Granting access requires separate explicit owner
authorization; this PR does not change repository settings.
