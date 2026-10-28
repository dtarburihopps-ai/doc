"""Use the approved full Word document as the layout, with blank input fields.

python tools/import-contract-template.py reference.docx
Copies all formatting/parts, only replaces editable text and clears author metadata.
"""
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as ET
import base64
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}


def parse(data):
    return ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True))


def dump(node):
    return ET.tostring(node, encoding='UTF-8', xml_declaration=True, standalone=True)


def text(node):
    return ''.join(node.xpath('.//w:t/text()', namespaces=NS))


def replace(node, pattern, value, expected=None):
    """Replace text spanning runs without changing run or paragraph properties."""
    parts = node.findall('.//w:t', NS)
    matches = list(re.finditer(pattern, text(node)))
    if expected is not None:
        assert len(matches) == expected, (pattern, text(node), expected)
    for match in reversed(matches):
        offset = 0
        inserted = False
        for part in parts:
            old = part.text or ''
            start, end = offset, offset + len(old)
            offset = end
            if start >= match.end() or end <= match.start():
                continue
            before = old[:max(0, match.start() - start)]
            after = old[max(0, match.end() - start):]
            part.text = before + ('' if inserted else value) + after
            part.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
            inserted = True
    return len(matches)


def replace_blanks(node, names):
    matches = list(re.finditer(r'_{5,}', text(node)))
    assert len(matches) >= len(names), (text(node), names)
    for index in range(len(matches) - 1, -1, -1):
        match = matches[index]
        name = names[index] if index < len(names) else ''
        value = '{{' + name + '}}' if name else ''
        if value and match.start() and not text(node)[match.start() - 1].isspace():
            value = ' ' + value
        # Match this one original span, even if runs split the underscores.
        pattern = r'(?<=\A[\s\S]{' + str(match.start()) + r'})_{' + str(match.end() - match.start()) + r'}'
        replace(node, pattern, value, 1)


def archive(files):
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    return output.getvalue()


def main(input_path):
    with ZipFile(input_path) as z:
        files = {name: z.read(name) for name in z.namelist()}
    document = parse(files['word/document.xml'])
    body = document.find('w:body', NS)
    paragraphs = list(body.findall('w:p', NS))
    date_paragraphs = [p for p in paragraphs if re.search(r'г\.\s*(?:Москва|Сочи)', text(p))]
    assert len(date_paragraphs) == 2
    for p in date_paragraphs:
        replace(p, r'Москва|Сочи', 'Сочи', 1)
        # Keep the application's existing default year; users can change it in Settings.
        replace(p, r'202[56](?=\s*г\.)', '2026', 1)
    # The reusable reference contains no customer data or author metadata.
    if 'docProps/core.xml' in files:
        core = parse(files['docProps/core.xml'])
        for node in core:
            if ET.QName(node).localname in ['creator', 'lastModifiedBy', 'title', 'subject', 'description', 'keywords']:
                node.text = ''
        files['docProps/core.xml'] = dump(core)
    files['word/document.xml'] = dump(document)
    reference = ROOT / 'assets/contract-layout.docx'
    reference.write_bytes(archive(files))

    for p in date_paragraphs:
        replace(p, r'«_+»\s*_+', '«{{ДЕНЬ}}» {{МЕСЯЦ}}', 1)
    for p in paragraphs:
        value = text(p)
        if value.lstrip().startswith('гр.') or 'нижеподписавшиеся' in value:
            replace_blanks(p, ['ФИО'])
        elif 'Продавец обязуется передать' in value or 'Продавцом передан' in value:
            replace_blanks(p, ['ТОВАР'])
        elif 'Стоимость товара' in value:
            replace_blanks(p, ['СТОИМОСТЬ'])
        elif 'В момент заключения' in value:
            replace_blanks(p, ['ВЗНОС', 'ОСТАТОК'])
            replace(p, r'тр[её]х\s+календарных\s+месяцев', '{{СРОК}}', 1)
    for cell in body.findall('.//w:tc', NS):
        if not text(cell).startswith('Фамилия'):
            continue
        for p in cell.findall('w:p', NS):
            # Several lines in the supplied Word are one paragraph with w:br.
            for prefix, name in [
                ('Фамилия', 'ФАМИЛИЯ'), ('Имя', 'ИМЯ'), ('Отчество', 'ОТЧЕСТВО'),
                ('Паспорт', 'ПАСПОРТ'), ('выдан', 'ДАТА_ПАСПОРТА'), ('Кем', 'КЕМ_ВЫДАН'),
                ('Адрес места жительства:', 'АДРЕС'), ('Телефон:', 'ТЕЛЕФОН')
            ]:
                match = re.search(re.escape(prefix) + r'\s*(_{5,})', text(p))
                if match:
                    start, end = match.span(1)
                    value = '{{' + name + '}}'
                    if start and not text(p)[start - 1].isspace():
                        value = ' ' + value
                    replace(p, r'(?<=\A[\s\S]{' + str(start) + r'})_{' + str(end - start) + r'}', value, 1)
            for match in reversed(list(re.finditer(r'_{5,}', text(p)))):
                if re.search(r'Подпись\s*$', text(p)[:match.start()]):
                    continue
                replace(p, r'(?<=\A[\s\S]{' + str(match.start()) + r'})_{' + str(match.end() - match.start()) + r'}', '', 1)
    # Every editable field must be a binding, never an existing client's value.
    required = ['ФИО', 'ТОВАР', 'СТОИМОСТЬ', 'ВЗНОС', 'ОСТАТОК', 'СРОК', 'ДЕНЬ', 'МЕСЯЦ',
                'ФАМИЛИЯ', 'ИМЯ', 'ОТЧЕСТВО', 'ПАСПОРТ', 'ДАТА_ПАСПОРТА', 'КЕМ_ВЫДАН', 'АДРЕС', 'ТЕЛЕФОН']
    for name in required:
        assert '{{' + name + '}}' in text(document), name
    files['word/document.xml'] = dump(document)
    data = archive(files)
    (ROOT / 'dist/Шаблон рассрочки.docx').write_bytes(data)
    html = ROOT / 'dist/Договор рассрочки.html'
    value, count = re.subn(r'(<script type="application/octet-stream" id="embeddedTemplate">)[\s\S]*?(</script>)',
                           lambda m: m[1] + base64.b64encode(data).decode() + m[2], html.read_text(), count=1)
    assert count == 1
    html.write_text(value)
    print('Imported full approved layout, Sochi default, blank customer fields:', len(data), 'bytes')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
