export type Language = 'de' | 'it';

export interface BillingTotals {
  fair: number;
  idm: number;
  orders: number;
  extras: number;
}

export interface OrganizationBillingRow extends BillingTotals {
  organizationId: string;
  organizationName: string;
  reportingAreaId?: string;
  reportingAreaName?: string;
  status: 'draft' | 'ready';
  orderQuantityActive: number;
  orderQuantityDraft: number;
  orderCount: number;
}

export interface SourceStatus {
  id: 'fair' | 'idm' | 'orders' | 'extras';
  label: string;
  state: 'connected' | 'defined' | 'pending' | 'error';
  detail: string;
}
