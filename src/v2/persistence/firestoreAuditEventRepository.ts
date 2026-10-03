import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  AuditEventRecord,
  AuditEventRepository,
} from '../contracts/persistence';
import { fakturaV2CoreDb } from '../adapters/firebaseBackends';

const EVENTS = 'fakturaEvents';

function eventFromData(
  id: string,
  data: Record<string, unknown>,
): AuditEventRecord {
  if (
    typeof data.type !== 'string' ||
    typeof data.occurredAt !== 'string' ||
    typeof data.actorId !== 'string' ||
    typeof data.seasonId !== 'string' ||
    typeof data.organizationId !== 'string' ||
    typeof data.entityType !== 'string' ||
    typeof data.entityId !== 'string' ||
    !data.payload ||
    typeof data.payload !== 'object' ||
    Array.isArray(data.payload)
  ) {
    throw new Error(`INVALID_AUDIT_EVENT:${id}`);
  }

  return {
    ...(data as unknown as AuditEventRecord),
    id,
  };
}

export class FirestoreAuditEventRepository
  implements AuditEventRepository
{
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}

  async append(): Promise<void> {
    throw new Error('AUDIT_EVENTS_APPEND_ONLY_VIA_DOMAIN_TRANSACTIONS');
  }

  async listForEntity(input: {
    entityType: AuditEventRecord['entityType'];
    entityId: string;
  }): Promise<AuditEventRecord[]> {
    const snapshot = await getDocs(
      query(
        collection(this.db, EVENTS),
        where('entityId', '==', input.entityId),
      ),
    );

    return snapshot.docs
      .map((entry) => eventFromData(entry.id, entry.data()))
      .filter((event) => event.entityType === input.entityType)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  async listBySeason(seasonId: string): Promise<AuditEventRecord[]> {
    const snapshot = await getDocs(
      query(
        collection(this.db, EVENTS),
        where('seasonId', '==', seasonId),
      ),
    );

    return snapshot.docs
      .map((entry) => eventFromData(entry.id, entry.data()))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
}
