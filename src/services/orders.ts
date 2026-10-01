import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from './dnsCore';

export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'fulfilled'
  | 'cancelled';

export type OrderCategory = 'ticket' | 'wristband' | 'pocketfolder';

export interface OrderSourceHeader {
  id: string;
  seasonId: string;
  organizationId: string;
  reportingAreaId?: string;
  category: OrderCategory;
  status: OrderStatus;
}

export interface OrderSourceLine {
  id: string;
  ticketOrderId: string;
  seasonId: string;
  organizationId: string;
  reportingAreaId?: string;
  catalogItemId: string;
  quantity: number;
}

export interface OrderCatalogSourceItem {
  id: string;
  category: OrderCategory;
  code: string;
  label?: { de?: string; it?: string; en?: string };
  productCode?: string;
}

export interface OrganizationOrderSummary {
  organizationId: string;
  orderCount: number;
  activeOrderCount: number;
  draftOrderCount: number;
  activeQuantity: number;
  draftQuantity: number;
  categories: OrderCategory[];
}

export interface CatalogOrderSummary {
  catalogItemId: string;
  activeQuantity: number;
  draftQuantity: number;
}

export interface OrdersSourceSnapshot {
  state: 'ready';
  headers: OrderSourceHeader[];
  lines: OrderSourceLine[];
  catalog: OrderCatalogSourceItem[];
  byOrganization: Record<string, OrganizationOrderSummary>;
  byCatalogItem: Record<string, CatalogOrderSummary>;
  activeQuantity: number;
  draftQuantity: number;
}

function validStatus(value: unknown): value is OrderStatus {
  return (
    value === 'draft' ||
    value === 'submitted' ||
    value === 'confirmed' ||
    value === 'fulfilled' ||
    value === 'cancelled'
  );
}

function validCategory(value: unknown): value is OrderCategory {
  return value === 'ticket' || value === 'wristband' || value === 'pocketfolder';
}

export async function loadOrdersSource(
  seasonId: string,
): Promise<OrdersSourceSnapshot> {
  const [headersSnapshot, linesSnapshot, catalogSnapshot] = await Promise.all([
    getDocs(
      query(collection(db, 'ticketOrders'), where('seasonId', '==', seasonId)),
    ),
    getDocs(
      query(collection(db, 'ticketOrderLines'), where('seasonId', '==', seasonId)),
    ),
    getDocs(collection(db, 'orderCatalogItems')),
  ]);

  const headers = headersSnapshot.docs.flatMap((item) => {
    const data = item.data() as Record<string, unknown>;
    if (
      typeof data.seasonId !== 'string' ||
      typeof data.organizationId !== 'string' ||
      !validCategory(data.category) ||
      !validStatus(data.status)
    ) {
      return [];
    }

    const header: OrderSourceHeader = {
      id: item.id,
      seasonId: data.seasonId,
      organizationId: data.organizationId,
      category: data.category,
      status: data.status,
    };
    if (typeof data.reportingAreaId === 'string') {
      header.reportingAreaId = data.reportingAreaId;
    }
    return [header];
  });

  const lines = linesSnapshot.docs.flatMap((item) => {
    const data = item.data() as Record<string, unknown>;
    if (
      typeof data.ticketOrderId !== 'string' ||
      typeof data.seasonId !== 'string' ||
      typeof data.organizationId !== 'string' ||
      typeof data.catalogItemId !== 'string' ||
      typeof data.quantity !== 'number' ||
      !Number.isFinite(data.quantity) ||
      data.quantity < 0
    ) {
      return [];
    }

    const line: OrderSourceLine = {
      id: item.id,
      ticketOrderId: data.ticketOrderId,
      seasonId: data.seasonId,
      organizationId: data.organizationId,
      catalogItemId: data.catalogItemId,
      quantity: data.quantity,
    };
    if (typeof data.reportingAreaId === 'string') {
      line.reportingAreaId = data.reportingAreaId;
    }
    return [line];
  });

  const catalog = catalogSnapshot.docs.flatMap((item) => {
    const data = item.data() as Record<string, unknown>;
    if (typeof data.code !== 'string' || !validCategory(data.category)) {
      return [];
    }

    const catalogItem: OrderCatalogSourceItem = {
      id: item.id,
      category: data.category,
      code: data.code,
    };

    if (
      data.label &&
      typeof data.label === 'object' &&
      !Array.isArray(data.label)
    ) {
      catalogItem.label = data.label as OrderCatalogSourceItem['label'];
    }
    if (typeof data.productCode === 'string') {
      catalogItem.productCode = data.productCode;
    }
    return [catalogItem];
  });

  const headerById = new Map(headers.map((header) => [header.id, header]));
  const mutable = new Map<
    string,
    {
      orderIds: Set<string>;
      activeOrderIds: Set<string>;
      draftOrderIds: Set<string>;
      activeQuantity: number;
      draftQuantity: number;
      categories: Set<OrderCategory>;
    }
  >();

  for (const header of headers) {
    if (header.status === 'cancelled') continue;
    const current = mutable.get(header.organizationId) ?? {
      orderIds: new Set<string>(),
      activeOrderIds: new Set<string>(),
      draftOrderIds: new Set<string>(),
      activeQuantity: 0,
      draftQuantity: 0,
      categories: new Set<OrderCategory>(),
    };
    current.orderIds.add(header.id);
    current.categories.add(header.category);
    if (header.status === 'draft') current.draftOrderIds.add(header.id);
    else current.activeOrderIds.add(header.id);
    mutable.set(header.organizationId, current);
  }

  for (const line of lines) {
    const header = headerById.get(line.ticketOrderId);
    if (!header || header.status === 'cancelled') continue;
    const current = mutable.get(line.organizationId);
    if (!current) continue;
    if (header.status === 'draft') current.draftQuantity += line.quantity;
    else current.activeQuantity += line.quantity;
  }

  const byOrganization = Object.fromEntries(
    [...mutable.entries()].map(([organizationId, summary]) => [
      organizationId,
      {
        organizationId,
        orderCount: summary.orderIds.size,
        activeOrderCount: summary.activeOrderIds.size,
        draftOrderCount: summary.draftOrderIds.size,
        activeQuantity: summary.activeQuantity,
        draftQuantity: summary.draftQuantity,
        categories: [...summary.categories].sort(),
      },
    ]),
  );

  const catalogSummary = new Map<string, CatalogOrderSummary>();
  for (const line of lines) {
    const header = headerById.get(line.ticketOrderId);
    if (!header || header.status === 'cancelled') continue;
    const current = catalogSummary.get(line.catalogItemId) ?? {
      catalogItemId: line.catalogItemId,
      activeQuantity: 0,
      draftQuantity: 0,
    };
    if (header.status === 'draft') current.draftQuantity += line.quantity;
    else current.activeQuantity += line.quantity;
    catalogSummary.set(line.catalogItemId, current);
  }
  const byCatalogItem = Object.fromEntries(catalogSummary.entries());

  return {
    state: 'ready',
    headers,
    lines,
    catalog,
    byOrganization,
    byCatalogItem,
    activeQuantity: Object.values(byOrganization).reduce(
      (sum, item) => sum + item.activeQuantity,
      0,
    ),
    draftQuantity: Object.values(byOrganization).reduce(
      (sum, item) => sum + item.draftQuantity,
      0,
    ),
  };
}
