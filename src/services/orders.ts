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

export interface OrdersSourceSnapshot {
  state: 'ready';
  headers: OrderSourceHeader[];
  lines: OrderSourceLine[];
  catalog: OrderCatalogSourceItem[];
  byOrganization: Record<string, OrganizationOrderSummary>;
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

  const headers = headersSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(
      (item): item is OrderSourceHeader =>
        typeof item.id === 'string' &&
        typeof item.seasonId === 'string' &&
        typeof item.organizationId === 'string' &&
        validCategory(item.category) &&
        validStatus(item.status),
    );

  const lines = linesSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(
      (item): item is OrderSourceLine =>
        typeof item.id === 'string' &&
        typeof item.ticketOrderId === 'string' &&
        typeof item.seasonId === 'string' &&
        typeof item.organizationId === 'string' &&
        typeof item.catalogItemId === 'string' &&
        typeof item.quantity === 'number' &&
        Number.isFinite(item.quantity) &&
        item.quantity >= 0,
    );

  const catalog = catalogSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter(
      (item): item is OrderCatalogSourceItem =>
        typeof item.id === 'string' &&
        typeof item.code === 'string' &&
        validCategory(item.category),
    );

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

  return {
    state: 'ready',
    headers,
    lines,
    catalog,
    byOrganization,
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
