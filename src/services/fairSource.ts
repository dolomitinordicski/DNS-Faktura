import { getApp, getApps, initializeApp } from 'firebase/app';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

const fairFirebaseConfig = {
  apiKey: 'AIzaSyB33zc35GCrUVe5nTQT84MHnbL0A891x24',
  authDomain: 'fair-modell.firebaseapp.com',
  projectId: 'fair-modell',
  storageBucket: 'fair-modell.firebasestorage.app',
  messagingSenderId: '94440162544',
  appId: '1:94440162544:web:4712f68a02db00388fee35',
  measurementId: 'G-RMEVRWGKRS',
};

const fairApp = getApps().some((app) => app.name === 'dns-fair-source')
  ? getApp('dns-fair-source')
  : initializeApp(fairFirebaseConfig, 'dns-fair-source');
const fairDb = getFirestore(fairApp);

export interface FairBillingOrganization {
  organizationId: string;
  sourceLabel: string;
  reportingAreaLabel: string;
  distributionKey: number;
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
  const snapshot = await getDoc(doc(fairDb, 'fairModel', docId));
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
      typeof row.distributionKey !== 'number' ||
      typeof row.variableFee !== 'number' ||
      typeof row.fixedFee !== 'number' ||
      typeof row.totalAmount !== 'number'
    ) return [];
    return [{
      organizationId: row.organizationId,
      sourceLabel: row.sourceLabel,
      reportingAreaLabel: row.reportingAreaLabel,
      distributionKey: row.distributionKey,
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
