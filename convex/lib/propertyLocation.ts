/** Normaliza municipio para guardar y mostrar de forma consistente. */
const LOCATION_ALIASES: Record<string, string> = {
  acacias: 'Acacías',
  anapoima: 'Anapoima',
  apulo: 'Apulo',
  armenia: 'Armenia',
  barranquilla: 'Barranquilla',
  bogota: 'Bogotá',
  'carmen de apicala': 'Carmen de Apicalá',
  cartagena: 'Cartagena',
  cumaral: 'Cumaral',
  girardot: 'Girardot',
  granada: 'Granada',
  guataqui: 'Guataquí',
  manizales: 'Manizales',
  melgar: 'Melgar',
  nilo: 'Nilo',
  nocaima: 'Nocaima',
  pereira: 'Pereira',
  restrepo: 'Restrepo',
  ricaurte: 'Ricaurte',
  'san martin': 'San Martín',
  'santa marta': 'Santa Marta',
  tenjo: 'Tenjo',
  tocaima: 'Tocaima',
  villavicencio: 'Villavicencio',
  villeta: 'Villeta',
  viota: 'Viotá',
};

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeKey(location: string): string {
  return stripAccents(location.split(',')[0]?.trim().toLowerCase() ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function normalizePropertyLocation(
  location: string | undefined,
): string | undefined {
  if (location === undefined) return undefined;
  const city = location.split(',')[0]?.trim() ?? '';
  if (!city) return '';
  const key = normalizeKey(city);
  return LOCATION_ALIASES[key] ?? titleCaseWords(city);
}
