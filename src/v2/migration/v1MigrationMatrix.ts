export type MigrationAction =
  | 'KEEP_INFRASTRUCTURE'
  | 'REWRITE_ADAPTER'
  | 'MIGRATE_DATA'
  | 'DELETE_AFTER_CUTOVER';

export interface MigrationItem {
  path: string;
  action: MigrationAction;
  target?: string;
  reason: string;
}

export const FAKTURA_V1_MIGRATION_MATRIX: MigrationItem[] = [
  {
    path: 'src/services/orders.ts',
    action: 'REWRITE_ADAPTER',
    target: 'src/v2/adapters/sourceAdapters.ts + firebaseBackends.ts',
    reason: 'Preserve real Data Entry schema knowledge, replace v1 billing aggregation.',
  },
  {
    path: 'src/services/fairSource.ts',
    action: 'REWRITE_ADAPTER',
    target: 'src/v2/adapters/sourceAdapters.ts + firebaseBackends.ts',
    reason: 'Preserve published FAIR source mapping without v1 UI coupling.',
  },
  {
    path: 'src/services/dnsCore.ts',
    action: 'KEEP_INFRASTRUCTURE',
    reason: 'DNS Core bootstrap and master-data access remain infrastructure.',
  },
  {
    path: 'src/services/auth.ts',
    action: 'KEEP_INFRASTRUCTURE',
    reason: 'Authentication is independent from v1 billing semantics.',
  },
  {
    path: 'src/services/commercialRates.ts',
    action: 'MIGRATE_DATA',
    target: 'dns-shared-data billingRateConfigs + v2 CatalogPriceAdapter',
    reason: 'Keep verified rates and provenance, rebuild the service.',
  },
  {
    path: 'src/services/idmPremium.ts',
    action: 'MIGRATE_DATA',
    target: 'dns-shared-data idmPremiumPrograms + v2 FirebaseIdmBackend',
    reason: 'Keep verified configuration, remove hard-coded service.',
  },
  {
    path: 'src/services/seasonalExtras.ts',
    action: 'MIGRATE_DATA',
    target: 'MANUAL_SERVICE',
    reason: 'Only meaningful active records survive as MANUAL_SERVICE candidates; concept is not retained.',
  },
  {
    path: 'src/services/orderBilling.ts',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'Direct order-to-billing semantics conflict with Confirmation-based v2.',
  },
  {
    path: 'src/services/billingRuns.ts',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'Superseded by revisioned BillingSheet persistence.',
  },
  {
    path: 'src/services/unifiedBilling.ts',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'Superseded by adapters, freshness and readiness engines.',
  },
  {
    path: 'src/services/unifiedBillingRuns.ts',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'Superseded by immutable BillingSheet revisions.',
  },
  {
    path: 'src/components/BillingRunsPanel.tsx',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'v1 information architecture.',
  },
  {
    path: 'src/components/CommercialRatesPanel.tsx',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'v1 information architecture.',
  },
  {
    path: 'src/components/PricingAuditPanel.tsx',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'v1 information architecture.',
  },
  {
    path: 'src/components/SeasonalExtrasPanel.tsx',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'Seasonal Extras is removed as a core v2 concept.',
  },
  {
    path: 'src/components/UnifiedBillingPanel.tsx',
    action: 'DELETE_AFTER_CUTOVER',
    reason: 'v1 information architecture.',
  },
];

export function migrationItemsByAction(action: MigrationAction) {
  return FAKTURA_V1_MIGRATION_MATRIX.filter((item) => item.action === action);
}
