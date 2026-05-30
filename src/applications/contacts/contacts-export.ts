import * as XLSX from 'xlsx';

type ContactRow = {
  name?: string;
  baseName?: string;
  phone?: string;
  email?: string;
  cedula?: string;
  city?: string;
  address?: string;
  crmType?: 'lead' | 'client';
  lastReservationAt?: number;
  dealLabel?: string;
  tags?: string[];
  hasConversation?: boolean;
  createdAt?: number;
};

function isCrmClient(contact: ContactRow): boolean {
  return contact.crmType === 'client' || Boolean(contact.lastReservationAt);
}

function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toSheetRow(contact: ContactRow): Record<string, string> {
  const client = isCrmClient(contact);
  return {
    Nombre: contact.name ?? '',
    'Nombre base': contact.baseName ?? '',
    Teléfono: contact.phone ?? '',
    Correo: contact.email ?? '',
    Cédula: contact.cedula ?? '',
    Ciudad: contact.city ?? '',
    Dirección: contact.address ?? '',
    Tipo: client ? 'Cliente' : 'Lead',
    'Etiquetas (chat)': (contact.tags ?? []).join(', '),
    'Contexto deal': contact.dealLabel ?? '',
    'Fecha registro': formatDate(contact.createdAt),
    'Última reserva': formatDate(contact.lastReservationAt),
    'Tiene conversación': contact.hasConversation ? 'Sí' : 'No',
  };
}

export function buildContactsExcelBuffer(
  contacts: ContactRow[],
  scope: 'todos' | 'clientes' | 'leads' = 'todos',
): Buffer {
  const clients = contacts.filter(isCrmClient);
  const leads = contacts.filter((c) => !isCrmClient(c));
  const workbook = XLSX.utils.book_new();

  if (scope === 'todos' || scope === 'clientes') {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(clients.map(toSheetRow)),
      'Clientes',
    );
  }

  if (scope === 'todos' || scope === 'leads') {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(leads.map(toSheetRow)),
      'Leads',
    );
  }

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

export function buildContactsExportFilename(
  scope: 'todos' | 'clientes' | 'leads',
  search?: string,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = search?.trim() ? '-filtrado' : '';
  return `fincasya-${scope}${suffix}-${date}.xlsx`;
}
