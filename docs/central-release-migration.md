# DNS-Faktura — central Firebase Functions release (preparation only)

Status: **prepared for integration; NOT wired to a production deploy**. This change lives only in the DNS-Faktura feature branch. The existing `.github/workflows/deploy-faktura-functions.yml` and PR #44 are intentionally unchanged. No code or settings in `dns-shared-data` are modified.

## Source contract
- Repository: `dolomitinordicski/DNS-Faktura`
- Approved source: immutable **full commit SHA** from the protected `main` branch, never a floating branch name, PR head, tag controlled by the caller, or user-supplied repository URL.
- Files: `firebase.json`, `.firebaserc`, `functions/**`, `release/central-functions-contract.json`
- Firebase project: `dns-core`; region: `europe-west1`; Node runtime: `nodejs22`.
- Allowlisted exports: `resolvePublicConfirmation`, `submitPublicConfirmation`.
- Verification: `node scripts/verify-central-release.mjs` and `node --check functions/src/index.mjs`, plus existing Faktura domain and emulator CI.

## Future central controller requirements (for WORK to implement in dns-shared-data later)
1. A protected `dns-shared-data` workflow is triggered manually from `main`, selecting a reviewed full commit SHA of DNS-Faktura. It must run under `dns-release-approval` with reviewer Bergtripper and deployment branch `main` only.
2. Before any credential is available, verify the source commit belongs to DNS-Faktura's protected `main` history, that its PR/required checks and review policy are satisfied, and that the caller cannot override repository, project, function targets or commands.
3. Fetch exactly that commit in a **credential-free validation job**. Pin checkout action versions and never pass credentials to repository scripts. Run preflight and existing Faktura tests before any production job.
4. In the separately approved production job, checkout the **same immutable SHA**, verify its identity/content again, authenticate using a *dedicated* restricted identity from the central environment (ideally Google OIDC/WIF), and deploy **only the two allowlisted functions** into `dns-core`. Do **not** run an unrestricted `--only functions` deploy, which could affect other Functions.
5. Record SHA, authorizing PR, approver, exact exported function targets, Firebase project, workflow run and result; verify deployed functions, region and runtime. Keep the older local deploy route available until the new path has successfully deployed and passed smoke tests.
6. Once the central route is working, use a **separate authorized PR** to remove/disable the local deploy workflow, followed by removal of old repository secrets and retirement of old keys after verifying no other consumers.

**Security limitations:** A ruleset on `dns-shared-data` does not protect DNS-Faktura source. Faktura's `main` must separately enforce reviewed changes, or the central controller must apply an equivalent trusted release approval before deployment. The local deploy workflow remains an independent production path until explicitly retired. Environment names are per-repository; this design executes the privileged deploy job inside `dns-shared-data`, not by borrowing its environment from Faktura.

## Current work acceptance
- [x] Release contract pins the project, runtime, region and public function exports.
- [x] PR preflight has no secret, environment, cloud authentication, Firebase deploy or write permissions.
- [x] Existing deploy workflow remains unchanged.
- [ ] Preflight CI passes on PR.
- [ ] Protected Faktura main and authenticated release provenance checked.
- [ ] Controller workflow and restricted deployment identity in Shared Data designed and reviewed.
- [ ] Central staged deploy and smoke tests successful.
- [ ] Legacy local deployment and secrets retired in a later approved change.

**No merge, deployment, IAM, environment or secret changes are authorized by this document.**
