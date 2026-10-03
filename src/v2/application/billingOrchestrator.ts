import type {
  BillingLine,
  BillingSheet,
  Confirmation,
  OrganizationId,
  SeasonId,
} from '../domain/types';
import type {
  CatalogPriceSource,
  DataEntryOrderSource,
  FairContributionSource,
  IdmChargeSource,
  SeasonalExtraSource,
} from '../contracts/externalSources';
import {
  buildConfirmedOrderBillingLines,
  createBillingSheet,
  createManualServiceLine,
  type ConfirmationReadinessSnapshot,
  type SourceRevisionSnapshot,
} from '../engine/billingEngine';

function flatSourceLine(input: {
  id: string;
  sourceType: 'FAIR' | 'IDM';
  sourceId: string;
  sourceRevision: number;
  description: string;
  amount: number;
  sourceDocument?: string;
}): BillingLine {
  return {
    id: input.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceRevision: input.sourceRevision,
    description: input.description,
    quantity: 1,
    unit: 'flat',
    unitPrice: input.amount,
    amount: input.amount,
    prepaymentRequired: false,
    sourceDocument: input.sourceDocument,
  };
}

export type BillingAssemblyIssueCode =
  | 'CONFIRMATION_SCOPE_MISMATCH'
  | 'CONFIRMATION_ORDER_NOT_FOUND'
  | 'CONFIRMATION_NOT_CONFIRMED'
  | 'MISSING_RATE';

export interface BillingAssemblyIssue {
  code: BillingAssemblyIssueCode;
  confirmationId?: string;
  orderId?: string;
  catalogItemId?: string;
  detail?: string;
}

export interface BillingAssemblySources {
  orders: DataEntryOrderSource;
  fair: FairContributionSource;
  idm: IdmChargeSource;
  catalogPrices: CatalogPriceSource;
  seasonalExtras: SeasonalExtraSource;
}

export interface BillingAssemblyResult {
  sheet: BillingSheet;
  sourceSnapshots: SourceRevisionSnapshot[];
  confirmationSnapshots: ConfirmationReadinessSnapshot[];
  issues: BillingAssemblyIssue[];
}

export async function assembleBillingDraft(input: {
  id: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  revision: number;
  confirmations: Confirmation[];
  sources: BillingAssemblySources;
  createdAt?: string;
}): Promise<BillingAssemblyResult> {
  const issues: BillingAssemblyIssue[] = [];
  const lines: BillingLine[] = [];
  const sourceSnapshots: SourceRevisionSnapshot[] = [];
  const confirmationSnapshots: ConfirmationReadinessSnapshot[] = [];

  const [orders, fair, idm, seasonalExtras] = await Promise.all([
    input.sources.orders.loadSubmittedOrders(input.seasonId),
    input.sources.fair.loadContribution({
      seasonId: input.seasonId,
      organizationId: input.organizationId,
    }),
    input.sources.idm.loadCharge({
      seasonId: input.seasonId,
      organizationId: input.organizationId,
    }),
    input.sources.seasonalExtras.loadCharges({
      seasonId: input.seasonId,
      organizationId: input.organizationId,
    }),
  ]);

  if (fair) {
    lines.push(
      flatSourceLine({
        id: `fair:${input.organizationId}:${fair.sourceRevision}`,
        sourceType: 'FAIR',
        sourceId: fair.sourceId,
        sourceRevision: fair.sourceRevision,
        description: 'DNS FAIR',
        amount: fair.amount,
        sourceDocument: fair.documentLabel,
      }),
    );
    sourceSnapshots.push({
      sourceType: 'FAIR',
      sourceId: fair.sourceId,
      currentRevision: fair.sourceRevision,
    });
  }

  if (idm) {
    lines.push(
      flatSourceLine({
        id: `idm:${input.organizationId}:${idm.sourceRevision}`,
        sourceType: 'IDM',
        sourceId: idm.sourceId,
        sourceRevision: idm.sourceRevision,
        description: 'IDM Premiumpartner',
        amount: idm.amount,
        sourceDocument: idm.documentLabel,
      }),
    );
    sourceSnapshots.push({
      sourceType: 'IDM',
      sourceId: idm.sourceId,
      currentRevision: idm.sourceRevision,
    });
  }


  for (const extra of seasonalExtras) {
    lines.push(
      createManualServiceLine({
        id: `seasonal-extra:${extra.sourceId}`,
        sourceId: extra.sourceId,
        description: extra.description,
        quantity: extra.quantity,
        unit: extra.unit,
        customUnitLabel: extra.customUnitLabel,
        unitPrice: extra.unitPrice,
        prepaymentRequired: extra.prepaymentRequired,
        sourceRevision: extra.sourceRevision,
        sourceDocument: extra.documentLabel,
      }),
    );
    sourceSnapshots.push({
      sourceType: 'MANUAL_SERVICE',
      sourceId: extra.sourceId,
      currentRevision: extra.sourceRevision,
    });
  }

  const orderById = new Map(
    orders
      .filter((order) => order.organizationId === input.organizationId)
      .map((order) => [order.id, order]),
  );

  for (const confirmation of input.confirmations) {
    if (
      confirmation.seasonId !== input.seasonId ||
      confirmation.organizationId !== input.organizationId
    ) {
      issues.push({
        code: 'CONFIRMATION_SCOPE_MISMATCH',
        confirmationId: confirmation.id,
      });
      continue;
    }

    confirmationSnapshots.push({
      id: confirmation.id,
      revision: confirmation.revision,
      status: confirmation.status,
    });

    sourceSnapshots.push({
      sourceType: 'ORDER_CONFIRMATION',
      sourceId: confirmation.id,
      currentRevision: confirmation.revision,
    });

    if (confirmation.status !== 'CONFIRMED') {
      issues.push({
        code: 'CONFIRMATION_NOT_CONFIRMED',
        confirmationId: confirmation.id,
        detail: confirmation.status,
      });
      continue;
    }

    const order = orderById.get(confirmation.orderId);
    if (!order) {
      issues.push({
        code: 'CONFIRMATION_ORDER_NOT_FOUND',
        confirmationId: confirmation.id,
        orderId: confirmation.orderId,
      });
      continue;
    }

    const rates = [];
    let missingRate = false;

    for (const confirmationLine of confirmation.lines) {
      const price = await input.sources.catalogPrices.loadUnitPrice({
        seasonId: input.seasonId,
        catalogItemId: confirmationLine.catalogItemId,
      });

      if (!price) {
        missingRate = true;
        issues.push({
          code: 'MISSING_RATE',
          confirmationId: confirmation.id,
          catalogItemId: confirmationLine.catalogItemId,
        });
        continue;
      }

      rates.push({
        catalogItemId: confirmationLine.catalogItemId,
        rateId: price.rateId,
        rateRevision: price.rateRevision,
        unitPrice: price.unitPrice,
        prepaymentRequired: price.prepaymentRequired,
        sourceDocument: price.documentLabel,
      });
    }

    if (missingRate) continue;

    const orderLines = buildConfirmedOrderBillingLines({
      confirmation,
      rates,
    }).map((line) => {
      const sourceOrderLine = order.lines.find(
        (candidate) => line.id === `${confirmation.id}:${candidate.id}`,
      );

      return {
        ...line,
        description: sourceOrderLine?.label ?? line.description,
      };
    });

    lines.push(...orderLines);
  }

  return {
    sheet: createBillingSheet({
      id: input.id,
      seasonId: input.seasonId,
      organizationId: input.organizationId,
      revision: input.revision,
      lines,
      createdAt: input.createdAt,
    }),
    sourceSnapshots,
    confirmationSnapshots,
    issues,
  };
}
