import test from 'node:test';
import assert from 'node:assert/strict';
import { key, releaseVersion, verifyState, needsUpdate } from './foundation-lock.mjs';

const tag = 'foundation-v1.4.1';
const sha = 'f6707bb305da5c79aa019f6a142eec69d43b1c1c';
function fixture() {
  const spec = 'github:dolomitinordicski/dns-shared-data#' + tag;
  return {
    pkg: { dependencies: { [key]: spec } },
    lock: { packages: {
      '': { dependencies: { [key]: spec } },
      ['node_modules/' + key]: { version: '1.4.1', resolved: 'git+ssh://git@github.com/dolomitinordicski/dns-shared-data.git#' + sha }
    } }
  };
}
test('accepts the release commit and matching installed package', () => {
  const {pkg, lock} = fixture();
  assert.equal(verifyState(pkg, lock, tag, sha, {name:key, version:'1.4.1'}).sha, sha);
  assert.equal(needsUpdate(pkg, lock, tag, sha), false);
});
for (const old of ['1.2.1', '1.3.0', '1.4.0']) {
  test('repairs stale ' + old + ' even when manifest already says 1.4.1', () => {
    const {pkg, lock} = fixture();
    lock.packages['node_modules/' + key].version = old;
    assert.equal(needsUpdate(pkg, lock, tag, sha), true);
    assert.throws(() => verifyState(pkg, lock, tag, sha));
  });
}
test('rejects the wrong commit even with a matching version', () => {
  const {pkg, lock} = fixture();
  lock.packages['node_modules/' + key].resolved = 'git+ssh://git@github.com/dolomitinordicski/dns-shared-data.git#' + '0'.repeat(40);
  assert.equal(needsUpdate(pkg, lock, tag, sha), true);
});
test('rejects stale root metadata and missing lock entries', () => {
  const {pkg, lock} = fixture();
  lock.packages[''].dependencies[key] = 'github:dolomitinordicski/dns-shared-data#foundation-v1.3.0';
  assert.throws(() => verifyState(pkg, lock, tag, sha), /root is stale/);
  delete lock.packages['node_modules/' + key];
  assert.equal(needsUpdate(pkg, lock, tag, sha), true);
});
test('rejects the old installed package', () => {
  const {pkg, lock} = fixture();
  assert.throws(() => verifyState(pkg, lock, tag, sha, {name:key, version:'1.3.0'}), /Installed/);
});
test('validates strict tags and supports devDependencies', () => {
  for (const invalid of ['main','foundation-v1.4','foundation-v1.4.1;echo bad','foundation-v01.4.1']) {
    assert.throws(() => releaseVersion(invalid));
  }
  const {pkg, lock} = fixture();
  pkg.devDependencies = pkg.dependencies; delete pkg.dependencies;
  lock.packages[''].devDependencies = lock.packages[''].dependencies;
  delete lock.packages[''].dependencies;
  assert.equal(needsUpdate(pkg, lock, tag, sha), false);
});
