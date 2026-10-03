import type {
  OrganizationId,
  Order,
  SeasonId,
} from '../domain/types';

export interface DataEntryOrderSource {
  loadSubmittedOrders(seasonId: SeasonId): Promise<Order[]>;
}

export interface FairContributionSource {
  loadContribution(input: {
    seasonId: SeasonId;
    organizationId: OrganizationId;
  }): Promise<{
    sourceId: string;
    sourceRevision: number;
    amount: number;
    documentLabel?: string;
  } | null>;
}

export interface IdmChargeSource {
  loadCharge(input: {
    seasonId: SeasonId;
    organizationId: OrganizationId;
  }): Promise<{
    sourceId: string;
    sourceRevision: number;
    amount: number;
    documentLabel?: string;
  } | null>;
}

export interface CatalogPriceSource {
  loadUnitPrice(input: {
    seasonId: SeasonId;
    catalogItemId: string;
  }): Promise<{
    rateId: string;
    rateRevision: number;
    unitPrice: number;
    prepaymentRequired: boolean;
    documentLabel?: string;
  } | null>;
}


export interface SeasonalExtraSource {
  loadExtras(input: {
    seasonId: SeasonId;
    organizationId: OrganizationId;
  }): Promise<Array<{
    sourceId: string;
    sourceRevision: number;
    description: string;
    quantity: number;
    unitAmount: number;
    amount: number;
    documentLabel: string;
    supplier?: string;
  }>>;
}
