const DEPOSIT_BLOCK_HEADING = '💰 Costos adicionales de la estadía:';

const LEGACY_DEPOSIT_LINE =
  /^\s*[•\-]?\s*Depósito por daños \(reembolsable\):.*$/gim;
const LEGACY_MANILLA_LINE = /^\s*[•\-]?\s*Manilla condominio:.*$/gim;

export function stripDepositBlockFromDescription(text: string): string {
  let result = (text ?? '').replace(/\r\n?/g, '\n').trimEnd();

  const markerIdx = result.indexOf(DEPOSIT_BLOCK_HEADING);
  if (markerIdx !== -1) {
    result = result.slice(0, markerIdx).trimEnd();
  }

  result = result
    .replace(LEGACY_DEPOSIT_LINE, '')
    .replace(LEGACY_MANILLA_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  return result;
}

function formatCopLine(amount: number): string {
  return `$${Math.round(amount).toLocaleString('es-CO')}`;
}

export function buildDepositDescriptionBlock(
  depositoDanosReembolsable?: number,
  manillaCondominio?: number,
): string {
  const deposito = Math.max(0, Number(depositoDanosReembolsable) || 0);
  const manilla = Math.max(0, Number(manillaCondominio) || 0);

  if (deposito === 0 && manilla === 0) return '';

  const lines = [DEPOSIT_BLOCK_HEADING];
  if (deposito > 0) {
    lines.push(
      `• Depósito por daños (reembolsable): ${formatCopLine(deposito)}`,
    );
  }
  if (manilla > 0) {
    lines.push(`• Manilla condominio: ${formatCopLine(manilla)}`);
  }

  return `\n\n${lines.join('\n')}`;
}

export function mergeDepositIntoPropertyDescription(
  description: string | undefined,
  depositoDanosReembolsable?: number,
  manillaCondominio?: number,
): string {
  const base = stripDepositBlockFromDescription(description ?? '');
  const block = buildDepositDescriptionBlock(
    depositoDanosReembolsable,
    manillaCondominio,
  );
  return base + block;
}
