export const PET_DEPOSIT_PER_PET = 100_000;
export const PET_ENTRY_FEE_FROM_THIRD = 30_000;
export const PET_CLEANING_FROM_THREE = 70_000;

export function computePetFees(petCount: number) {
  const n = Math.max(0, Math.floor(Number(petCount) || 0));
  const deposit = Math.min(n, 2) * PET_DEPOSIT_PER_PET;
  const serviceFee = Math.max(0, n - 2) * PET_ENTRY_FEE_FROM_THIRD;
  const cleaningFee = n >= 3 ? PET_CLEANING_FROM_THREE : 0;
  return {
    count: n,
    deposit,
    serviceFee,
    cleaningFee,
    total: deposit + serviceFee + cleaningFee,
  };
}
