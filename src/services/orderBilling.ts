import type { BillingCommercialRate } from '@dolomitinordicski/dns-shared-data';
import type { OrdersSourceSnapshot } from './orders';

export const ORDER_BILLING_STATUSES = [
  'submitted',
  'confirmed',
  'fulfilled',
] as const;

const billableStatusSet = new Set<string>(ORDER_BILLING_STATUSES);

export interface OrganizationOrderBillingLine {
  catalogItemId: string;
  description: string;
  quantity: number;
  rateId: string;
  rateRevision: number;
  sourceDocumentLabel: string;
  unitAmount: number;
  amount: number;
}

export interface OrganizationOrderBilling {
  organizationId: string;
  activeQuantity: number;
  billedQuantity: number;
  unpricedQuantity: number;
  amount: number;
  missingCatalogItemIds: string[];
  lines: OrganizationOrderBillingLine[];
}

export interface OrderBillingSnapshot {
  byOrganization: Record<string, OrganizationOrderBilling>;
  totalAmount: number;
  activeQuantity: number;
  billedQuantity: number;
  unpricedQuantity: number;
  missingCatalogItemIds: string[];
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateOrderBilling(
  orders: OrdersSourceSnapshot,
  rates: BillingCommercialRate[],
): OrderBillingSnapshot {
  const activeRateByCatalogItem = new Map(
    rates
      .filter((rate) => rate.active)
      .map((rate) => [rate.catalogItemId, rate]),
  );
  const headerById = new Map(orders.headers.map((header) => [header.id, header]));
  const catalogById = new Map(orders.catalog.map((item) => [item.id, item]));
  const mutable = new Map<
    string,
    {
      activeQuantity: number;
      unpricedQuantity: number;
      missingCatalogItemIds: Set<string>;
      pricedQuantityByCatalogItem: Map<string, number>;
    }
  >();

  for (const line of orders.lines) {
    const header = headerById.get(line.ticketOrderId);
    if (!header || !billableStatusSet.has(header.status)) continue;

    const current = mutable.get(line.organizationId) ?? {
      activeQuantity: 0,
      unpricedQuantity: 0,
      missingCatalogItemIds: new Set<string>(),
      pricedQuantityByCatalogItem: new Map<string, number>(),
    };

    current.activeQuantity += line.quantity;
    const rate = activeRateByCatalogItem.get(line.catalogItemId);
    if (rate) {
      current.pricedQuantityByCatalogItem.set(
        line.catalogItemId,
        (current.pricedQuantityByCatalogItem.get(line.catalogItemId) ?? 0) +
          line.quantity,
      );
    } else {
      current.unpricedQuantity += line.quantity;
      current.missingCatalogItemIds.add(line.catalogItemId);
    }
    mutable.set(line.organizationId, current);
  }

  const byOrganization = Object.fromEntries(
    [...mutable.entries()].map(([organizationId, item]) => {
      const lines = [...item.pricedQuantityByCatalogItem.entries()]
        .map(([catalogItemId, quantity]) => {
          const rate = activeRateByCatalogItem.get(catalogItemId);
          if (!rate) return null;
          const catalogItem = catalogById.get(catalogItemId);
          const description =
            catalogItem?.label?.de ??
            catalogItem?.label?.it ??
            catalogItem?.label?.en ??
            catalogItem?.code ??
            catalogItemId;
          return {
            catalogItemId,
            description,
            quantity,
            rateId: rate.id,
            rateRevision: rate.revision,
            sourceDocumentLabel: rate.source.documentLabel,
            unitAmount: rate.billingUnitPrice,
            amount: roundMoney(quantity * rate.billingUnitPrice),
          } satisfies OrganizationOrderBillingLine;
        })
        .filter(
          (line): line is OrganizationOrderBillingLine => line !== null,
        )
        .sort((a, b) => a.catalogItemId.localeCompare(b.catalogItemId));

      const billedQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
      const amount = roundMoney(
        lines.reduce((sum, line) => sum + line.amount, 0),
      );

      return [
        organizationId,
        {
          organizationId,
          activeQuantity: item.activeQuantity,
          billedQuantity,
          unpricedQuantity: item.unpricedQuantity,
          amount,
          missingCatalogItemIds: [...item.missingCatalogItemIds].sort(),
          lines,
        },
      ];
    }),
  );

  const values = Object.values(byOrganization);
  const missingCatalogItemIds = [
    ...new Set(values.flatMap((item) => item.missingCatalogItemIds)),
  ].sort();

  return {
    byOrganization,
    totalAmount: roundMoney(
      values.reduce((sum, item) => sum + item.amount, 0),
    ),
    activeQuantity: values.reduce((sum, item) => sum + item.activeQuantity, 0),
    billedQuantity: values.reduce((sum, item) => sum + item.billedQuantity, 0),
    unpricedQuantity: values.reduce(
      (sum, item) => sum + item.unpricedQuantity,
      0,
    ),
    missingCatalogItemIds,
  };
}
