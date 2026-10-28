"""Copy a Word letterhead's header/footer parts into the embedded contract.

Usage: python tools/update-letterhead.py path/to/letterhead.docx
The contract body, fields, calculations, and body margins stay intact.
"""
from copy import deepcopy
from io import BytesIO
from pathlib import Path, PurePosixPath
import base64
import posixpath
import re
import sys
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as ET

ROOT = Path(__file__).resolve().parents[1]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"w": W, "r": R}


def xml(data):
    return ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True))


def serialize(root):
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)


def update(donor_path):
    target = ROOT / "dist/Шаблон рассрочки.docx"
    html_path = ROOT / "dist/Договор рассрочки.html"
    with ZipFile(target) as z:
        files = {name: z.read(name) for name in z.namelist()}
    donor = ZipFile(donor_path)
    document = xml(files["word/document.xml"])
    original_text = document.xpath("//w:t/text()", namespaces=NS)
    rels = xml(files["word/_rels/document.xml.rels"])
    types = xml(files["[Content_Types].xml"])
    styles = xml(files["word/styles.xml"])
    source_styles = xml(donor.read("word/styles.xml"))
    source_rels = xml(donor.read("word/_rels/document.xml.rels"))
    source_section = xml(donor.read("word/document.xml")).find(".//w:sectPr", NS)
    by_id = {r.get("Id"): r for r in source_rels}

    # Remove previous letterhead parts and assets, including obsolete addresses.
    for rel in list(rels):
        if rel.get("Type").rsplit("/", 1)[-1] in {"header", "footer"}:
            rels.remove(rel)
    for name in list(files):
        if re.match(r"word/(?:_rels/)?(?:header|footer)", name):
            del files[name]
    for entry in list(types):
        if re.match(r"/word/(?:header|footer)", entry.get("PartName", "")):
            types.remove(entry)
    for style in list(styles):
        if style.get(f"{{{W}}}styleId", "").startswith("letterhead_"):
            styles.remove(style)

    copied_styles = set()

    def copy_style(style_id):
        new_id = "letterhead_" + style_id
        if style_id in copied_styles:
            return new_id
        copied_styles.add(style_id)
        matches = source_styles.xpath("w:style[@w:styleId=$sid]", namespaces=NS, sid=style_id)
        if not matches:
            raise ValueError(f"Missing letterhead style: {style_id}")
        style = deepcopy(matches[0])
        style.set(f"{{{W}}}styleId", new_id)
        style.attrib.pop(f"{{{W}}}default", None)
        for ref in style:
            if ref.tag in {f"{{{W}}}{name}" for name in ["basedOn", "next", "link"]}:
                ref.set(f"{{{W}}}val", copy_style(ref.get(f"{{{W}}}val")))
        styles.append(style)
        return new_id

    references = []
    for index, source_ref in enumerate(source_section):
        if source_ref.tag not in {f"{{{W}}}headerReference", f"{{{W}}}footerReference"}:
            continue
        source_rel = by_id[source_ref.get(f"{{{R}}}id")]
        part = posixpath.normpath("word/" + source_rel.get("Target"))
        if not re.fullmatch(r"word/(header|footer)\d+\.xml", part):
            raise ValueError(f"Unsupported letterhead part: {part}")
        part_xml = xml(donor.read(part))
        for ref in part_xml.xpath("//w:pStyle | //w:rStyle", namespaces=NS):
            ref.set(f"{{{W}}}val", copy_style(ref.get(f"{{{W}}}val")))
        files[part] = serialize(part_xml)
        part_rels = f"word/_rels/{PurePosixPath(part).name}.rels"
        if part_rels in donor.namelist():
            relationships = xml(donor.read(part_rels))
            for rel in relationships:
                if rel.get("TargetMode") == "External":
                    raise ValueError("External letterhead resources are not supported")
                resource = posixpath.normpath(posixpath.join("word", rel.get("Target")))
                if not resource.startswith("word/media/"):
                    raise ValueError(f"Unsupported letterhead resource: {resource}")
                files[resource] = donor.read(resource)
            files[part_rels] = serialize(relationships)
        new_id = f"letterheadRel{index}"
        rel = ET.SubElement(rels, f"{{{PKG}}}Relationship", Id=new_id,
                            Type=source_rel.get("Type"), Target=PurePosixPath(part).name)
        ref = deepcopy(source_ref)
        ref.set(f"{{{R}}}id", new_id)
        references.append(ref)
        kind = "header" if source_ref.tag.endswith("headerReference") else "footer"
        ET.SubElement(types, f"{{{CT}}}Override", PartName="/" + part,
                      ContentType=f"application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml")

    for section in document.findall(".//w:sectPr", NS):
        for ref in list(section):
            if ref.tag in {f"{{{W}}}{name}" for name in ["headerReference", "footerReference", "titlePg"]}:
                section.remove(ref)
        for ref in reversed(references):
            section.insert(0, deepcopy(ref))
        # Retain body margins; use the new brand's header/footer distances.
        margins = section.find("w:pgMar", NS)
        donor_margins = source_section.find("w:pgMar", NS)
        for key in ["header", "footer"]:
            margins.set(f"{{{W}}}{key}", donor_margins.get(f"{{{W}}}{key}"))
        if source_section.find("w:titlePg", NS) is not None:
            title = ET.Element(f"{{{W}}}titlePg")
            grid = section.find("w:docGrid", NS)
            if grid is not None:
                grid.addprevious(title)
            else:
                section.append(title)
    settings = xml(files["word/settings.xml"])
    for element in settings.findall("w:evenAndOddHeaders", NS):
        settings.remove(element)
    assert document.xpath("//w:t/text()", namespaces=NS) == original_text
    files["word/document.xml"] = serialize(document)
    files["word/styles.xml"] = serialize(styles)
    files["word/settings.xml"] = serialize(settings)
    files["word/_rels/document.xml.rels"] = serialize(rels)
    files["[Content_Types].xml"] = serialize(types)
    # Discard only unused old pictures; never remove a resource used by the body.
    used_media = set()
    for name, data in files.items():
        if not name.endswith('.rels'):
            continue
        owner_dir = posixpath.dirname(posixpath.dirname(name))
        for relationship in xml(data):
            if relationship.get('TargetMode') != 'External':
                used_media.add(posixpath.normpath(posixpath.join(owner_dir, relationship.get('Target'))))
    for name in list(files):
        if name.startswith('word/media/') and name not in used_media:
            del files[name]
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    data = output.getvalue()
    html = html_path.read_text()
    html, count = re.subn(r'(<script type="application/octet-stream" id="embeddedTemplate">)[\s\S]*?(</script>)',
                          lambda m: m[1] + base64.b64encode(data).decode() + m[2], html, count=1)
    assert count == 1, "Embedded template not found"
    target.write_bytes(data)
    html_path.write_text(html)
    print(f"Updated Word and embedded template: {len(data):,} bytes")


if __name__ == "__main__":
    update(Path(sys.argv[1]))
