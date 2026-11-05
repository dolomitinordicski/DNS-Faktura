import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for the Workspace/Faktura shared Firebase Auth identity.
// The actual session handoff requires a browser integration test on the common origin.
const workspaceSource = readFileSync(new URL('../../src/services/dnsCore.ts', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../../src/services/auth.ts', import.meta.url), 'utf8');

test('Faktura uses the Workspace Firebase app identity name', () => {
  assert.match(workspaceSource, /WORKSPACE_FIREBASE_APP_NAME\s*=\s*'dns-digital-pass'/);
  assert.match(workspaceSource, /initializeApp\(firebaseConfig, WORKSPACE_FIREBASE_APP_NAME\)/);
  assert.match(workspaceSource, /getApps\(\)/);
});

test('Faktura still enforces DNS administrator role using a Firestore profile', () => {
  assert.match(authSource, /getAuth\(app\)/);
  assert.match(authSource, /getDoc\(doc\(db, 'users', uid\)\)/);
  assert.match(authSource, /data\.active === true/);
  assert.match(authSource, /globalRoles\?\.includes\('dns-admin'\)/);
});

test('no passwords or authentication tokens passed through navigation URLs', () => {
  assert.doesNotMatch(workspaceSource, /[?&](?:token|password|idToken)=/i);
});
