import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute production modules at mocked Firebase boundaries; never use live data.
function loadModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function coreModule(apps = []) {
  const calls = [];
  const core = loadModule('../../src/services/dnsCore.ts', {
    'firebase/app': {
      getApps: () => apps,
      initializeApp: (options, name) => { const app = { options, name }; calls.push(app); return app; },
    },
    'firebase/firestore': { getFirestore: app => ({ app }) },
  });
  return { core, calls };
}

test('staff identity is separate from Digital Pass customers', () => {
  const customer = { name: 'dns-digital-pass', options: { projectId: 'dns-core' } };
  const { core, calls } = coreModule([customer]);
  assert.equal(core.app.name, 'dns-core-staff');
  assert.equal(calls.length, 1);
  assert.notEqual(core.app, customer);
  assert.equal(core.db.app, core.app);
});

test('reuse matching staff app; reject project or API key mismatch', () => {
  const app = coreModule().core.app;
  assert.equal(coreModule([app]).core.app, app);
  for (const options of [{ ...app.options, projectId: 'dns-polls' }, { ...app.options, apiKey: 'wrong' }]) {
    assert.throws(() => coreModule([{ ...app, options }]), /IDENTITY_MISMATCH/);
  }
});

test('staff Auth requires existing active DNS admin profile', async () => {
  const { core } = coreModule();
  let profile;
  let exists = true;
  const auth = loadModule('../../src/services/auth.ts', {
    './dnsCore': core,
    'firebase/auth': { getAuth: app => ({ app }) },
    'firebase/firestore': {
      doc: (db, collection, uid) => { assert.equal(db, core.db); assert.equal(collection, 'users'); assert.equal(uid, 'user'); },
      getDoc: async () => ({ exists: () => exists, data: () => profile }),
    },
  });
  assert.equal(auth.auth.app, core.app);
  for (const candidate of [{}, { active: false, globalRoles: ['dns-admin'] }, { active: true, globalRoles: ['partner'] }, { active: true, globalRoles: 'not-dns-admin' }]) {
    profile = candidate;
    assert.equal(await auth.isDNSAdmin('user'), false);
  }
  profile = { active: true, globalRoles: ['dns-admin'] };
  assert.equal(await auth.isDNSAdmin('user'), true);
  exists = false;
  assert.equal(await auth.isDNSAdmin('user'), false);
});
