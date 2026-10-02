import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  FairAdapterBackend,
  OrdersAdapterBackend,
  RawDataEntryCatalogItem,
  RawDataEntryOrderHeader,
  RawDataEntryOrderLine,
  RawFairOrganizationRow,
} from './sourceAdapters';

const dnsCoreConfig = {
  apiKey: 'AIzaSyAgxv6Z45-AfrusbFnCSyvYChRUBu6-vXc',
  authDomain: 'dns-core.firebaseapp.com',
  projectId: 'dns-core',
  storageBucket: 'dns-core.firebasestorage.app',
  messagingSenderId: '387653285986',
  appId: '1:387653285986:web:27ad6f2e9a41ea1aebb93b',
  measurementId: 'G-2G56PRYNME',
};

const fairConfig = {
  apiKey: 'AIzaSyB33zc35GCrUVe5nTQT84MHnbL0A891x24',
  authDomain: 'fair-modell.firebaseapp.com',
  projectId: 'fair-modell',
  storageBucket: 'fair-modell.firebasestorage.app',
  messagingSenderId: '94440162544',
  appId: '1:94440162544:web:4712f68a02db00388fee35',
  measurementId: 'G-RMEVRWGKRS',
};

function namedApp(name: string, config: Record<string, string>): FirebaseApp {
  return getApps().some((app) => app.name === name)
    ? getApp(name)
    : initializeApp(config, name);
}

export const fakturaV2CoreDb = getFirestore(
  namedApp('dns-faktura-v2-core', dnsCoreConfig),
);

export const fakturaV2FairDb = getFirestore(
  namedApp('dns-faktura-v2-fair', fairConfig),
);

function isOrderStatus(value: unknown): value is RawDataEntryOrderHeader['status'] {
  return (
    value === 'draft' ||
    value === 'submitted' ||
    value === 'confirmed' ||
    value === 'fulfilled' ||
    value === 'cancelled'
  );
}

export class FirebaseOrdersBackend implements OrdersAdapterBackend {
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}

  async loadHeaders(seasonId: string): Promise<RawDataEntryOrderHeader[]> {
    const snapshot = await getDocs(
      query(collection(this.db, 'ticketOrders'), where('seasonId', '==', seasonId)),
    );

    return snapshot.docs.flatMap((item) => {
      const data = item.data() as Record<string, unknown>;
      if (
        typeof data.seasonId !== 'string' ||
        typeof data.organizationId !== 'string' ||
        !isOrderStatus(data.status)
      ) {
        return [];
      }

      return [{
        id: item.id,
        seasonId: data.seasonId,
        organizationId: data.organizationId,
        status: data.status,
      }];
    });
  }

  async loadLines(seasonId: string): Promise<RawDataEntryOrderLine[]> {
    const snapshot = await getDocs(
      query(collection(this.db, 'ticketOrderLines'), where('seasonId', '==', seasonId)),
    );

    return snapshot.docs.flatMap((item) => {
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

      return [{
        id: item.id,
        ticketOrderId: data.ticketOrderId,
        seasonId: data.seasonId,
        organizationId: data.organizationId,
        catalogItemId: data.catalogItemId,
        quantity: data.quantity,
      }];
    });
  }

  async loadCatalog(): Promise<RawDataEntryCatalogItem[]> {
    const snapshot = await getDocs(collection(this.db, 'orderCatalogItems'));

    return snapshot.docs.flatMap((item) => {
      const data = item.data() as Record<string, unknown>;
      if (
        typeof data.category !== 'string' ||
        typeof data.code !== 'string'
      ) {
        return [];
      }

      const result: RawDataEntryCatalogItem = {
        id: item.id,
        category: data.category,
        code: data.code,
      };

      if (
        data.label &&
        typeof data.label === 'object' &&
        !Array.isArray(data.label)
      ) {
        result.label = data.label as RawDataEntryCatalogItem['label'];
      }

      return [result];
    });
  }
}

function legacyFairRevision(data: Record<string, unknown>): number {
  const billing = data.billing as Record<string, unknown> | undefined;

  const explicitRevision =
    typeof billing?.revision === 'number'
      ? billing.revision
      : typeof data.revision === 'number'
        ? data.revision
        : undefined;

  if (explicitRevision !== undefined && Number.isFinite(explicitRevision)) {
    return explicitRevision;
  }

  const clientUpdatedAt = Number(data.clientUpdatedAt);
  if (Number.isFinite(clientUpdatedAt) && clientUpdatedAt > 0) {
    return clientUpdatedAt;
  }

  throw new Error('FAIR_REVISION_MISSING');
}

export class FirebaseFairBackend implements FairAdapterBackend {
  constructor(private readonly db: Firestore = fakturaV2FairDb) {}

  async loadPublishedRows(seasonId: string): Promise<RawFairOrganizationRow[]> {
    const docId = seasonId === '2026-27' ? 'ws-2026-27' : seasonId;
    const snapshot = await getDoc(doc(this.db, 'fairModel', docId));

    if (!snapshot.exists()) {
      throw new Error('FAIR_SOURCE_MISSING');
    }

    const data = snapshot.data() as Record<string, unknown>;
    const billing = data.billing as Record<string, unknown> | undefined;

    if (!billing || !Array.isArray(billing.organizations)) {
      throw new Error('FAIR_BILLING_NOT_PUBLISHED');
    }

    const revision = legacyFairRevision(data);
    const source =
      typeof billing.source === 'string' ? billing.source : 'DNS FAIR';

    const rows = billing.organizations.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;

      if (
        typeof row.organizationId !== 'string' ||
        typeof row.totalAmount !== 'number' ||
        !Number.isFinite(row.totalAmount)
      ) {
        return [];
      }

      return [{
        organizationId: row.organizationId,
        totalAmount: row.totalAmount,
        sourceLabel:
          typeof row.sourceLabel === 'string'
            ? `${source} · ${row.sourceLabel}`
            : source,
        revision,
      }];
    });

    if (!rows.length) {
      throw new Error('FAIR_BILLING_NOT_PUBLISHED');
    }

    return rows;
  }
}
