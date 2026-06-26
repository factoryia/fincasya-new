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

BODY_BLOCK = """
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:after="60" w:line="260" w:lineRule="auto"/></w:pPr>
  <w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">LISTA DE INVITADOS — CHECK-IN</w:t></w:r>
</w:p>
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:after="80" w:line="240" w:lineRule="auto"/></w:pPr>
  <w:r><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">Documento generado por Fincas Ya para el propietario</w:t></w:r>
</w:p>
<w:p><w:r><w:t>{{contenido}}</w:t></w:r></w:p>
""".strip()


def patch_document_xml(xml: str) -> str:
    marker = "<w:sectPr"
    idx = xml.find(marker)
    if idx == -1:
        raise SystemExit("No se encontró w:sectPr en document.xml")
    return xml[:idx] + BODY_BLOCK + xml[idx:]


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    if not source.is_file():
        raise SystemExit(f"No se encontró plantilla origen: {source}")
    if source.name.startswith("~$"):
        raise SystemExit(f"«{source.name}» es bloqueo de Word. Cierra Word y vuelve a intentar.")

    patched: dict[str, bytes] = {}
    with zipfile.ZipFile(source, "r") as zin:
        names = zin.namelist()
        for name in names:
            data = zin.read(name)
            if name == "word/document.xml":
                text = data.decode("utf-8")
                text = patch_document_xml(text)
                data = text.encode("utf-8")
            patched[name] = data

    tmp = OUTPUT.with_suffix(".docx.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            zout.writestr(name, patched[name])
    tmp.replace(OUTPUT)
    print(f"Plantilla lista de invitados: {OUTPUT}")
    print(f"Origen: {source.name}")


if __name__ == "__main__":
    main()
