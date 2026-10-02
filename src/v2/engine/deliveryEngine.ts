import type {
  BillingSheet,
  Delivery,
  DeliveryLine,
  PaymentCase,
} from '../domain/types';

export function canReleaseForDelivery(input: {
  billingSheet: BillingSheet;
  payment: PaymentCase;
}) {
  return evaluateDeliveryReadiness(input).releasable;
}

export function updateDeliveredQuantity(input: {
  line: DeliveryLine;
  deliveredQuantity: number;
}): DeliveryLine {
  if (
    !Number.isFinite(input.deliveredQuantity) ||
    input.deliveredQuantity < 0 ||
    input.deliveredQuantity > input.line.confirmedQuantity
  ) {
    throw new Error('INVALID_DELIVERED_QUANTITY');
  }

  return {
    ...input.line,
    deliveredQuantity: input.deliveredQuantity,
    remainingQuantity:
      input.line.confirmedQuantity - input.deliveredQuantity,
  };
}

export function deriveDeliveryStatus(
  lines: DeliveryLine[],
): Delivery['status'] {
  const delivered = lines.reduce(
    (sum, line) => sum + line.deliveredQuantity,
    0,
  );
  const confirmed = lines.reduce(
    (sum, line) => sum + line.confirmedQuantity,
    0,
  );

  if (delivered === 0) return 'PENDING';
  if (delivered >= confirmed) return 'DELIVERED';
  return 'PARTIAL';
}


export interface DeliveryReadinessIssue {
  code:
    | 'BILLING_NOT_INVOICED'
    | 'PAYMENT_CASE_MISMATCH'
    | 'PREPAYMENT_REQUIRED'
    | 'NO_DELIVERABLE_LINES';
  detail?: string;
}

export interface DeliveryReadinessResult {
  releasable: boolean;
  issues: DeliveryReadinessIssue[];
}

export function evaluateDeliveryReadiness(input: {
  billingSheet: BillingSheet;
  payment: PaymentCase;
}): DeliveryReadinessResult {
  const issues: DeliveryReadinessIssue[] = [];

  if (input.billingSheet.status !== 'INVOICED') {
    issues.push({ code: 'BILLING_NOT_INVOICED' });
  }

  if (input.payment.billingSheetId !== input.billingSheet.id) {
    issues.push({ code: 'PAYMENT_CASE_MISMATCH' });
  }

  const deliverableLines = input.billingSheet.lines.filter(
    (line) =>
      line.sourceType === 'ORDER_CONFIRMATION' &&
      Boolean(line.catalogItemId) &&
      line.quantity > 0,
  );

  if (!deliverableLines.length) {
    issues.push({ code: 'NO_DELIVERABLE_LINES' });
  }

  const prepaymentNeeded = deliverableLines.some(
    (line) => line.prepaymentRequired === true,
  );

  if (prepaymentNeeded && input.payment.status !== 'PAID') {
    issues.push({ code: 'PREPAYMENT_REQUIRED' });
  }

  return {
    releasable: issues.length === 0,
    issues,
  };
}

export function createDeliveryFromBilling(input: {
  id: string;
  orderId: string;
  confirmationIds: string[];
  billingSheet: BillingSheet;
  payment: PaymentCase;
}): Delivery {
  const readiness = evaluateDeliveryReadiness({
    billingSheet: input.billingSheet,
    payment: input.payment,
  });

  if (!readiness.releasable) {
    throw new Error(
      `DELIVERY_NOT_RELEASABLE:${readiness.issues
        .map((issue) => issue.code)
        .join(',')}`,
    );
  }

  const lines: DeliveryLine[] = input.billingSheet.lines
    .filter(
      (line) =>
        line.sourceType === 'ORDER_CONFIRMATION' &&
        Boolean(line.catalogItemId) &&
        line.quantity > 0,
    )
    .map((line) => ({
      catalogItemId: line.catalogItemId!,
      confirmedQuantity: line.quantity,
      deliveredQuantity: 0,
      remainingQuantity: line.quantity,
    }));

  return {
    id: input.id,
    seasonId: input.billingSheet.seasonId,
    organizationId: input.billingSheet.organizationId,
    orderId: input.orderId,
    billingSheetId: input.billingSheet.id,
    confirmationIds: input.confirmationIds,
    status: 'PENDING',
    lines,
  };
}

export function recordDeliveryQuantity(input: {
  delivery: Delivery;
  catalogItemId: string;
  deliveredQuantity: number;
}): Delivery {
  const lines = input.delivery.lines.map((line) =>
    line.catalogItemId === input.catalogItemId
      ? updateDeliveredQuantity({
          line,
          deliveredQuantity: input.deliveredQuantity,
        })
      : line,
  );

  if (!lines.some((line) => line.catalogItemId === input.catalogItemId)) {
    throw new Error('DELIVERY_LINE_NOT_FOUND');
  }

  return {
    ...input.delivery,
    lines,
    status: deriveDeliveryStatus(lines),
  };
}
