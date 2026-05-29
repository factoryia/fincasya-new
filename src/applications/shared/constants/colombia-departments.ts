/** 32 departamentos de Colombia (códigos estables sin tildes). */
export const COLOMBIA_DEPARTMENTS = [
  { code: 'AMAZONAS', label: 'Amazonas' },
  { code: 'ANTIOQUIA', label: 'Antioquia' },
  { code: 'ARAUCA', label: 'Arauca' },
  { code: 'ATLANTICO', label: 'Atlántico' },
  { code: 'BOLIVAR', label: 'Bolívar' },
  { code: 'BOYACA', label: 'Boyacá' },
  { code: 'CALDAS', label: 'Caldas' },
  { code: 'CAQUETA', label: 'Caquetá' },
  { code: 'CASANARE', label: 'Casanare' },
  { code: 'CAUCA', label: 'Cauca' },
  { code: 'CESAR', label: 'Cesar' },
  { code: 'CHOCO', label: 'Chocó' },
  { code: 'CORDOBA', label: 'Córdoba' },
  { code: 'CUNDINAMARCA', label: 'Cundinamarca' },
  { code: 'GUAINIA', label: 'Guainía' },
  { code: 'GUAVIARE', label: 'Guaviare' },
  { code: 'HUILA', label: 'Huila' },
  { code: 'LA_GUAJIRA', label: 'La Guajira' },
  { code: 'MAGDALENA', label: 'Magdalena' },
  { code: 'META', label: 'Meta' },
  { code: 'NARINO', label: 'Nariño' },
  { code: 'NORTE_DE_SANTANDER', label: 'Norte de Santander' },
  { code: 'PUTUMAYO', label: 'Putumayo' },
  { code: 'QUINDIO', label: 'Quindío' },
  { code: 'RISARALDA', label: 'Risaralda' },
  { code: 'SAN_ANDRES_Y_PROVIDENCIA', label: 'San Andrés y Providencia' },
  { code: 'SANTANDER', label: 'Santander' },
  { code: 'SUCRE', label: 'Sucre' },
  { code: 'TOLIMA', label: 'Tolima' },
  { code: 'VALLE_DEL_CAUCA', label: 'Valle del Cauca' },
  { code: 'VAUPES', label: 'Vaupés' },
  { code: 'VICHADA', label: 'Vichada' },
] as const;

export type ColombiaDepartmentCode =
  (typeof COLOMBIA_DEPARTMENTS)[number]['code'];

export const COLOMBIA_DEPARTMENT_CODES: ColombiaDepartmentCode[] =
  COLOMBIA_DEPARTMENTS.map((d) => d.code);

export function getDepartmentLabel(code: string): string {
  const found = COLOMBIA_DEPARTMENTS.find((d) => d.code === code);
  return found?.label ?? code;
}
