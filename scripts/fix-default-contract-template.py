#!/usr/bin/env python3
"""
Ajusta assets/contracts/default-contract-template.docx para que solo cambien datos
({{placeholders}}), sin textos fijos de ejemplo ni montos literales duplicados.
Conserva negritas, subrayado y estructura Word de la plantilla QUINTA OLAYA.
"""
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "contracts" / "default-contract-template.docx"

XML_PARTS = [
    "word/document.xml",
    "word/header1.xml",
    "word/header2.xml",
    "word/header3.xml",
    "word/footer1.xml",
    "word/footer2.xml",
    "word/footer3.xml",
]


def patch_xml(xml: str) -> str:
    # Admin en el cuerpo del contrato (párrafo inicial).
    xml = xml.replace("N° 81.720.077", "N° {{adminCedula}}")
    xml = xml.replace("de Chía (Cund)", "de {{adminCiudad}}")

    # Bloque de firma ARRENDADOR.
    xml = xml.replace(
        ">HERNÁN AGUILERA GÓMEZ </w:t>",
        ">{{adminNombre}} </w:t>",
    )
    xml = xml.replace(
        ">C.C. N° 81.720.077 de Chía   </w:t>",
        ">C.C. N° {{adminCedula}} de {{adminCiudad}}   </w:t>",
    )

    # Montos literales de ejemplo antes del placeholder dinámico.
    xml = xml.replace("noventa mil pesos ", "")
    xml = xml.replace("trescientos mil pesos ", "")

    # Separador visual del párrafo introductorio.
    xml = xml.replace(" --------------------", " —")

    # Tabs vacíos tras nombre del propietario (restos de la plantilla ejemplo).
    xml = re.sub(
        r'(propiedad del señor: \{\{nombrePropietario\}\}, </w:t></w:r>)'
        r'(?:<w:r w:rsidR="00023C2E"><w:rPr><w:b/></w:rPr><w:tab/></w:r>)+',
        r'\1',
        xml,
    )

    # Bloque de cuentas bancarias: formato QUINTA OLAYA.
    # Número en negrita, " de " normal, banco en negrita (sin tipo de cuenta).
    xml = xml.replace(
        '{{cuentaNumero}}</w:t></w:r><w:r w:rsidR="007E482A"><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:spacing w:val="2"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r w:rsidR="007E482A" w:rsidRPr="00A55067"><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:spacing w:val="2"/></w:rPr><w:t>{{bancoNombre}}</w:t>',
        '{{cuentaNumero}}</w:t></w:r><w:r w:rsidR="007E482A"><w:t xml:space="preserve"> de </w:t></w:r><w:r w:rsidR="007E482A" w:rsidRPr="00A55067"><w:rPr><w:b/><w:bCs/></w:rPr><w:t>{{bancoNombre}}</w:t>',
    )
    # Titular de la cuenta: sin negrilla ni espaciado artificial.
    xml = xml.replace(
        '<w:r w:rsidR="007E482A" w:rsidRPr="00A55067"><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma"/><w:b/><w:spacing w:val="-8"/></w:rPr><w:t>{{titularNombre}}</w:t></w:r>',
        '<w:r w:rsidR="007E482A"><w:t>{{titularNombre}}</w:t></w:r>',
    )
    xml = xml.replace(
        '<w:r w:rsidR="007E482A"><w:rPr><w:spacing w:val="-16"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r><w:r w:rsidR="007E482A"><w:rPr><w:b/><w:bCs/><w:spacing w:val="-16"/></w:rPr><w:t>{{titularCedula}}</w:t></w:r>',
        '<w:r w:rsidR="007E482A"><w:t xml:space="preserve"> </w:t></w:r><w:r w:rsidR="007E482A"><w:t>{{titularCedula}}</w:t></w:r>',
    )

    # Párrafo numerado vacío antes de la cláusula TERCERA (desfasaba 1→2, 2→3…).
    xml = remove_empty_numbered_list_paragraphs(xml)

    return xml


def remove_empty_numbered_list_paragraphs(xml: str) -> str:
    def strip_para(match: re.Match[str]) -> str:
        para = match.group(0)
        if "<w:numPr>" not in para:
            return para
        text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", para)).strip()
        return "" if not text else para

    return re.sub(r"<w:p\b[^>]*>.*?</w:p>", strip_para, xml, flags=re.DOTALL)


def main() -> None:
    if not TEMPLATE.is_file():
        raise SystemExit(f"No existe la plantilla: {TEMPLATE}")

    with zipfile.ZipFile(TEMPLATE, "r") as zin:
        patched: dict[str, bytes] = {}
        for name in zin.namelist():
            data = zin.read(name)
            if name in XML_PARTS:
                text = data.decode("utf-8")
                text = patch_xml(text)
                data = text.encode("utf-8")
            patched[name] = data

    tmp = TEMPLATE.with_suffix(".docx.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in zin.namelist():
            zout.writestr(name, patched[name])
    tmp.replace(TEMPLATE)
    print(f"Plantilla corregida: {TEMPLATE}")


if __name__ == "__main__":
    main()
