import type {
  DataEntryOrderSource,
  FairContributionSource,
  IdmChargeSource,
  CatalogPriceSource,
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


export interface RawIdmAllocation {
  id: string;
  seasonId: string;
  reportingAreaId: string;
  organizationId: string;
  share: number;
  revision: number;
}

export interface RawIdmProgram {
  seasonId: string;
  amountPerReportingArea: number;
  reportingAreaIds: string[];
  sourceLabel: string;
  revision: number;
}

export interface IdmAdapterBackend {
  loadProgram(seasonId: string): Promise<RawIdmProgram | null>;
  loadAllocations(seasonId: string): Promise<RawIdmAllocation[]>;
}

export class IdmAdapter implements IdmChargeSource {
  constructor(private readonly backend: IdmAdapterBackend) {}

  async loadCharge(input: {
    seasonId: string;
    organizationId: string;
  }) {
    const [program, allocations] = await Promise.all([
      this.backend.loadProgram(input.seasonId),
      this.backend.loadAllocations(input.seasonId),
    ]);

    if (!program) return null;

    const allocation = allocations.find(
      (row) =>
        row.organizationId === input.organizationId &&
        program.reportingAreaIds.includes(row.reportingAreaId),
    );
    if (!allocation) return null;

    const amount =
      Math.round(program.amountPerReportingArea * allocation.share * 100) / 100;

    return {
      sourceId: `idm:${input.seasonId}:${allocation.reportingAreaId}`,
      sourceRevision: Math.max(program.revision, allocation.revision),
      amount,
      documentLabel: program.sourceLabel,
    };
  }
}

export interface RawCatalogPrice {
  id: string;
  seasonId: string;
  catalogItemId: string;
  unitPrice: number;
  revision: number;
  active: boolean;
  prepaymentRequired: boolean;
  documentLabel?: string;
}

export interface CatalogPriceAdapterBackend {
  loadRates(seasonId: string): Promise<RawCatalogPrice[]>;
}

export class CatalogPriceAdapter implements CatalogPriceSource {
  constructor(private readonly backend: CatalogPriceAdapterBackend) {}

  async loadUnitPrice(input: {
    seasonId: string;
    catalogItemId: string;
  }) {
    const rates = await this.backend.loadRates(input.seasonId);
    const rate = rates
      .filter(
        (candidate) =>
          candidate.active &&
          candidate.catalogItemId === input.catalogItemId,
      )
      .sort((a, b) => b.revision - a.revision)[0];

    if (!rate) return null;

    return {
      rateId: rate.id,
      rateRevision: rate.revision,
      unitPrice: rate.unitPrice,
      prepaymentRequired: rate.prepaymentRequired,
      documentLabel: rate.documentLabel,
    };
  }
}
