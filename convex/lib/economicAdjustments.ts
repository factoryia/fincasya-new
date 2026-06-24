export type EconomicAdjustment = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'INCREMENT' | 'DISCOUNT';
  createdBy?: string;
  createdAt: number;
};

export function sumEconomicAdjustments(
  adjustments: EconomicAdjustment[] | undefined,
): number {
  if (!adjustments?.length) return 0;
  return adjustments.reduce(
    (sum, item) =>
      sum + (item.type === 'INCREMENT' ? item.amount : -item.amount),
    0,
  );
}

export function economicAdjustmentBreakdownRows(
  adjustments: EconomicAdjustment[] | undefined,
): Array<{ label: string; amount: number }> {
  if (!adjustments?.length) return [];
  return adjustments.map((item) => ({
    label:
      item.type === 'INCREMENT'
        ? `Ajuste: ${item.description}`
        : `Descuento: ${item.description}`,
    amount: item.type === 'INCREMENT' ? item.amount : -item.amount,
  }));
}
