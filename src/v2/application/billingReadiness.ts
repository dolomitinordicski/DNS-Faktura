import type {
  BillingLine,
  BillingSourceType,
  BillingSheet,
} from '../domain/types';
import type {
  CatalogPriceSource,
  FairContributionSource,
  IdmChargeSource,
} from '../contracts/externalSources';
import type { ConfirmationRepository } from '../contracts/persistence';
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
  | 'RATE_ID_MISMATCH'
  | 'RATE_VALUE_MISMATCH'
  | 'RATE_REVISION_MISMATCH'
  | 'SOURCE_VALUE_MISMATCH'
  | 'SOURCE_REVISION_MISMATCH';

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

    if (current.rateRevision < line.rateRevision) {
      issues.push({
        code: 'RATE_REVISION_MISMATCH',
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
      continue;
    }

    if (
      current.rateRevision === line.rateRevision &&
      current.rateId === line.rateId &&
      (
        current.unitPrice !== line.unitPrice ||
        current.prepaymentRequired !== line.prepaymentRequired
      )
    ) {
      issues.push({
        code: 'RATE_VALUE_MISMATCH',
        lineId: line.id,
        sourceId: line.sourceId,
        catalogItemId: line.catalogItemId,
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


export interface LiveBillingReadinessSources {
  fair: FairContributionSource;
  idm: IdmChargeSource;
  catalogPrices: CatalogPriceSource;
  confirmations: ConfirmationRepository;
}

function sourceValueIssues(input: {
  assembly: BillingAssemblyResult;
  fair: Awaited<ReturnType<FairContributionSource['loadContribution']>>;
  idm: Awaited<ReturnType<IdmChargeSource['loadCharge']>>;
  confirmations: Array<Awaited<ReturnType<ConfirmationRepository['getById']>>>;
}): ApplicationBillingReadinessIssue[] {
  const issues: ApplicationBillingReadinessIssue[] = [];

  for (const line of input.assembly.sheet.lines) {
    if (line.sourceType === 'FAIR') {
      if (
        input.fair &&
        input.fair.sourceId === line.sourceId &&
        input.fair.sourceRevision !== line.sourceRevision
      ) {
        issues.push({
          code: 'SOURCE_REVISION_MISMATCH',
          lineId: line.id,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          detail: `${String(line.sourceRevision)}->${String(input.fair.sourceRevision)}`,
        });
      }
      if (
        input.fair &&
        input.fair.sourceId === line.sourceId &&
        input.fair.sourceRevision === line.sourceRevision &&
        input.fair.amount !== line.amount
      ) {
        issues.push({
          code: 'SOURCE_VALUE_MISMATCH',
          lineId: line.id,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          detail: `${String(line.amount)}->${String(input.fair.amount)}`,
        });
      }
    }

    if (line.sourceType === 'IDM') {
      if (
        input.idm &&
        input.idm.sourceId === line.sourceId &&
        input.idm.sourceRevision !== line.sourceRevision
      ) {
        issues.push({
          code: 'SOURCE_REVISION_MISMATCH',
          lineId: line.id,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          detail: `${String(line.sourceRevision)}->${String(input.idm.sourceRevision)}`,
        });
      }
      if (
        input.idm &&
        input.idm.sourceId === line.sourceId &&
        input.idm.sourceRevision === line.sourceRevision &&
        input.idm.amount !== line.amount
      ) {
        issues.push({
          code: 'SOURCE_VALUE_MISMATCH',
          lineId: line.id,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          detail: `${String(line.amount)}->${String(input.idm.amount)}`,
        });
      }
    }

    if (line.sourceType === 'ORDER_CONFIRMATION') {
      const confirmation = input.confirmations.find(
        (candidate) => candidate?.id === line.sourceId,
      );
      if (
        confirmation &&
        confirmation.revision === line.sourceRevision
      ) {
        const orderLineIdPrefix = `${confirmation.id}:`;
        const orderLineId = line.id.startsWith(orderLineIdPrefix)
          ? line.id.slice(orderLineIdPrefix.length)
          : undefined;
        const confirmationLine = orderLineId
          ? confirmation.lines.find(
              (candidate) => candidate.orderLineId === orderLineId,
            )
          : undefined;

        if (
          confirmation.orderId !== line.orderId ||
          !confirmationLine ||
          confirmationLine.catalogItemId !== line.catalogItemId ||
          confirmationLine.confirmedQuantity !== line.quantity
        ) {
          issues.push({
            code: 'SOURCE_VALUE_MISMATCH',
            lineId: line.id,
            sourceType: line.sourceType,
            sourceId: line.sourceId,
          });
        }
      }
    }
  }

  return issues;
}

export async function evaluateLiveBillingReadiness(input: {
  assembly: BillingAssemblyResult;
  sources: LiveBillingReadinessSources;
  requiredSourceTypes?: BillingSourceType[];
}): Promise<ApplicationBillingReadinessResult> {
  const confirmationIds = [
    ...new Set(
      input.assembly.sheet.lines
        .filter((line) => line.sourceType === 'ORDER_CONFIRMATION')
        .map((line) => line.sourceId),
    ),
  ];

  const wantsFair =
    input.assembly.sheet.lines.some((line) => line.sourceType === 'FAIR') ||
    input.requiredSourceTypes?.includes('FAIR') === true;
  const wantsIdm =
    input.assembly.sheet.lines.some((line) => line.sourceType === 'IDM') ||
    input.requiredSourceTypes?.includes('IDM') === true;

  const [fair, idm, confirmations] = await Promise.all([
    wantsFair
      ? input.sources.fair.loadContribution({
          seasonId: input.assembly.sheet.seasonId,
          organizationId: input.assembly.sheet.organizationId,
        })
      : Promise.resolve(null),
    wantsIdm
      ? input.sources.idm.loadCharge({
          seasonId: input.assembly.sheet.seasonId,
          organizationId: input.assembly.sheet.organizationId,
        })
      : Promise.resolve(null),
    Promise.all(
      confirmationIds.map((confirmationId) =>
        input.sources.confirmations.getById(confirmationId),
      ),
    ),
  ]);

  const liveSourceSnapshots = [];

  if (fair) {
    liveSourceSnapshots.push({
      sourceType: 'FAIR' as const,
      sourceId: fair.sourceId,
      currentRevision: fair.sourceRevision,
    });
  }

  if (idm) {
    liveSourceSnapshots.push({
      sourceType: 'IDM' as const,
      sourceId: idm.sourceId,
      currentRevision: idm.sourceRevision,
    });
  }

  for (const confirmation of confirmations) {
    if (!confirmation) continue;
    liveSourceSnapshots.push({
      sourceType: 'ORDER_CONFIRMATION' as const,
      sourceId: confirmation.id,
      currentRevision: confirmation.revision,
    });
  }

  const liveConfirmationSnapshots = confirmations
    .filter((confirmation): confirmation is NonNullable<typeof confirmation> =>
      Boolean(confirmation),
    )
    .map((confirmation) => ({
      id: confirmation.id,
      revision: confirmation.revision,
      status: confirmation.status,
    }));

  const engine = evaluateBillingReadiness({
    sheet: input.assembly.sheet,
    sources: liveSourceSnapshots,
    confirmations: liveConfirmationSnapshots,
    requiredSourceTypes: input.requiredSourceTypes,
  });

  const issues = [
    ...assemblyIssues(input.assembly.issues),
    ...engineIssues(engine.issues),
    ...(await rateIssues({
      sheet: input.assembly.sheet,
      catalogPrices: input.sources.catalogPrices,
    })),
    ...sourceValueIssues({
      assembly: input.assembly,
      fair,
      idm,
      confirmations,
    }),
  ];

  const deduplicated = issues.filter(
    (issue, index, all) =>
      index ===
      all.findIndex(
        (candidate) =>
          candidate.code === issue.code &&
          candidate.lineId === issue.lineId &&
          candidate.sourceId === issue.sourceId &&
          candidate.catalogItemId === issue.catalogItemId &&
          candidate.detail === issue.detail,
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
