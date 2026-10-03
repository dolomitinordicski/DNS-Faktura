export function roundUpToCent(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('INVALID_MONEY_VALUE');
  }
  return Math.ceil(value * 100 - 1e-9) / 100;
}

export function roundMoney(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('INVALID_MONEY_VALUE');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
