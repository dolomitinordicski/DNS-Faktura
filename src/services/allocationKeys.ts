import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './dnsCore';

export interface AreaAllocationRecord {
  id: string;
  seasonId: string;
  reportingAreaId: string;
  allocations: Array<{
    organizationId: string;
    share: number;
    fixedShare: number;
  }>;
  active: boolean;
  revision: number;
}

export async function loadAreaAllocationKeys(seasonId: string): Promise<AreaAllocationRecord[]> {
  const snapshot = await getDocs(
    query(collection(db, 'areaAllocationKeys'), where('seasonId', '==', seasonId)),
  );

  return snapshot.docs.flatMap((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    if (
      typeof data.seasonId !== 'string' ||
      typeof data.reportingAreaId !== 'string' ||
      !Array.isArray(data.allocations) ||
      typeof data.active !== 'boolean' ||
      typeof data.revision !== 'number'
    ) return [];

    const allocations = data.allocations.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if (
        typeof row.organizationId !== 'string' ||
        typeof row.share !== 'number' ||
        typeof row.fixedShare !== 'number'
      ) return [];
      return [{
        organizationId: row.organizationId,
        share: row.share,
        fixedShare: row.fixedShare,
      }];
    });

    if (!allocations.length) return [];
    return [{
      id: docSnap.id,
      seasonId: data.seasonId,
      reportingAreaId: data.reportingAreaId,
      allocations,
      active: data.active,
      revision: data.revision,
    }];
  });
}

export function allocationShareForOrganization(
  records: AreaAllocationRecord[],
  reportingAreaId: string | undefined,
  organizationId: string,
) {
  if (!reportingAreaId) return undefined;
  return records
    .find((record) => record.active && record.reportingAreaId === reportingAreaId)
    ?.allocations.find((row) => row.organizationId === organizationId)?.share;
}
