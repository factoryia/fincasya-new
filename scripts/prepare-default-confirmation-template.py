#!/usr/bin/env python3
"""
Genera assets/contracts/default-confirmation-template.docx desde la plantilla CR
(ej. «CR 2454 SANDRA PATRICIA SÁNCHEZ, VILLA TRIANA 02 ABRIL 25.docx»).

La plantilla ya trae {{placeholders}}; este script corrige detalles menores y
normaliza el archivo maestro que usa el backend.

Uso:
  python3 scripts/prepare-default-confirmation-template.py
  python3 scripts/prepare-default-confirmation-template.py /ruta/al/archivo.docx
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS_DIR = ROOT / "assets" / "contracts"
OUTPUT = CONTRACTS_DIR / "default-confirmation-template.docx"

XML_PARTS = [
    "word/document.xml",
    "word/header1.xml",
    "word/header2.xml",
    "word/header3.xml",
    "word/footer1.xml",
    "word/footer2.xml",
    "word/footer3.xml",
]


def find_source_source(cli_path: Path | None) -> Path:
    if cli_path:
        return cli_path
    if OUTPUT.is_file():
        return OUTPUT
    candidates = sorted(
        CONTRACTS_DIR.glob("CR *.docx"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    candidates = [p for p in candidates if not p.name.startswith("~$")]
    if candidates:
        return candidates[0]
    legacy = CONTRACTS_DIR / "2454 SANDRA PATRICIA SÁNCHEZ, VILLA TRIANA 02 ABRIL 25.docx"
    if legacy.is_file():
        return legacy
    raise SystemExit(
        "No se encontró plantilla de confirmación en assets/contracts/.\n"
        "Guarda el .docx (p. ej. «CR 2454 … VILLA TRIANA ….docx») y vuelve a ejecutar."
    )


def patch_xml(xml: str) -> str:
    # Quitar resaltado amarillo de marcador en celdas de valor.
    xml = re.sub(r"<w:highlight\b[^/>]*/>", "", xml)
    xml = re.sub(r"<w:highlight\b[^>]*>[\s\S]*?</w:highlight>", "", xml)

    # Correo electrónico tenía {{cedula}} por error.
    xml = re.sub(
        r"(electr[oó]nico</w:t></w:r></w:p></w:tc><w:tc>[\s\S]{0,800}?)<w:t>\{\{cedula\}\}</w:t>",
        r"\1<w:t>{{correo}}</w:t>",
        xml,
        count=1,
    )

    xml = xml.replace(
        "{{información de la  fincasy reserva algo asi}}",
        "{{estadoPago}}",
    )
    xml = xml.replace(
        "{{información de la fincasy reserva algo asi}}",
        "{{estadoPago}}",
    )

    # Horarios fijos → placeholder dinámico (si aún no existe).
    if "{{checkInCheckOut}}" not in xml and "10:00 AM" in xml:
        xml = xml.replace("10:00 AM", "{{checkInCheckOut}}", 1)

    return xml


def main() -> None:
    cli = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    source = find_source_source(cli)
    if source.name.startswith("~$"):
        raise SystemExit(
            f"«{source.name}» es bloqueo de Word. Cierra Word y usa el .docx real."
        )

    patched: dict[str, bytes] = {}
    with zipfile.ZipFile(source, "r") as zin:
        names = zin.namelist()
        for name in names:
            data = zin.read(name)
            if name in XML_PARTS:
                text = data.decode("utf-8")
                text = patch_xml(text)
                data = text.encode("utf-8")
            patched[name] = data

    tmp = OUTPUT.with_suffix(".docx.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            zout.writestr(name, patched[name])
    tmp.replace(OUTPUT)
    print(f"Plantilla maestra: {OUTPUT}")
    print(f"Origen: {source.name}")


if __name__ == "__main__":
    main()
