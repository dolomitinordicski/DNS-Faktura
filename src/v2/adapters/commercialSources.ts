import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { QuantityUnit } from '../domain/types';
import { fakturaV2CoreDb } from './firebaseBackends';
import { roundUpToCent } from './rateConfigs';

const COLLECTION = 'fakturaManualSources';

export type CommercialItemKind = 'article' | 'service';

export interface CommercialItemRecord {
  id: string;
  recordType: 'item';
  seasonId: string;
  kind: CommercialItemKind;
  label: { de: string; it: string };
  unit: QuantityUnit;
  customUnitLabel?: string;
  unitPrice: number;
  defaultQuantity: number;
  supplier?: string;
  sourceDocument?: string;
  prepaymentRequired: boolean;
  active: boolean;
  revision: number;
}

export interface CommercialAssignmentRecord {
  id: string;
  recordType: 'assignment';
  seasonId: string;
  itemId: string;
  itemRevision: number;
  organizationId: string;
  description: string;
  unit: QuantityUnit;
  customUnitLabel?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sourceDocument?: string;
  prepaymentRequired: boolean;
  active: boolean;
  revision: number;
}

function number(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function itemFromData(id: string, data: Record<string, unknown>): CommercialItemRecord | null {
  if (
    data.recordType !== 'item' ||
    typeof data.seasonId !== 'string' ||
    (data.kind !== 'article' && data.kind !== 'service') ||
    !data.label ||
    typeof data.label !== 'object' ||
    Array.isArray(data.label) ||
    typeof data.unit !== 'string' ||
    typeof data.unitPrice !== 'number' ||
    typeof data.defaultQuantity !== 'number' ||
    typeof data.active !== 'boolean' ||
    typeof data.revision !== 'number'
  ) {
    return null;
  }

  const label = data.label as Record<string, unknown>;
  if (typeof label.de !== 'string' || typeof label.it !== 'string') return null;

  return {
    id,
    recordType: 'item',
    seasonId: data.seasonId,
    kind: data.kind,
    label: { de: label.de, it: label.it },
    unit: data.unit as QuantityUnit,
    customUnitLabel:
      typeof data.customUnitLabel === 'string' ? data.customUnitLabel : undefined,
    unitPrice: data.unitPrice,
    defaultQuantity: data.defaultQuantity,
    supplier: typeof data.supplier === 'string' ? data.supplier : undefined,
    sourceDocument:
      typeof data.sourceDocument === 'string' ? data.sourceDocument : undefined,
    prepaymentRequired:
      typeof data.prepaymentRequired === 'boolean'
        ? data.prepaymentRequired
        : false,
    active: data.active,
    revision: data.revision,
  };
}

function assignmentFromData(
  id: string,
  data: Record<string, unknown>,
): CommercialAssignmentRecord | null {
  if (
    data.recordType !== 'assignment' ||
    typeof data.seasonId !== 'string' ||
    typeof data.itemId !== 'string' ||
    typeof data.itemRevision !== 'number' ||
    typeof data.organizationId !== 'string' ||
    typeof data.description !== 'string' ||
    typeof data.unit !== 'string' ||
    typeof data.quantity !== 'number' ||
    typeof data.unitPrice !== 'number' ||
    typeof data.amount !== 'number' ||
    typeof data.active !== 'boolean' ||
    typeof data.revision !== 'number'
  ) {
    return null;
  }

  return {
    id,
    recordType: 'assignment',
    seasonId: data.seasonId,
    itemId: data.itemId,
    itemRevision: data.itemRevision,
    organizationId: data.organizationId,
    description: data.description,
    unit: data.unit as QuantityUnit,
    customUnitLabel:
      typeof data.customUnitLabel === 'string' ? data.customUnitLabel : undefined,
    quantity: data.quantity,
    unitPrice: data.unitPrice,
    amount: data.amount,
    sourceDocument:
      typeof data.sourceDocument === 'string' ? data.sourceDocument : undefined,
    prepaymentRequired:
      typeof data.prepaymentRequired === 'boolean'
        ? data.prepaymentRequired
        : false,
    active: data.active,
    revision: data.revision,
  };
}

function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clean(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

export async function loadCommercialItems(
  seasonId: string,
): Promise<CommercialItemRecord[]> {
  const snapshot = await getDocs(
    query(collection(fakturaV2CoreDb, COLLECTION), where('seasonId', '==', seasonId)),
  );

  return snapshot.docs
    .map((entry) => itemFromData(entry.id, entry.data() as Record<string, unknown>))
    .filter((entry): entry is CommercialItemRecord => Boolean(entry))
    .filter((entry) => entry.active)
    .sort((a, b) => a.label.de.localeCompare(b.label.de, 'de'));
}

export async function loadCommercialAssignments(input: {
  seasonId: string;
  organizationId?: string;
  itemId?: string;
}): Promise<CommercialAssignmentRecord[]> {
  const snapshot = await getDocs(
    query(
      collection(fakturaV2CoreDb, COLLECTION),
      where('seasonId', '==', input.seasonId),
    ),
  );

  return snapshot.docs
    .map((entry) =>
      assignmentFromData(entry.id, entry.data() as Record<string, unknown>),
    )
    .filter((entry): entry is CommercialAssignmentRecord => Boolean(entry))
    .filter(
      (entry) =>
        entry.active &&
        (!input.organizationId || entry.organizationId === input.organizationId) &&
        (!input.itemId || entry.itemId === input.itemId),
    );
}

export async function saveCommercialItem(input: {
  id?: string;
  seasonId: string;
  kind: CommercialItemKind;
  labelDe: string;
  labelIt: string;
  unit: QuantityUnit;
  customUnitLabel?: string;
  unitPrice: number;
  defaultQuantity: number;
  supplier?: string;
  sourceDocument?: string;
  prepaymentRequired: boolean;
  actorId: string;
}): Promise<CommercialItemRecord> {
  if (!input.labelDe.trim() || !input.labelIt.trim()) {
    throw new Error('COMMERCIAL_ITEM_LABEL_REQUIRED');
  }
  if (!Number.isFinite(input.defaultQuantity) || input.defaultQuantity < 0) {
    throw new Error('INVALID_DEFAULT_QUANTITY');
  }

  const id = input.id ?? `commercial-${crypto.randomUUID()}`;
  const ref = doc(fakturaV2CoreDb, COLLECTION, id);
  const existing = await getDoc(ref);
  const current = existing.exists()
    ? itemFromData(existing.id, existing.data() as Record<string, unknown>)
    : null;
  if (existing.exists() && !current) throw new Error('INVALID_COMMERCIAL_ITEM');

  const unitPrice = roundUpToCent(input.unitPrice);
  const revision = current ? current.revision + 1 : 1;

  const record = clean({
    id,
    recordType: 'item',
    seasonId: input.seasonId,
    kind: input.kind,
    label: {
      de: input.labelDe.trim(),
      it: input.labelIt.trim(),
    },
    unit: input.unit,
    customUnitLabel: input.customUnitLabel?.trim() || undefined,
    unitPrice,
    defaultQuantity: input.defaultQuantity,
    supplier: input.supplier?.trim() || undefined,
    sourceDocument: input.sourceDocument?.trim() || undefined,
    prepaymentRequired: input.prepaymentRequired,
    active: true,
    revision,
    updatedBy: input.actorId,
    updatedAt: serverTimestamp(),
  });

  await setDoc(ref, record);

  return {
    id,
    recordType: 'item',
    seasonId: input.seasonId,
    kind: input.kind,
    label: { de: input.labelDe.trim(), it: input.labelIt.trim() },
    unit: input.unit,
    customUnitLabel: input.customUnitLabel?.trim() || undefined,
    unitPrice,
    defaultQuantity: input.defaultQuantity,
    supplier: input.supplier?.trim() || undefined,
    sourceDocument: input.sourceDocument?.trim() || undefined,
    prepaymentRequired: input.prepaymentRequired,
    active: true,
    revision,
  };
}

export async function applyCommercialItem(input: {
  item: CommercialItemRecord;
  organizationIds: string[];
  actorId: string;
}): Promise<void> {
  const existing = await loadCommercialAssignments({
    seasonId: input.item.seasonId,
    itemId: input.item.id,
  });
  const existingByOrganization = new Map(
    existing.map((entry) => [entry.organizationId, entry]),
  );

  const batch = writeBatch(fakturaV2CoreDb);
  for (const organizationId of input.organizationIds) {
    const current = existingByOrganization.get(organizationId);
    const id = `${input.item.seasonId}__assignment__${input.item.id}__${organizationId}`;
    const quantity = current?.quantity ?? input.item.defaultQuantity;
    const revision = current ? current.revision + 1 : 1;
    const assignment = clean({
      id,
      recordType: 'assignment',
      seasonId: input.item.seasonId,
      itemId: input.item.id,
      itemRevision: input.item.revision,
      organizationId,
      description: input.item.label.de,
      unit: input.item.unit,
      customUnitLabel: input.item.customUnitLabel,
      quantity,
      unitPrice: input.item.unitPrice,
      amount: roundAmount(quantity * input.item.unitPrice),
      sourceDocument: input.item.sourceDocument,
      prepaymentRequired: input.item.prepaymentRequired,
      active: true,
      revision,
      updatedBy: input.actorId,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(fakturaV2CoreDb, COLLECTION, id), assignment);
  }

  await batch.commit();
}

export async function updateCommercialAssignmentQuantity(input: {
  assignment: CommercialAssignmentRecord;
  quantity: number;
  actorId: string;
}): Promise<CommercialAssignmentRecord> {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error('INVALID_QUANTITY');
  }

  const next: CommercialAssignmentRecord = {
    ...input.assignment,
    quantity: input.quantity,
    amount: roundAmount(input.quantity * input.assignment.unitPrice),
    revision: input.assignment.revision + 1,
  };

  await setDoc(
    doc(fakturaV2CoreDb, COLLECTION, input.assignment.id),
    clean({
      ...next,
      updatedBy: input.actorId,
      updatedAt: serverTimestamp(),
    }),
  );

  return next;
}
