export const DEPOSIT_BLOCK_HEADING = '💰 Costos adicionales de la estadía:';

const LEGACY_DEPOSIT_LINE =
  /^\s*[•\-]?\s*Depósito por daños \(reembolsable\):.*$/gim;
const LEGACY_MANILLA_LINE = /^\s*[•\-]?\s*Manilla condominio:.*$/gim;
const LEGACY_ASEO_LINE = /^\s*[•\-]?\s*Auxilio de aseo:.*$/gim;

const AUTO_DEPOSIT_BULLET =
  /^\s*[•\-]\s*Depósito por daños \(reembolsable\):/i;
const AUTO_MANILLA_BULLET = /^\s*[•\-]\s*Manilla condominio:/i;
const AUTO_ASEO_BULLET = /^\s*[•\-]\s*Auxilio de aseo:/i;

function isManagedDepositHeadingLine(line: string): boolean {
  const t = line.trim();
  return t === DEPOSIT_BLOCK_HEADING || t.startsWith(DEPOSIT_BLOCK_HEADING);
}

function isManagedDepositBulletLine(line: string): boolean {
  return (
    AUTO_DEPOSIT_BULLET.test(line) ||
    AUTO_MANILLA_BULLET.test(line) ||
    AUTO_ASEO_BULLET.test(line)
  );
}

function isBulletLine(line: string): boolean {
  return /^\s*[•\-]/.test(line);
}

function splitCostSectionFromLines(lines: string[]): {
  out: string[];
  customBullets: string[];
} {
  const out: string[] = [];
  const customBullets: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isManagedDepositHeadingLine(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    let j = i + 1;
    const sectionCustom: string[] = [];
    let managedInSection = 0;

    while (j < lines.length && isBulletLine(lines[j])) {
      if (isManagedDepositBulletLine(lines[j])) {
        managedInSection += 1;
      } else {
        sectionCustom.push(lines[j]);
      }
      j += 1;
    }

    if (managedInSection > 0 || sectionCustom.length > 0) {
      customBullets.push(...sectionCustom);
      i = j;
      while (i < lines.length && lines[i].trim() === '') i += 1;
      continue;
    }

    out.push(lines[i]);
    i += 1;
  }

  return { out, customBullets };
}

export function stripDepositBlockFromDescription(text: string): string {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const { out } = splitCostSectionFromLines(lines);
  let result = out.join('\n');

  result = result
    .replace(LEGACY_DEPOSIT_LINE, '')
    .replace(LEGACY_MANILLA_LINE, '')
    .replace(LEGACY_ASEO_LINE, '')
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
  depositoAseo?: number,
  extraBullets: string[] = [],
): string {
  const deposito = Math.max(0, Number(depositoDanosReembolsable) || 0);
  const manilla = Math.max(0, Number(manillaCondominio) || 0);
  const aseo = Math.max(0, Number(depositoAseo) || 0);
  const custom = extraBullets.filter((line) => line.trim().length > 0);

  if (deposito === 0 && manilla === 0 && aseo === 0 && custom.length === 0)
    return '';

  const lines = [DEPOSIT_BLOCK_HEADING];
  if (deposito > 0) {
    lines.push(
      `• Depósito por daños (reembolsable): ${formatCopLine(deposito)}`,
    );
  }
  if (manilla > 0) {
    lines.push(`• Manilla condominio: ${formatCopLine(manilla)}`);
  }
  if (aseo > 0) {
    lines.push(`• Auxilio de aseo: ${formatCopLine(aseo)}`);
  }
  for (const line of custom) {
    lines.push(line);
  }

  return `\n\n${lines.join('\n')}`;
}

export function mergeDepositIntoPropertyDescription(
  description: string | undefined,
  depositoDanosReembolsable?: number,
  manillaCondominio?: number,
  depositoAseo?: number,
): string {
  const rawLines = (description ?? '').replace(/\r\n?/g, '\n').split('\n');
  const { out, customBullets } = splitCostSectionFromLines(rawLines);
  let base = out.join('\n');

  base = base
    .replace(LEGACY_DEPOSIT_LINE, '')
    .replace(LEGACY_MANILLA_LINE, '')
    .replace(LEGACY_ASEO_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  const block = buildDepositDescriptionBlock(
    depositoDanosReembolsable,
    manillaCondominio,
    depositoAseo,
    customBullets,
  );
  if (!block) return base;

  if (base.includes(DEPOSIT_BLOCK_HEADING)) {
    const managedOnly = buildDepositDescriptionBlock(
      depositoDanosReembolsable,
      manillaCondominio,
      depositoAseo,
      [],
    );
    const bullets = managedOnly
      .replace(`\n\n${DEPOSIT_BLOCK_HEADING}\n`, '\n')
      .trim();
    const extra = customBullets.join('\n');
    const appended = [bullets, extra].filter(Boolean).join('\n');
    return appended ? `${base}\n${appended}` : base;
  }

  return base + block;
}
