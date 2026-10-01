import type { BillingSeasonalExtra } from '@dolomitinordicski/dns-shared-data';
import type { AreaAllocationRecord } from './allocationKeys';
import type { FairBillingSnapshot } from './fairSource';
import {
  IDM_PREMIUM_2026,
  idmPremiumOrganizationAmount,
} from './idmPremium';
import type {
  OrderBillingSnapshot,
  OrganizationOrderBilling,
} from './orderBilling';
import type { OrganizationBillingRow } from '../types';

export const UNIFIED_BILLING_SOURCE_TYPES = [
  'fair-membership',
  'idm-premium-partner',
  'order',
  'seasonal-extra',
] as const;

export type UnifiedBillingSourceType =
  (typeof UNIFIED_BILLING_SOURCE_TYPES)[number];

export interface UnifiedBillingLine {
  key: string;
  sourceType: UnifiedBillingSourceType;
  sourceId: string;
  sourceLabel: string;
  sourceRevision?: number;
  catalogItemId?: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  rateId?: string;
  rateRevision?: number;
  sourceDocumentLabel?: string;
  notes?: string;
}

export interface OrganizationUnifiedBilling {
  organizationId: string;
  reportingAreaId?: string;
  lines: UnifiedBillingLine[];
  fairAmount: number;
  idmAmount: number;
  ordersAmount: number;
  extrasAmount: number;
  totalAmount: number;
  billedQuantity: number;
  unpricedQuantity: number;
  sourceState: 'complete' | 'incomplete';
  blockingReasons: string[];
  readyEligible: boolean;
}

export interface UnifiedBillingSnapshot {
  byOrganization: Record<string, OrganizationUnifiedBilling>;
  totalAmount: number;
  completeOrganizations: number;
  incompleteOrganizations: number;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isFinalFairStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized === 'approved' || normalized === 'final';
}

function activeAllocation(
  records: AreaAllocationRecord[],
  reportingAreaId: string | undefined,
) {
  if (!reportingAreaId) return undefined;
  return records.find(
    (record) => record.active && record.reportingAreaId === reportingAreaId,
  );
}

function orderBillingFor(
  orderBilling: OrderBillingSnapshot | null,
  organizationId: string,
): OrganizationOrderBilling | undefined {
  return orderBilling?.byOrganization[organizationId];
}

export function calculateUnifiedBilling({
  seasonId,
  organizations,
  fairSnapshot,
  fairAvailable,
  allocationRecords,
  allocationAvailable,
  orderBilling,
  ordersAvailable,
  seasonalExtras,
  extrasAvailable,
}: {
  seasonId: string;
  organizations: OrganizationBillingRow[];
  fairSnapshot: FairBillingSnapshot | null;
  fairAvailable: boolean;
  allocationRecords: AreaAllocationRecord[];
  allocationAvailable: boolean;
  orderBilling: OrderBillingSnapshot | null;
  ordersAvailable: boolean;
  seasonalExtras: BillingSeasonalExtra[];
  extrasAvailable: boolean;
}): UnifiedBillingSnapshot {
  const byOrganization = Object.fromEntries(
    organizations.map((organization) => {
      const lines: UnifiedBillingLine[] = [];
      const blockingReasons: string[] = [];

      let fairAmount = 0;
      if (!fairAvailable || !fairSnapshot) {
        blockingReasons.push('fair-source-unavailable');
      } else {
        const fair = fairSnapshot.organizations.find(
          (row) => row.organizationId === organization.organizationId,
        );
        if (!fair) {
          blockingReasons.push('fair-organization-missing');
        } else {
          fairAmount = roundMoney(fair.totalAmount);
          lines.push({
            key: 'fair',
            sourceType: 'fair-membership',
            sourceId: `${fairSnapshot.seasonId}__${organization.organizationId}`,
            sourceLabel: `${fairSnapshot.source} · ${fairSnapshot.status}`,
            description: 'Mitgliedsbeitrag / FAIR',
            quantity: 1,
            unitAmount: fairAmount,
            amount: fairAmount,
            notes: `FAIR status: ${fairSnapshot.status}`,
          });
        }

        if (!isFinalFairStatus(fairSnapshot.status)) {
          blockingReasons.push('fair-not-final');
        }
      }

      let idmAmount = 0;
      const participatesInIdm = Boolean(
        organization.reportingAreaId &&
          IDM_PREMIUM_2026.reportingAreaIds.includes(
            organization.reportingAreaId as (typeof IDM_PREMIUM_2026.reportingAreaIds)[number],
          ),
      );

      if (participatesInIdm) {
        if (!allocationAvailable) {
          blockingReasons.push('idm-allocation-unavailable');
        } else {
          const allocation = activeAllocation(
            allocationRecords,
            organization.reportingAreaId,
          );
          const allocationRow = allocation?.allocations.find(
            (row) => row.organizationId === organization.organizationId,
          );
          if (!allocation || !allocationRow) {
            blockingReasons.push('idm-allocation-missing');
          } else {
            idmAmount = idmPremiumOrganizationAmount({
              seasonId,
              reportingAreaId: organization.reportingAreaId,
              distributionKey: allocationRow.share,
            });
            lines.push({
              key: 'idm',
              sourceType: 'idm-premium-partner',
              sourceId: allocation.id,
              sourceLabel: IDM_PREMIUM_2026.sourceLabel,
              sourceRevision: allocation.revision,
              description: 'IDM Premiumpartner',
              quantity: 1,
              unitAmount: idmAmount,
              amount: idmAmount,
              notes: `${IDM_PREMIUM_2026.amountPerReportingArea} EUR × ${allocationRow.share}`,
            });
          }
        }
      }

      const orders = orderBillingFor(
        ordersAvailable ? orderBilling : null,
        organization.organizationId,
      );
      let ordersAmount = 0;
      let billedQuantity = 0;
      let unpricedQuantity = 0;

      if (!ordersAvailable || !orderBilling) {
        blockingReasons.push('orders-source-unavailable');
      } else if (orders) {
        ordersAmount = roundMoney(orders.amount);
        billedQuantity = orders.billedQuantity;
        unpricedQuantity = orders.unpricedQuantity;
        if (orders.unpricedQuantity > 0) {
          blockingReasons.push('orders-unpriced');
        }

        for (const line of orders.lines) {
          lines.push({
            key: `order__${line.catalogItemId}`,
            sourceType: 'order',
            sourceId: line.rateId,
            sourceLabel: line.sourceDocumentLabel,
            sourceRevision: line.rateRevision,
            catalogItemId: line.catalogItemId,
            description: line.description,
            quantity: line.quantity,
            unitAmount: line.unitAmount,
            amount: line.amount,
            rateId: line.rateId,
            rateRevision: line.rateRevision,
            sourceDocumentLabel: line.sourceDocumentLabel,
          });
        }
      }

      let extrasAmount = 0;
      if (!extrasAvailable) {
        blockingReasons.push('extras-source-unavailable');
      } else {
        for (const extra of seasonalExtras.filter(
          (item) =>
            item.active &&
            item.organizationId === organization.organizationId,
        )) {
          extrasAmount = roundMoney(extrasAmount + extra.amount);
          lines.push({
            key: `extra__${extra.id}`,
            sourceType: 'seasonal-extra',
            sourceId: extra.id,
            sourceLabel: extra.source.documentLabel,
            sourceRevision: extra.revision,
            description: extra.description,
            quantity: extra.quantity,
            unitAmount: extra.unitAmount,
            amount: extra.amount,
            sourceDocumentLabel: extra.source.documentLabel,
            notes: extra.notes,
          });
        }
      }

      const totalAmount = roundMoney(
        fairAmount + idmAmount + ordersAmount + extrasAmount,
      );
      const uniqueBlockingReasons = [...new Set(blockingReasons)];
      const sourceState =
        uniqueBlockingReasons.length === 0 ? 'complete' : 'incomplete';

      return [
        organization.organizationId,
        {
          organizationId: organization.organizationId,
          reportingAreaId: organization.reportingAreaId,
          lines,
          fairAmount,
          idmAmount,
          ordersAmount,
          extrasAmount,
          totalAmount,
          billedQuantity,
          unpricedQuantity,
          sourceState,
          blockingReasons: uniqueBlockingReasons,
          readyEligible: sourceState === 'complete' && unpricedQuantity === 0,
        } satisfies OrganizationUnifiedBilling,
      ];
    }),
  );

  const values = Object.values(byOrganization);
  return {
    byOrganization,
    totalAmount: roundMoney(
      values.reduce((sum, row) => sum + row.totalAmount, 0),
    ),
    completeOrganizations: values.filter(
      (row) => row.sourceState === 'complete',
    ).length,
    incompleteOrganizations: values.filter(
      (row) => row.sourceState === 'incomplete',
    ).length,
  };
}
