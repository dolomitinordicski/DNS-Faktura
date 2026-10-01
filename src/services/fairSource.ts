import { doc, getDoc } from 'firebase/firestore';
import { db } from './dnsCore';

export interface FairBillingOrganization {
  organizationId: string;
  sourceLabel: string;
  reportingAreaLabel: string;
  variableFee: number;
  fixedFee: number;
  totalAmount: number;
}

export interface FairBillingSnapshot {
  state: 'ready';
  seasonId: string;
  source: string;
  status: string;
  organizations: FairBillingOrganization[];
  totalAmount: number;
}

export async function loadFairBillingSource(
  seasonId: string,
): Promise<FairBillingSnapshot> {
  const docId = seasonId === '2026-27' ? 'ws-2026-27' : seasonId;
  const snapshot = await getDoc(doc(db, 'fairModel', docId));
  if (!snapshot.exists()) throw new Error('FAIR_SOURCE_MISSING');
  const data = snapshot.data() as Record<string, unknown>;
  const billing = data.billing as Record<string, unknown> | undefined;
  if (!billing || !Array.isArray(billing.organizations)) {
    throw new Error('FAIR_BILLING_NOT_PUBLISHED');
  }
  const organizations = billing.organizations.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.organizationId !== 'string' ||
      typeof row.sourceLabel !== 'string' ||
      typeof row.reportingAreaLabel !== 'string' ||
      typeof row.variableFee !== 'number' ||
      typeof row.fixedFee !== 'number' ||
      typeof row.totalAmount !== 'number'
    ) return [];
    return [{
      organizationId: row.organizationId,
      sourceLabel: row.sourceLabel,
      reportingAreaLabel: row.reportingAreaLabel,
      variableFee: row.variableFee,
      fixedFee: row.fixedFee,
      totalAmount: row.totalAmount,
    }];
  });
  if (!organizations.length) throw new Error('FAIR_BILLING_NOT_PUBLISHED');
  return {
    state: 'ready',
    seasonId,
    source: typeof billing.source === 'string' ? billing.source : 'DNS FAIR',
    status: typeof billing.status === 'string' ? billing.status : 'live',
    organizations,
    totalAmount:
      typeof billing.totalAmount === 'number'
        ? billing.totalAmount
        : organizations.reduce((sum, row) => sum + row.totalAmount, 0),
  };
}
