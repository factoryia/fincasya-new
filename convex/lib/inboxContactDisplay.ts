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

export function contactMatchesInboxSearch(
  contact: { name?: string; phone?: string } | null | undefined,
  channel: string | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = formatInboxContactLabel(contact, channel).toLowerCase();
  const phone = (contact?.phone ?? "").toLowerCase();
  return name.includes(q) || phone.includes(q);
}
