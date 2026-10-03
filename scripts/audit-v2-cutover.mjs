import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

const forbiddenFiles = [
  'src/components/BillingRunsPanel.tsx',
  'src/components/CommercialRatesPanel.tsx',
  'src/components/PricingAuditPanel.tsx',
  'src/components/SeasonalExtrasPanel.tsx',
  'src/components/UnifiedBillingPanel.tsx',
  'src/components/FakturaPrintSheet.tsx',
  'src/components/RegionLogos.tsx',
  'src/services/allocationKeys.ts',
  'src/services/billingRuns.ts',
  'src/services/commercialRates.ts',
  'src/services/fairSource.ts',
  'src/services/idmPremium.ts',
  'src/services/orderBilling.ts',
  'src/services/orders.ts',
  'src/services/regionLogos.ts',
  'src/services/seasonalExtras.ts',
  'src/services/unifiedBilling.ts',
  'src/services/unifiedBillingRuns.ts',
];

const allowedServiceFiles = new Set([
  'src/services/auth.ts',
  'src/services/designSystem.ts',
  'src/services/dnsCore.ts',
]);

const forbiddenRuntimeTokens = [
  'billingRuns',
  'billingLines',
  'UnifiedBillingPanel',
  'BillingRunsPanel',
  'CommercialRatesPanel',
  'PricingAuditPanel',
  'SeasonalExtrasPanel',
  'loadFairBillingSource',
  'loadOrdersSource',
  'calculateOrderBilling',
  'calculateUnifiedBilling',
  'IDM_PREMIUM_2026',
];

function walk(path) {
  const entries = [];
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    const stat = statSync(full);
    if (stat.isDirectory()) entries.push(...walk(full));
    else entries.push(full);
  }
  return entries;
}

const errors = [];

for (const path of forbiddenFiles) {
  if (existsSync(join(root, path))) {
    errors.push(`legacy file still exists: ${path}`);
  }
}

if (existsSync(join(root, 'src/services'))) {
  for (const file of walk(join(root, 'src/services'))) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (!allowedServiceFiles.has(rel)) {
      errors.push(`unexpected non-v2 service remains: ${rel}`);
    }
  }
}

const runtimeRoots = [
  'src/App.tsx',
  'src/components',
  'src/services',
  'src/v2/adapters',
  'src/v2/application',
  'src/v2/contracts',
  'src/v2/domain',
  'src/v2/engine',
  'src/v2/persistence',
];

for (const entry of runtimeRoots) {
  const full = join(root, entry);
  if (!existsSync(full)) continue;
  const files = statSync(full).isDirectory() ? walk(full) : [full];
  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
    const content = readFileSync(file, 'utf8');
    const rel = relative(root, file).replaceAll('\\', '/');
    for (const token of forbiddenRuntimeTokens) {
      if (content.includes(token)) {
        errors.push(`legacy runtime token ${token} found in ${rel}`);
      }
    }
  }
}

const seasonalExtraAdapterPath = join(
  root,
  'src/v2/adapters/seasonalExtras.ts',
);
if (!existsSync(seasonalExtraAdapterPath)) {
  errors.push('Core seasonal-extra v2 adapter missing');
} else {
  const seasonalExtraAdapterSource = readFileSync(
    seasonalExtraAdapterPath,
    'utf8',
  );
  if (!seasonalExtraAdapterSource.includes("'billingSeasonalExtras'")) {
    errors.push(
      'Core billingSeasonalExtras must be consumed only through the v2 adapter',
    );
  }
}

const coreCollectionBoundaryAllowed = new Set([
  'src/v2/adapters/seasonalExtras.ts',
  'src/v2/persistence/firestoreBillingSheetRepository.ts',
]);

for (const entry of runtimeRoots) {
  const full = join(root, entry);
  if (!existsSync(full)) continue;
  const files = statSync(full).isDirectory() ? walk(full) : [full];
  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
    const rel = relative(root, file).replaceAll('\\', '/');
    const content = readFileSync(file, 'utf8');
    if (
      content.includes('billingSeasonalExtras') &&
      !coreCollectionBoundaryAllowed.has(rel)
    ) {
      errors.push(
        `Core collection billingSeasonalExtras accessed outside v2 boundary: ${rel}`,
      );
    }
  }
}

if (!existsSync(join(root, 'src/v2'))) {
  errors.push('src/v2 missing');
}

const firebaseBackendSource = readFileSync(
  join(root, 'src/v2/adapters/firebaseBackends.ts'),
  'utf8',
);
if (
  firebaseBackendSource.includes("namedApp('dns-faktura-v2-core'") ||
  firebaseBackendSource.includes("initializeApp(dnsCoreConfig")
) {
  errors.push(
    'DNS Core v2 adapter must reuse the authenticated default Firebase app',
  );
}
if (!firebaseBackendSource.includes('fakturaV2CoreDb = dnsCoreDb')) {
  errors.push(
    'DNS Core v2 adapter is not wired to the authenticated shared db',
  );
}

const appSource = readFileSync(join(root, 'src/App.tsx'), 'utf8');
for (const marker of [
  'data-dns-tool-header',
  'dns-tool-header-shell',
  'data-dns-tool-nav',
  'dns-tab-nav',
  'dns-tab-active',
  'data-dns-tool-footer',
]) {
  if (!appSource.includes(marker)) {
    errors.push(`Foundation rendering contract missing from App.tsx: ${marker}`);
  }
}

if (errors.length) {
  console.error('DNS Faktura v2 cutover audit FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('DNS Faktura v2 cutover audit PASSED');
console.log('Runtime services: auth, designSystem, dnsCore + src/v2 only.');
