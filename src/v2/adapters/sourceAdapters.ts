import type {
  DataEntryOrderSource,
  FairContributionSource,
} from '../contracts/externalSources';
import type { Order } from '../domain/types';

export interface RawDataEntryOrderHeader {
  id: string;
  seasonId: string;
  organizationId: string;
  status: 'draft' | 'submitted' | 'confirmed' | 'fulfilled' | 'cancelled';
}

export interface RawDataEntryOrderLine {
  id: string;
  ticketOrderId: string;
  seasonId: string;
  organizationId: string;
  catalogItemId: string;
  quantity: number;
}

export interface RawDataEntryCatalogItem {
  id: string;
  category: string;
  code: string;
  label?: { de?: string; it?: string; en?: string };
}

export interface OrdersAdapterBackend {
  loadHeaders(seasonId: string): Promise<RawDataEntryOrderHeader[]>;
  loadLines(seasonId: string): Promise<RawDataEntryOrderLine[]>;
  loadCatalog(): Promise<RawDataEntryCatalogItem[]>;
}

export class OrdersAdapter implements DataEntryOrderSource {
  constructor(private readonly backend: OrdersAdapterBackend) {}

  async loadSubmittedOrders(seasonId: string): Promise<Order[]> {
    const [headers, lines, catalog] = await Promise.all([
      this.backend.loadHeaders(seasonId),
      this.backend.loadLines(seasonId),
      this.backend.loadCatalog(),
    ]);

    const headerById = new Map(headers.map((header) => [header.id, header]));
    const catalogById = new Map(catalog.map((item) => [item.id, item]));

    return headers
      .filter((header) => header.status === 'submitted')
      .map((header) => ({
        id: header.id,
        seasonId: header.seasonId,
        organizationId: header.organizationId,
        status: 'SUBMITTED' as const,
        lines: lines
          .filter((line) => line.ticketOrderId === header.id)
          .map((line) => {
            const item = catalogById.get(line.catalogItemId);
            return {
              id: line.id,
              catalogItemId: line.catalogItemId,
              category: item?.category ?? 'unknown',
              label:
                item?.label?.de ??
                item?.label?.it ??
                item?.label?.en ??
                item?.code ??
                line.catalogItemId,
              orderedQuantity: line.quantity,
              unit: 'piece' as const,
            };
          }),
      }))
      .filter((order) => headerById.has(order.id));
  }
}

export interface RawFairOrganizationRow {
  organizationId: string;
  totalAmount: number;
  sourceLabel: string;
  revision: number;
}

export interface FairAdapterBackend {
  loadPublishedRows(seasonId: string): Promise<RawFairOrganizationRow[]>;
}

export class FairAdapter implements FairContributionSource {
  constructor(private readonly backend: FairAdapterBackend) {}

  async loadContribution(input: {
    seasonId: string;
    organizationId: string;
  }) {
    const rows = await this.backend.loadPublishedRows(input.seasonId);
    const row = rows.find(
      (candidate) => candidate.organizationId === input.organizationId,
    );

    if (!row) return null;

    return {
      sourceId: `fair:${input.seasonId}:${input.organizationId}`,
      sourceRevision: row.revision,
      amount: row.totalAmount,
      documentLabel: row.sourceLabel,
    };
  }
}
