#!/usr/bin/env python3
"""Genera assets/contracts/default-contract-template.docx desde QUINTA OLAYA.docx."""
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "QUINTA OLAYA.docx"
OUT_DIR = ROOT / "assets" / "contracts"
OUT_FILE = OUT_DIR / "default-contract-template.docx"

# Reemplazos en texto completo del XML (una sola etiqueta w:t).
SIMPLE_REPLACEMENTS = [
    ("HERNÁN AGUILERA GÓMEZ", "{{adminNombre}}"),
    ("81.720.077", "{{adminCedula}}"),
    ("Chía (Cund)", "{{adminCiudad}}"),
    ("QUINTA OLAYA LUXURY", "{{nombreFinca}}"),
    ("Villeta", "{{municipioFinca}}"),
]

# Dentro de un w:t largo (no reemplazo de nodo completo).
INLINE_REPLACEMENTS = [
    (
        "propiedad del señor: </w:t>",
        "propiedad del señor: {{nombrePropietario}}, </w:t>",
    ),
    (" -------------------- ", " — "),
    ("noventa mil pesos {{aseofinal}}", "{{aseofinal}}"),
    (
        "trescientos mil pesos {{Depósitopordaños}}",
        "{{Depósitopordaños}}",
    ),
]

# Amenidades en varios w:t: primer nodo = placeholder, resto vacío.
AMENITY_WT_TEXTS = [
    "08 HABITACIONES",
    "09 BAÑOS",
    "01 PISCINA",
    "01 JACUZZI",
    "01 COCINA EQUIPADA",
    "SALA PRINCIPAL",
    "COMEDOR",
    "WIFI – TV",
    "PARQUEADERO",
    "AIRE ACONDICIONADO",
    "ZONA SOCIAL",
]

XML_PARTS = [
    "word/document.xml",
    "word/header1.xml",
    "word/header2.xml",
    "word/header3.xml",
    "word/footer1.xml",
    "word/footer2.xml",
    "word/footer3.xml",
]


def patch_wt_text(xml: str, old: str, new: str) -> str:
    """Sustituye el contenido de un nodo w:t exacto."""
    return xml.replace(f">{old}</w:t>", f">{new}</w:t>")


def patch_amenities(xml: str) -> str:
    for i, label in enumerate(AMENITY_WT_TEXTS):
        new = "{{caracteristicasDeFinca}}" if i == 0 else ""
        xml = patch_wt_text(xml, label, new)
    return xml


def patch_xml(xml: str) -> str:
    for old, new in SIMPLE_REPLACEMENTS:
        xml = patch_wt_text(xml, old, new)
    for old, new in INLINE_REPLACEMENTS:
        xml = xml.replace(old, new)
    return patch_amenities(xml)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SOURCE, "r") as zin:
        with zipfile.ZipFile(OUT_FILE, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename in XML_PARTS:
                    text = data.decode("utf-8")
                    text = patch_xml(text)
                    data = text.encode("utf-8")
                zout.writestr(item, data)
    print(f"Plantilla maestra: {OUT_FILE}")


if __name__ == "__main__":
    main()
