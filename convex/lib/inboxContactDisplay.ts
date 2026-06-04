/** Etiqueta de contacto en el inbox (alineado con FincasYaWeb contact-display). */
export function formatInboxContactLabel(
  contact: { name?: string; phone?: string } | null | undefined,
  channel?: string,
): string {
  const name = (contact?.name ?? "").trim();
  const phone = contact?.phone ?? "";
  if (name && !/^visitante\s*web$/i.test(name)) return name;
  if (phone.startsWith("web:")) {
    const sid = phone.slice(4).trim();
    const short =
      sid.length > 10 ? `${sid.slice(0, 8)}…` : sid || "sesión";
    return `Chat web · ${short}`;
  }
  if (channel === "web") return "Chat web";
  return name || phone || "Sin nombre";
}

export function resolveConversationChannel(
  conversation: { channel?: string },
  contact: { phone?: string } | null | undefined,
): "whatsapp" | "web" {
  if (
    conversation.channel === "web" ||
    conversation.channel === "whatsapp"
  ) {
    return conversation.channel;
  }
  const phone = contact?.phone ?? "";
  if (phone.startsWith("web:")) return "web";
  return "whatsapp";
}

/** Minúsculas + sin acentos, para que "Jose" encuentre "José" y viceversa. */
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function contactMatchesInboxSearch(
  contact: { name?: string; phone?: string } | null | undefined,
  channel: string | undefined,
  query: string,
): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;

  const name = normalizeForSearch(formatInboxContactLabel(contact, channel));
  const phone = normalizeForSearch(contact?.phone ?? "");

  // 1) Coincidencia directa por nombre o teléfono.
  if (name.includes(q) || phone.includes(q)) return true;

  // 2) Sin espacios: "CamiloR" debe encontrar "Camilo Rodríguez".
  const qNoSpace = q.replace(/\s+/g, "");
  if (qNoSpace && name.replace(/\s+/g, "").includes(qNoSpace)) return true;

  // 3) Solo dígitos: "300 123" debe encontrar "+57 300 123".
  const qDigits = q.replace(/\D/g, "");
  if (qDigits.length >= 3 && phone.replace(/\D/g, "").includes(qDigits)) {
    return true;
  }

  // 4) Todos los tokens del query aparecen en el nombre (orden libre).
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => name.includes(t))) return true;

  return false;
}
