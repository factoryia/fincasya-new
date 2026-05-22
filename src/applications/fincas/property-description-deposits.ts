export const DEPOSIT_BLOCK_HEADING = '💰 Costos adicionales de la estadía:';

const LEGACY_DEPOSIT_LINE =
  /^\s*[•\-]?\s*Depósito por daños \(reembolsable\):.*$/gim;
const LEGACY_MANILLA_LINE = /^\s*[•\-]?\s*Manilla condominio:.*$/gim;

const AUTO_DEPOSIT_BULLET =
  /^\s*[•\-]\s*Depósito por daños \(reembolsable\):/i;
const AUTO_MANILLA_BULLET = /^\s*[•\-]\s*Manilla condominio:/i;

function isManagedDepositHeadingLine(line: string): boolean {
  const t = line.trim();
  return t === DEPOSIT_BLOCK_HEADING || t.startsWith(DEPOSIT_BLOCK_HEADING);
}

function isManagedDepositBulletLine(line: string): boolean {
  return AUTO_DEPOSIT_BULLET.test(line) || AUTO_MANILLA_BULLET.test(line);
}

function stripManagedDepositBlockLines(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isManagedDepositHeadingLine(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && isManagedDepositBulletLine(lines[j])) {
      j += 1;
    }

    if (j > i + 1) {
      i = j;
      while (i < lines.length && lines[i].trim() === '') i += 1;
      continue;
    }

    out.push(lines[i]);
    i += 1;
  }

  return out.join('\n');
}

export function stripDepositBlockFromDescription(text: string): string {
  let result = stripManagedDepositBlockLines(text ?? '');

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
  if (!block) return base;

  if (base.includes(DEPOSIT_BLOCK_HEADING)) {
    const bullets = block
      .replace(`\n\n${DEPOSIT_BLOCK_HEADING}\n`, '\n')
      .trim();
    return bullets ? `${base}\n${bullets}` : base;
  }

  return base + block;
}
