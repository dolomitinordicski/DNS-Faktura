import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const contract = readJson('release/central-functions-contract.json');
const firebase = readJson('firebase.json');
const functionsPackage = readJson('functions/package.json');
const source = readFileSync(resolve('functions/src/index.mjs'), 'utf8');

assert.equal(contract.schemaVersion, 1, 'Unexpected release contract version');
assert.equal(contract.repository, 'dolomitinordicski/DNS-Faktura');
assert.equal(contract.firebaseProject, 'dns-core');
assert.equal(contract.functionsSource, 'functions');
assert.equal(contract.runtime, 'nodejs22');
assert.equal(contract.region, 'europe-west1');
assert.deepEqual([...contract.functionExports].sort(), [
  'resolvePublicConfirmation',
  'submitPublicConfirmation',
]);

assert.equal(firebase.functions?.source, contract.functionsSource, 'Firebase source changed');
assert.equal(firebase.functions?.runtime, contract.runtime, 'Firebase runtime changed');
assert.equal(functionsPackage.type, 'module');
assert.equal(functionsPackage.main, 'src/index.mjs');
assert.equal(String(functionsPackage.engines?.node), '22');

const exportsFound = [...source.matchAll(/^export const (\w+)\s*=\s*onRequest\s*\(/gm)]
  .map((match) => match[1]).sort();
assert.deepEqual(exportsFound, [...contract.functionExports].sort(), 'Public function exports changed');

const regionsFound = [...source.matchAll(/region:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
assert.equal(regionsFound.length, contract.functionExports.length, 'Unexpected number of region declarations');
assert.ok(regionsFound.every((region) => region === contract.region), 'Region drift');

const projectConfig = readJson('.firebaserc');
assert.equal(projectConfig.projects?.default, contract.firebaseProject, 'Default Firebase project drift');

console.log('Faktura central release contract preflight: PASS (no credentials, no deployment).');
