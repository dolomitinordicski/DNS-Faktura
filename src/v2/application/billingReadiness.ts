import type {
  BillingLine,
  BillingSourceType,
  BillingSheet,
} from '../domain/types';
import type { CatalogPriceSource } from '../contracts/externalSources';
import {
  evaluateBillingReadiness,
  markBillingSheetReady,
  type BillingReadinessIssue,
} from '../engine/billingEngine';
import type {
  BillingAssemblyIssue,
  BillingAssemblyResult,
} from './billingOrchestrator';

export type ApplicationBillingReadinessCode =
  | BillingAssemblyIssue['code']
  | BillingReadinessIssue['code']
  | 'MISSING_RATE_LINEAGE'
  | 'MISSING_CURRENT_RATE'
  | 'STALE_RATE'
  | 'RATE_ID_MISMATCH';

export interface ApplicationBillingReadinessIssue {
  code: ApplicationBillingReadinessCode;
  lineId?: string;
  sourceType?: BillingSourceType;
  sourceId?: string;
  catalogItemId?: string;
  detail?: string;
}

export interface ApplicationBillingReadinessResult {
  ready: boolean;
  issues: ApplicationBillingReadinessIssue[];
}

function assemblyIssues(
  issues: BillingAssemblyIssue[],
): ApplicationBillingReadinessIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    sourceId: issue.confirmationId,
    catalogItemId: issue.catalogItemId,
    detail: issue.detail ?? issue.orderId,
  }));
}

function engineIssues(
  issues: BillingReadinessIssue[],
): ApplicationBillingReadinessIssue[] {
  return issues.map((issue) => ({ ...issue }));
}

async function rateIssues(input: {
  sheet: BillingSheet;
  catalogPrices: CatalogPriceSource;
}): Promise<ApplicationBillingReadinessIssue[]> {
  const issues: ApplicationBillingReadinessIssue[] = [];

  for (const line of input.sheet.lines) {
    if (line.sourceType !== 'ORDER_CONFIRMATION') continue;

    if (
      !line.catalogItemId ||
      !line.rateId ||
      line.rateRevision === undefined
    ) {
      issues.push({
        code: 'MISSING_RATE_LINEAGE',
        lineId: line.id,
        sourceId: line.sourceId,
        catalogItemId: line.catalogItemId,
      });
      continue;
    }

    const current = await input.catalogPrices.loadUnitPrice({
      seasonId: input.sheet.seasonId,
      catalogItemId: line.catalogItemId,
    });

    if (!current) {
      issues.push({
        code: 'MISSING_CURRENT_RATE',
        lineId: line.id,
        sourceId: line.sourceId,
        catalogItemId: line.catalogItemId,
      });
      continue;
    }

    if (current.rateRevision > line.rateRevision) {
      issues.push({
        code: 'STALE_RATE',
        lineId: line.id,
        sourceId: line.sourceId,
        catalogItemId: line.catalogItemId,
        detail: `${String(line.rateRevision)}->${String(current.rateRevision)}`,
      });
      continue;
    }

    if (
      current.rateRevision === line.rateRevision &&
      current.rateId !== line.rateId
    ) {
      issues.push({
        code: 'RATE_ID_MISMATCH',
        lineId: line.id,
        sourceId: line.sourceId,
        catalogItemId: line.catalogItemId,
        detail: `${line.rateId}->${current.rateId}`,
      });
    }
  }

  return issues;
}

export async function evaluateAssembledBillingReadiness(input: {
  assembly: BillingAssemblyResult;
  catalogPrices: CatalogPriceSource;
  requiredSourceTypes?: BillingSourceType[];
}): Promise<ApplicationBillingReadinessResult> {
  const engine = evaluateBillingReadiness({
    sheet: input.assembly.sheet,
    sources: input.assembly.sourceSnapshots,
    confirmations: input.assembly.confirmationSnapshots,
    requiredSourceTypes: input.requiredSourceTypes,
  });

  const issues = [
    ...assemblyIssues(input.assembly.issues),
    ...engineIssues(engine.issues),
    ...(await rateIssues({
      sheet: input.assembly.sheet,
      catalogPrices: input.catalogPrices,
    })),
  ];

  const deduplicated = issues.filter(
    (issue, index, all) =>
      index ===
      all.findIndex(
        (candidate) =>
          candidate.code === issue.code &&
          candidate.lineId === issue.lineId &&
          candidate.sourceId === issue.sourceId &&
          candidate.catalogItemId === issue.catalogItemId,
      ),
  );

  return {
    ready: deduplicated.length === 0,
    issues: deduplicated,
  };
}

export async function markAssembledBillingReady(input: {
  assembly: BillingAssemblyResult;
  catalogPrices: CatalogPriceSource;
  requiredSourceTypes?: BillingSourceType[];
  readyAt?: string;
}): Promise<BillingSheet> {
  if (input.assembly.sheet.status !== 'DRAFT') {
    throw new Error('INVALID_BILLING_STATE');
  }

  const result = await evaluateAssembledBillingReadiness(input);
  if (!result.ready) {
    throw new Error(
      `BILLING_NOT_READY:${result.issues.map((issue) => issue.code).join(',')}`,
    );
  }

  return markBillingSheetReady(input.assembly.sheet, input.readyAt);
}
