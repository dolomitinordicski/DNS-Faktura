import type { BillingCommercialRate } from '@dolomitinordicski/dns-shared-data';
import type { OrdersSourceSnapshot } from './orders';

export interface OrganizationOrderBilling {
  organizationId: string;
  activeQuantity: number;
  billedQuantity: number;
  unpricedQuantity: number;
  amount: number;
  missingCatalogItemIds: string[];
}

export interface OrderBillingSnapshot {
  byOrganization: Record<string, OrganizationOrderBilling>;
  totalAmount: number;
  activeQuantity: number;
  billedQuantity: number;
  unpricedQuantity: number;
  missingCatalogItemIds: string[];
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
  const mutable = new Map<
    string,
    {
      activeQuantity: number;
      billedQuantity: number;
      unpricedQuantity: number;
      amount: number;
      missingCatalogItemIds: Set<string>;
    }
  >();

  for (const line of orders.lines) {
    const header = headerById.get(line.ticketOrderId);
    if (!header || header.status === 'cancelled' || header.status === 'draft') continue;

    const current = mutable.get(line.organizationId) ?? {
      activeQuantity: 0,
      billedQuantity: 0,
      unpricedQuantity: 0,
      amount: 0,
      missingCatalogItemIds: new Set<string>(),
    };

    current.activeQuantity += line.quantity;
    const rate = activeRateByCatalogItem.get(line.catalogItemId);
    if (rate) {
      current.billedQuantity += line.quantity;
      current.amount += line.quantity * rate.billingUnitPrice;
    } else {
      current.unpricedQuantity += line.quantity;
      current.missingCatalogItemIds.add(line.catalogItemId);
    }
    mutable.set(line.organizationId, current);
  }

  const byOrganization = Object.fromEntries(
    [...mutable.entries()].map(([organizationId, item]) => [
      organizationId,
      {
        organizationId,
        activeQuantity: item.activeQuantity,
        billedQuantity: item.billedQuantity,
        unpricedQuantity: item.unpricedQuantity,
        amount: Math.round(item.amount * 100) / 100,
        missingCatalogItemIds: [...item.missingCatalogItemIds].sort(),
      },
    ]),
  );

  const values = Object.values(byOrganization);
  const missingCatalogItemIds = [
    ...new Set(values.flatMap((item) => item.missingCatalogItemIds)),
  ].sort();

  return {
    byOrganization,
    totalAmount:
      Math.round(values.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
    activeQuantity: values.reduce((sum, item) => sum + item.activeQuantity, 0),
    billedQuantity: values.reduce((sum, item) => sum + item.billedQuantity, 0),
    unpricedQuantity: values.reduce((sum, item) => sum + item.unpricedQuantity, 0),
    missingCatalogItemIds,
  };
}
