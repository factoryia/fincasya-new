import {
  computePetFees,
  PET_CLEANING_FROM_THREE,
  PET_DEPOSIT_PER_PET,
} from './pet-fees';

/** Aseo final según cláusula TERCERA del contrato (no el depositoAseo de la ficha). */
export const CONFIRMATION_STANDARD_CLEANING_COP = 100_000;

/** Depósito reembolsable por mascota (100.000 c/u, máx. 2; ver pet-fees). */
export { PET_DEPOSIT_PER_PET as CONFIRMATION_PET_REFUNDABLE_COP };
export const CONFIRMATION_MAX_REFUNDABLE_PETS = 2;

/** Limpieza general de la confirmación: $100.000 + aseo extra si hay 3+ mascotas. */
export function resolveConfirmationCleaningFee(petCount?: number): {
  cleaningFee: number;
  petCleaningFee: number;
} {
  const n = Math.max(0, Math.floor(petCount ?? 0));
  const petCleaningFee = n >= 3 ? PET_CLEANING_FROM_THREE : 0;
  return {
    cleaningFee: CONFIRMATION_STANDARD_CLEANING_COP + petCleaningFee,
    petCleaningFee,
  };
}

export type ConfirmationFinancialInput = {
  /** Valor total del contrato (precioTotal). */
  precioTotal: number;
  /** Subtotal alojamiento: finca (+ personal servicio), sin mascotas ni depósitos. */
  subtotal?: number;
  /** Tarifa ingreso mascotas 3ª+ (costoMascotas). */
  petSurcharge?: number;
  cleaningFee: number;
  /** Depósito por daños (reembolsable), sin mascotas. */
  damageDeposit: number;
  petCount?: number;
  /** Depósito mascotas ya calculado en borrador (solo 1.ª y 2.ª). */
  depositoMascotas?: number;
  /** Aseo extra por 3+ mascotas (suma a limpieza). */
  petCleaningFee?: number;
};

export type ConfirmationFinancialResult = {
  rentAmount: number;
  cleaningFee: number;
  refundableDeposit: number;
  totalAmount: number;
  petCleaningFee: number;
};

/**
 * Valor TOTAL = precio del contrato (precioTotal, ej. 3.700.000).
 * Valor Alquiler = subtotal de la finca solamente (sin mascotas, depósitos ni abonos).
 * Limpieza y depósito reembolsable van en filas aparte (se pagan al ingreso).
 */
export function computeConfirmationFinancials(
  input: ConfirmationFinancialInput,
): ConfirmationFinancialResult {
  const totalAmount =
    input.precioTotal > 0
      ? input.precioTotal
      : Math.max(0, input.subtotal ?? 0);

  const petCount = Math.max(0, Math.floor(input.petCount ?? 0));
  const petSurcharge = Math.max(0, input.petSurcharge ?? 0);
  const subtotal = Math.max(0, input.subtotal ?? 0);

  let rentAmount = subtotal;
  if (rentAmount <= 0 && totalAmount > 0) {
    const pets = computePetFees(petCount);
    rentAmount = Math.max(0, totalAmount - petSurcharge - pets.serviceFee);
  }
  if (rentAmount > totalAmount && totalAmount > 0) {
    rentAmount = totalAmount;
  }

  let petRefundable = Math.max(0, input.depositoMascotas ?? 0);
  if (petRefundable <= 0 && petCount > 0) {
    petRefundable = computePetFees(petCount).deposit;
  }

  /** Fianza + depósito mascotas en una sola línea (ej. 300k + 2×100k = 500k). */
  const refundableDeposit = Math.max(0, input.damageDeposit) + petRefundable;
  const { cleaningFee, petCleaningFee } = resolveConfirmationCleaningFee(petCount);

  return { rentAmount, cleaningFee, refundableDeposit, totalAmount, petCleaningFee };
}
