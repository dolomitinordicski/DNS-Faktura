import type { BillingSheetRecord } from '../contracts/persistence';

/**
 * Count the latest frozen billing revision per organization.
 * A newer DRAFT does not erase an existing READY/INVOICED accounting snapshot.
 * Historical frozen revisions remain accessible, but must not be summed again.
 */
export function latestFrozenBillingSheet(
  sheets: readonly BillingSheetRecord[],
): BillingSheetRecord | undefined {
  return sheets
    .filter(sheet => sheet.status === 'READY' || sheet.status === 'INVOICED')
    .reduce<BillingSheetRecord | undefined>(
      (latest, sheet) => !latest || sheet.revision > latest.revision ? sheet : latest,
      undefined,
    );
}

export function summarizeCurrentBilling(
  groups: readonly { billingSheets: readonly BillingSheetRecord[] }[],
): { invoiced: number; amount: number } {
  const sheets = groups.map(group => latestFrozenBillingSheet(group.billingSheets))
    .filter((sheet): sheet is BillingSheetRecord => sheet !== undefined);
  return {
    invoiced: sheets.filter(sheet => sheet.status === 'INVOICED').length,
    amount: Math.round(sheets.reduce((sum, sheet) => sum + sheet.totalAmount, 0) * 100) / 100,
  };
}
