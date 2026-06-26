#!/usr/bin/env python3
"""
Genera assets/contracts/default-guest-list-template.docx desde Doc1.docx.

Doc1 trae logo/encabezado; este script inserta el cuerpo con placeholders
{{tablaMeta}} y {{tablaInvitados}} que el backend reemplaza al generar el PDF.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS_DIR = ROOT / "assets" / "contracts"
SOURCE = CONTRACTS_DIR / "Doc1.docx"
OUTPUT = CONTRACTS_DIR / "default-guest-list-template.docx"
WATERMARK_OUT = CONTRACTS_DIR / "guest-list-watermark.png"
WATERMARK_ENTRY = "word/media/image1.png"

BODY_BLOCK = """
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="60" w:line="340" w:lineRule="auto"/></w:pPr>
  <w:r><w:rPr><w:b/><w:sz w:val="40"/><w:lang w:val="es-CO"/></w:rPr><w:t xml:space="preserve">LISTA DE INVITADOS — CHECK-IN</w:t></w:r>
</w:p>
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="100" w:line="300" w:lineRule="auto"/></w:pPr>
  <w:r><w:rPr><w:sz w:val="26"/><w:color w:val="666666"/><w:lang w:val="es-CO"/></w:rPr><w:t xml:space="preserve">Documento generado por Fincas Ya para el propietario</w:t></w:r>
</w:p>
<w:p><w:r><w:t>{{contenido}}</w:t></w:r></w:p>
""".strip()


def patch_document_xml(xml: str) -> str:
    body_start = xml.find("<w:body>")
    sect_start = xml.find("<w:sectPr")
    if body_start == -1 or sect_start == -1:
        raise SystemExit("No se encontró w:body o w:sectPr en document.xml")
    patched = xml[: body_start + len("<w:body>")] + BODY_BLOCK + xml[sect_start:]
    patched = patched.replace(
        'w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"',
        'w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="480" w:footer="360" w:gutter="0"',
    )
    return patched


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    if not source.is_file():
        raise SystemExit(f"No se encontró plantilla origen: {source}")
    if source.name.startswith("~$"):
        raise SystemExit(f"«{source.name}» es bloqueo de Word. Cierra Word y vuelve a intentar.")

    patched: dict[str, bytes] = {}
    watermark_bytes: bytes | None = None
    with zipfile.ZipFile(source, "r") as zin:
        names = zin.namelist()
        for name in names:
            data = zin.read(name)
            if name == WATERMARK_ENTRY:
                watermark_bytes = data
            if name == "word/document.xml":
                text = data.decode("utf-8")
                text = patch_document_xml(text)
                data = text.encode("utf-8")
            patched[name] = data

    if watermark_bytes:
        WATERMARK_OUT.write_bytes(watermark_bytes)

    tmp = OUTPUT.with_suffix(".docx.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            zout.writestr(name, patched[name])
    tmp.replace(OUTPUT)
    print(f"Plantilla lista de invitados: {OUTPUT}")
    print(f"Origen: {source.name}")
    if watermark_bytes:
        print(f"Marca de agua: {WATERMARK_OUT}")


if __name__ == "__main__":
    main()
