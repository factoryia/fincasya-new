/**
 * Trato respetuoso por nombre: "Señor Juan" / "Señora María".
 *
 * El equipo de FincasYa trata a los clientes de forma FORMAL (usted + título).
 * Solo tenemos el nombre del perfil de WhatsApp, no el género — así que lo
 * inferimos con listas de nombres comunes en Colombia. Si el nombre NO está en
 * ninguna lista (ambiguo, apodo, raro), NO arriesgamos el género: se usa solo el
 * nombre (sin "Señor/Señora"). Mejor quedarse corto que decirle "Señor" a una
 * clienta.
 *
 * Para ampliar cobertura: agregar nombres a los sets (en minúsculas, sin acentos).
 */

/** Normaliza: minúsculas + sin acentos. */
function normalizeName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

const MALE_NAMES = new Set<string>([
  "juan", "jose", "carlos", "luis", "jorge", "andres", "santiago", "sebastian",
  "diego", "david", "miguel", "fernando", "camilo", "felipe", "daniel",
  "cristian", "christian", "julian", "alejandro", "mateo", "nicolas", "samuel",
  "esteban", "gabriel", "oscar", "ivan", "javier", "ricardo", "alberto",
  "mario", "hernan", "german", "cesar", "alvaro", "gustavo", "pedro", "pablo",
  "manuel", "rafael", "ramon", "roberto", "sergio", "victor", "hugo", "orlando",
  "wilson", "edwin", "jhon", "john", "brayan", "kevin", "anderson", "jefferson",
  "yeison", "duvan", "harold", "fabian", "edison", "arley", "jairo", "jaime",
  "gonzalo", "edgar", "henry", "freddy", "mauricio", "leonardo", "emmanuel",
  "tomas", "martin", "simon", "ignacio", "joaquin", "rodrigo", "marcos",
  "adrian", "dario", "elkin", "franklin", "milton", "nelson", "omar", "raul",
  "ruben", "wilmer", "yesid", "cristobal", "ernesto", "enrique", "francisco",
  "guillermo", "hector", "humberto", "julio", "leandro", "lucas", "marlon",
  "mauro", "nestor", "otoniel", "reinaldo", "renzo", "salomon", "teodoro",
  "uriel", "vicente", "wilfredo", "yohan", "jonathan", "brandon", "dylan",
  "matias", "benjamin", "thiago", "emiliano", "maximiliano", "hernando",
]);

const FEMALE_NAMES = new Set<string>([
  "maria", "ana", "luisa", "laura", "carolina", "andrea", "paula", "daniela",
  "valentina", "camila", "diana", "sandra", "patricia", "claudia", "adriana",
  "angela", "gloria", "martha", "marta", "lucia", "sofia", "isabella",
  "mariana", "natalia", "catalina", "juliana", "alejandra", "carmen", "rosa",
  "teresa", "beatriz", "esperanza", "consuelo", "yolanda", "luz", "olga",
  "nubia", "amparo", "stella", "elizabeth", "jenny", "jessica", "yessica",
  "karen", "tatiana", "viviana", "johana", "yohana", "angie", "michelle",
  "nicol", "nicole", "sara", "gabriela", "manuela", "salome", "antonella",
  "emma", "valeria", "ximena", "monica", "liliana", "marcela", "sonia", "ines",
  "pilar", "mercedes", "veronica", "carla", "cecilia", "silvia", "raquel",
  "susana", "lorena", "paola", "wendy", "yuliana", "leidy", "dayana",
  "geraldine", "estefania", "melissa", "valery", "isabel", "juana", "yaneth",
  "yamile", "brigitte", "dana", "sharon", "kelly", "eliana", "fernanda",
  "constanza", "ivonne", "lina", "milena", "yenny", "zulma", "aura", "flor",
  "margarita", "victoria", "alba", "clara", "elsa", "gina", "ruth", "sara",
  "valeria", "renata", "isabela", "abril", "regina", "julieta", "amelia",
]);

/**
 * Devuelve "Señor" | "Señora" según el nombre, o null si es ambiguo/desconocido
 * (en cuyo caso NO se usa título — se dirige por el nombre a secas).
 */
export function guessHonorific(firstName: string): "Señor" | "Señora" | null {
  const n = normalizeName(firstName);
  if (!n) return null;
  // Usa solo el primer token (ej. "María José" → "maria").
  const first = n.split(/\s+/)[0];
  if (MALE_NAMES.has(first)) return "Señor";
  if (FEMALE_NAMES.has(first)) return "Señora";
  return null;
}
