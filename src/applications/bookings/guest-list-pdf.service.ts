import { Injectable, Logger } from '@nestjs/common';
import PizZip from 'pizzip';
import { FincasService } from '../fincas/fincas.service';
import { PdfService } from '../shared/services/pdf.service';
import { loadDefaultGuestListTemplateBytes } from './guest-list-default-template';
import {
  buildGuestListGuestsTableXml,
  buildGuestListMetaTableXml,
  processGuestListTemplateXml,
} from './guest-list-word.util';

export type GuestListPdfGuest = {
  nombreCompleto?: string;
  cedula?: string;
  tipoDocumento?: string;
  esMenor?: boolean;
};

export type GuestListPdfInput = {
  propertyTitle: string;
  propertyLocation?: string | null;
  guestName: string;
  reference?: string | null;
  checkInDate: string;
  checkOutDate: string;
  guests: GuestListPdfGuest[];
  numeroPersonas?: number | null;
  needsEmpleada?: boolean;
  needsTeam?: boolean;
  petCount?: number;
  vehiclePlates?: string | null;
  servicesNote?: string | null;
};

@Injectable()
export class GuestListPdfService {
  private readonly logger = new Logger(GuestListPdfService.name);

  constructor(
    private readonly fincasService: FincasService,
    private readonly pdfService: PdfService,
  ) {}

  buildFilename(reference?: string | null, propertyTitle?: string): string {
    const safeRef = String(reference || propertyTitle || 'checkin').replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    return `Invitados-${safeRef}.pdf`;
  }

  private docLabel(t?: string): string {
    const map: Record<string, string> = {
      CC: 'C.C.',
      TI: 'T.I.',
      CE: 'C.E.',
      PA: 'Pasaporte',
      RC: 'R.C.',
    };
    return map[String(t ?? '').toUpperCase()] || 'C.C.';
  }

  private formatGuestDocument(g: GuestListPdfGuest): string {
    if (g.esMenor) return 'Menor de 2 años';
    const tipo = String(g.tipoDocumento ?? 'CC').trim().toUpperCase() || 'CC';
    const esMenorEdad = tipo === 'TI' || tipo === 'RC';
    const base = g.cedula?.trim()
      ? `${tipo} ${g.cedula.trim()}`
      : 'Sin documento';
    return esMenorEdad ? `${base} · Menor de edad` : base;
  }

  private buildMetaPairs(input: GuestListPdfInput): Array<[string, string]> {
    const empleadaLabel = input.needsTeam
      ? 'Sí (varias)'
      : input.needsEmpleada
        ? 'Sí'
        : 'No';
    const nMascotas = Math.max(0, Math.floor(Number(input.petCount) || 0));
    const mascotasLabel =
      nMascotas > 0 ? `Sí (${nMascotas})` : 'No van mascotas';
    const placas = String(input.vehiclePlates ?? '').trim();

    const pairs: Array<[string, string]> = [
      ['Propiedad', input.propertyTitle || 'Propiedad'],
      ...(input.propertyLocation
        ? ([['Ubicación', input.propertyLocation]] as Array<[string, string]>)
        : []),
      ['Titular de la reserva', input.guestName || '—'],
      ['Referencia', input.reference || '—'],
      ['Entrada', input.checkInDate],
      ['Salida', input.checkOutDate],
      [
        'Personas',
        String(input.numeroPersonas ?? input.guests.length ?? '—'),
      ],
      ['Empleada de servicio', empleadaLabel],
      ['Mascotas', mascotasLabel],
    ];
    if (placas) pairs.push(['Placas vehiculares', placas]);
    const note = String(input.servicesNote ?? '').trim();
    if (note) pairs.push(['Nota de servicios', note]);
    return pairs;
  }

  private buildHtmlFallback(input: GuestListPdfInput): string {
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const metaRows = this.buildMetaPairs(input)
      .map(
        ([k, v]) =>
          `<tr><th style="border:1px solid #ddd;background:#f5f5f5;text-align:left;width:34%;padding:6px 10px;">${esc(
            k,
          )}</th><td style="border:1px solid #ddd;padding:6px 10px;">${esc(
            v,
          )}</td></tr>`,
      )
      .join('');
    const guestRows = input.guests
      .map(
        (g, i) =>
          `<tr><td style="border:1px solid #ddd;text-align:center;width:36px;padding:6px 10px;">${
            i + 1
          }</td><td style="border:1px solid #ddd;padding:6px 10px;">${esc(
            g.nombreCompleto || '—',
          )}</td><td style="border:1px solid #ddd;padding:6px 10px;">${esc(
            this.formatGuestDocument(g),
          )}</td></tr>`,
      )
      .join('');
    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, 'Segoe UI', sans-serif; color: #111; padding: 8px; }
  h1 { font-size: 16pt; margin: 0 0 4pt; text-align: center; }
  p.sub { text-align: center; color: #555; font-size: 10pt; margin: 0 0 16pt; }
  h2 { font-size: 12pt; margin: 0 0 8pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16pt; font-size: 11pt; }
</style></head>
<body>
  <h1>Lista de invitados — Check-in</h1>
  <p class="sub">Documento generado por Fincas Ya para el propietario.</p>
  <table><tbody>${metaRows}</tbody></table>
  <h2>Personas registradas (${input.guests.length})</h2>
  <table>
    <thead><tr>
      <th style="border:1px solid #ddd;background:#f5f5f5;padding:6px 10px;width:36px;">#</th>
      <th style="border:1px solid #ddd;background:#f5f5f5;text-align:left;padding:6px 10px;">Nombre completo</th>
      <th style="border:1px solid #ddd;background:#f5f5f5;text-align:left;padding:6px 10px;">Documento</th>
    </tr></thead>
    <tbody>${guestRows}</tbody>
  </table>
</body></html>`;
  }

  async generateBuffer(
    input: GuestListPdfInput,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const guests = (input.guests ?? []).filter((g) => !g.esMenor);
    if (guests.length === 0) {
      throw new Error('No hay invitados registrados para exportar.');
    }

    const filename = this.buildFilename(input.reference, input.propertyTitle);
    const templateBytes = await loadDefaultGuestListTemplateBytes();

    if (templateBytes && templateBytes.slice(0, 2).toString() === 'PK') {
      try {
        const metaTableXml = buildGuestListMetaTableXml(
          this.buildMetaPairs(input),
        );
        const guestsTableXml = buildGuestListGuestsTableXml(
          ['#', 'Nombre completo', 'Documento'],
          guests.map((g, i) => [
            String(i + 1),
            g.nombreCompleto?.trim() || '—',
            this.formatGuestDocument(g),
          ]),
        );

        const zip = new PizZip(templateBytes);
        const xmlTargets = Object.keys(zip.files).filter(
          (name) =>
            !zip.files[name].dir &&
            (name === 'word/document.xml' ||
              /^word\/header\d+\.xml$/.test(name) ||
              /^word\/footer\d+\.xml$/.test(name)),
        );
        for (const fileName of xmlTargets) {
          const raw = zip.file(fileName)?.asText();
          if (!raw) continue;
          if (fileName === 'word/document.xml') {
            zip.file(
              fileName,
              processGuestListTemplateXml(
                raw,
                metaTableXml,
                guestsTableXml,
              ),
            );
          }
        }

        const docxBuffer: Buffer = zip.generate({
          type: 'nodebuffer',
          compression: 'DEFLATE',
        });
        const pdfBuffer =
          await this.fincasService.convertDocxBufferToPdf(docxBuffer);
        return { buffer: pdfBuffer, filename };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[guest-list-pdf] Plantilla Word falló, usando HTML: ${msg}`,
        );
      }
    }

    const html = this.buildHtmlFallback({ ...input, guests });
    const buffer = await this.pdfService.htmlToPdf(html);
    return { buffer, filename };
  }
}
