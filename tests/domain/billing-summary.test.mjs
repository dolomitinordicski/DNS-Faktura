import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the pure domain helper in memory; no emulator or production data.
const code = readFileSync(new URL('../../src/v2/domain/billingSummary.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { latestFrozenBillingSheet, summarizeCurrentBilling } =
  await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const sheet = (revision, status, totalAmount) => ({ revision, status, totalAmount });

test('historic READY/INVOICED revisions are never counted twice', () => {
  const groups = [{ billingSheets: [sheet(1, 'INVOICED', 1000), sheet(2, 'READY', 1100)] }];
  assert.deepEqual(summarizeCurrentBilling(groups), { invoiced: 0, amount: 1100 });
});

test('newer draft does not suppress the last frozen billing snapshot', () => {
  const groups = [{ billingSheets: [sheet(1, 'INVOICED', 1000), sheet(2, 'DRAFT', 1200)] }];
  assert.deepEqual(summarizeCurrentBilling(groups), { invoiced: 1, amount: 1000 });
});

test('organizations with only drafts do not contribute to frozen totals', () => {
  assert.deepEqual(summarizeCurrentBilling([{ billingSheets: [sheet(1, 'DRAFT', 900)] }]),
    { invoiced: 0, amount: 0 });
});

test('summarizes latest frozen revision independently across organizations', () => {
  const groups = [
    { billingSheets: [sheet(1, 'READY', 100), sheet(2, 'INVOICED', 125)] },
    { billingSheets: [sheet(1, 'INVOICED', 33.33)] },
  ];
  assert.deepEqual(summarizeCurrentBilling(groups), { invoiced: 2, amount: 158.33 });
});

test('helper returns undefined when nothing is frozen', () => {
  assert.equal(latestFrozenBillingSheet([sheet(1, 'DRAFT', 42)]), undefined);
});
