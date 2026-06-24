import {
  PdfService,
  ReservationConfirmationData,
  ReservationPaymentMethod,
} from '../shared/services/pdf.service';
import { buildConfirmationFooterBlock } from './confirmation-terms';

function paymentMark(
  selected: ReservationPaymentMethod,
  method: ReservationPaymentMethod,
): string {
  return selected === method ? 'X' : '';
}

/**
 * Valores {{placeholders}} para la plantilla Word de confirmación de reserva.
 * Mapeo alineado con el HTML/PDF existente y la plantilla VILLA TRIANA.
 */
export function buildConfirmationWordValues(
  data: ReservationConfirmationData,
  pdf: PdfService,
): Record<string, string> {
  const method = pdf.normalizePaymentMethod(String(data.paymentMethod || ''));
  const checkInOut = `${pdf.formatTimeDisplayPublic(data.checkInTime)} / ${pdf.formatTimeDisplayPublic(data.checkOutTime)}`;
  const contractDisplay = (data.contractNumber || '-').trim().toUpperCase();
  const footerBlock = buildConfirmationFooterBlock();

  const values: Record<string, string> = {
    // Claves de la plantilla CR / VILLA TRIANA
    cr: contractDisplay,
    nombredelcliente: (data.clientName || '-').trim().toUpperCase(),
    cedula: data.clientId || '-',
    correo: data.clientEmail || '-',
    fecha: pdf.formatDateDisplayPublic(data.issueDate),
    telefono: data.clientPhone || '-',
    direccion: data.clientAddress || '-',
    finca: data.propertyName || '-',
    ubicacion: data.propertyLocation || '-',
    fechadeingreso: pdf.formatDateLongPublic(data.checkInDate),
    fechadesalida: pdf.formatDateLongPublic(data.checkOutDate),
    abono: pdf.formatCurrencyPublic(data.depositAmount),
    'fecha de abono': pdf.formatDateLongPublic(data.depositDate),
    valoralquiler: pdf.formatCurrencyPublic(data.rentAmount),
    limpieza: pdf.formatCurrencyPublic(data.cleaningFee),
    'deposito+mascotas': pdf.formatCurrencyPublic(data.refundableDeposit),
    valorsaldo: pdf.formatCurrencyPublic(data.balanceAmount),
    fechadesaldo: pdf.formatDateLongPublic(data.balanceDate),
    total: pdf.formatCurrencyPublic(data.totalAmount),
    'información de la fincasy reserva algo asi': footerBlock,
    checkInCheckOut: checkInOut,
    // Alias compatibles con otras plantillas / HTML
    contratoNumero: data.contractNumber || '-',
    numeroConfirmacion: data.contractNumber || '-',
    numeroContrato: data.contractNumber || '-',
    clienteNombre: data.clientName || '-',
    clienteCedula: data.clientId || '-',
    clienteEmail: data.clientEmail || '-',
    fechaEmision: pdf.formatDateDisplayPublic(data.issueDate),
    clienteTelefono: data.clientPhone || '-',
    clienteCelular: data.clientPhone || '-',
    clienteDireccion: data.clientAddress || '-',
    propiedadNombre: data.propertyName || '-',
    nombreFinca: data.propertyName || '-',
    propiedadUbicacion: data.propertyLocation || '-',
    ubicacionFinca: data.propertyLocation || '-',
    fechaEntrada: pdf.formatDateLongPublic(data.checkInDate),
    fechaSalida: pdf.formatDateLongPublic(data.checkOutDate),
    horaEntrada: pdf.formatTimeDisplayPublic(data.checkInTime),
    horaSalida: pdf.formatTimeDisplayPublic(data.checkOutTime),
    chekInChekOut: checkInOut,
    huespedes: String(data.guests || 1),
    noches: String(data.nights || 1).padStart(2, '0'),
    tipoGrupo: (data.groupType || '').trim() || '-',
    propositoEstancia: (data.purpose || '').trim() || '-',
    valorAbono: pdf.formatCurrencyPublic(data.depositAmount),
    fechaAbono: pdf.formatDateLongPublic(data.depositDate),
    valorAlquiler: pdf.formatCurrencyPublic(data.rentAmount),
    valorLimpieza: pdf.formatCurrencyPublic(data.cleaningFee),
    valorLimpiezaGeneral: pdf.formatCurrencyPublic(data.cleaningFee),
    valorDepositoReembolsable: pdf.formatCurrencyPublic(data.refundableDeposit),
    valorSaldo: pdf.formatCurrencyPublic(data.balanceAmount),
    fechaSaldo: pdf.formatDateLongPublic(data.balanceDate),
    valorTotal: pdf.formatCurrencyPublic(data.totalAmount),
    markBBVA: paymentMark(method, 'bbva'),
    markBancolombia: paymentMark(method, 'bancolombia'),
    markDavivienda: paymentMark(method, 'davivienda'),
    markNequi: paymentMark(method, 'nequi'),
    markPSE: paymentMark(method, 'pse'),
    markTarjetaCredito: paymentMark(method, 'tarjeta_credito'),
  };

  if ((data.petCleaningFee ?? 0) > 0) {
    values.valorAseoMascotas = pdf.formatCurrencyPublic(
      data.petCleaningFee ?? 0,
    );
  }

  return values;
}
