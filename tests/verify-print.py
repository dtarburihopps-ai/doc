"""Verify printed geometry, complete text, artwork and downloaded DOCX.
Run after: node tests/print-layout.cjs
"""
from pathlib import Path
from zipfile import ZipFile
import base64
import json
import posixpath
import re
import fitz
from lxml import etree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/tmp/contract-print-check')
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def norm(text):
    return re.sub(r'\s+|\u00ad|\u200b', '', text)


results = json.loads((OUT / 'results.json').read_text())
geometry = None
for result in results:
    doc = fitz.open(OUT / (result['label'] + '.pdf'))
    assert len(doc) == len(result['pages']), result['label']
    text = norm(''.join(page.get_text() for page in doc))
    for page in doc:
        assert abs(page.rect.width * 25.4 / 72 - 210) < .2
        assert abs(page.rect.height * 25.4 / 72 - 297) < .2
    for page_index, page in enumerate(result['pages']):
        this_sheet = norm(doc[page_index].get_text())
        for paragraph in page['paragraphs']:
            assert norm(paragraph) in this_sheet, (result['label'], page_index+1, 'Text moved to another sheet', paragraph)
    images = [im for page in doc for im in page.get_image_info()]
    assert images[0]['width'] == 670  # New original logo, not the old 558px logo.
    assert abs(images[0]['bbox'][2] - images[0]['bbox'][0] - 152.96) < .1
    assert len(images) == len(doc) + 1, 'Logo plus a visible strip on every printed page'
    for strip in images[1:]:
        assert strip['width'] in [2440, 2483]
        # Chromium rounds HTML image paint bounds to physical pixels; the DOM
        # test above verifies the exact Word shape dimensions before printing.
        assert abs(strip['bbox'][2] - strip['bbox'][0] - 467.45) < .76
    for index, page in enumerate(doc):
        if index:
            footer_text = page.get_text(clip=fitz.Rect(0, 740, page.rect.width, page.rect.height))
            assert str(index+1) in footer_text.split(), 'Automatic page number is missing'
            footer_spans = [s for block in page.get_text('dict')['blocks'] for line in block.get('lines',[])
                            for s in line['spans'] if s['text'] == str(index+1) and s['bbox'][1] > 740]
            assert len(footer_spans) == 1
            assert abs(footer_spans[0]['size'] - 12) < .01
            assert footer_spans[0]['color'] == 0x000000, 'Page number must be black'
            assert any(name in footer_spans[0]['font'].lower() for name in ['sans', 'arial', 'twcen']), 'Unavailable Office fonts must have a sans-serif fallback'
    spans = [s for page in doc for block in page.get_text('dict')['blocks'] if 'lines' in block
             for line in block['lines'] for s in line['spans']]
    assert any(abs(s['size'] - 9) < .01 for s in spans), 'No automatic print scaling'
    if result['label'].startswith('zoom-'):
        current = [(s['text'], s['bbox'], s['size']) for s in spans]
        if geometry is None:
            geometry = current
        assert geometry == current, 'Screen zoom/window width changed printed geometry'
        title = next(s for s in spans if s['text'] == 'Договор рассрочки')
        assert abs(title['bbox'][1] - 97.45) < 1, 'First-page text moved below the approved layout'
    if result['label'] == 'twelve-months':
        for date in ['28.11.2027', '28.10.2028']:
            assert norm(date) in text
    if result['label'] == 'manual':
        assert '12400' in text and '12300' in text
    if result['label'] == 'empty':
        assert 'Попов' not in text and 'Тюмень' in text

shortcut = fitz.open(OUT / 'browser-shortcut.pdf')
assert len(shortcut) == len(results[-1]['pages'])
for index, expected in enumerate(results[-1]['pages']):
    printed = norm(shortcut[index].get_text())
    for paragraph in expected['paragraphs']:
        assert norm(paragraph) in printed, 'Main-document printing moved text onto another sheet'
assert 'Исходный текст' not in ''.join(p.get_text() for p in shortcut)
assert len([im for page in shortcut for im in page.get_image_info()]) == 3

with ZipFile(ROOT / 'dist/Шаблон рассрочки.docx') as target, ZipFile(ROOT / 'assets/contract-layout.docx') as source:
    document = ET.fromstring(target.read('word/document.xml'))
    reference = ET.fromstring(source.read('word/document.xml'))
    body_text = ''.join(document.xpath('//w:t/text()', namespaces=NS))
    def fixed_text(value):
        value = re.sub(r'\{\{[^{}]+\}\}|_+|тр[её]х\s+календарных\s+месяцев', '', value)
        return norm(value)
    assert fixed_text(body_text) == fixed_text(''.join(reference.xpath('//w:t/text()', namespaces=NS)))
    # Preserve the approved document's margins, paragraph/run properties, tables,
    # fonts, numbering, and every header/footer instead of importing artwork alone.
    for selector in ['.//w:pPr', './/w:rPr', './/w:tblPr', './/w:tcPr', './/w:sectPr']:
        assert [ET.tostring(n, method='c14n') for n in document.findall(selector, NS)] == [ET.tostring(n, method='c14n') for n in reference.findall(selector, NS)], selector
    assert 'Сочи' in body_text and 'Москва' not in body_text
    core = ET.fromstring(target.read('docProps/core.xml'))
    assert not core.xpath('//*[local-name()="creator" or local-name()="lastModifiedBy"]/text()')
    for name in source.namelist():
        if name.startswith('word/media/'):
            assert source.read(name) == target.read(name), 'Original artwork must remain byte-identical'
        if re.fullmatch(r'word/(header|footer)\d+\.xml', name):
            assert source.read(name) == target.read(name), 'Letterhead geometry changed'
        if name not in ['word/document.xml', 'docProps/core.xml']:
            assert source.read(name) == target.read(name), name
    assert len([n for n in target.namelist() if n.startswith('word/media/')]) == 3
    for name in target.namelist():
        if name.endswith('.rels'):
            owner_dir = posixpath.dirname(posixpath.dirname(name))
            for rel in ET.fromstring(target.read(name)):
                if rel.get('TargetMode') != 'External':
                    assert posixpath.normpath(posixpath.join(owner_dir, rel.get('Target'))) in target.namelist(), name
    embedded = re.search(r'id="embeddedTemplate">([\s\S]*?)</script>', (ROOT / 'dist/Договор рассрочки.html').read_text())[1]
    assert base64.b64decode(embedded) == (ROOT / 'dist/Шаблон рассрочки.docx').read_bytes()

with ZipFile(OUT / 'filled.docx') as z:
    doc = ET.fromstring(z.read('word/document.xml'))
    rows = doc.findall('.//w:tbl', NS)[0].findall('w:tr', NS)
    values = [''.join(row.xpath('.//w:t/text()', namespaces=NS)) for row in rows]
    assert '12 400' in values[1] and '12 300' in values[3], values
    assert 'Тюмень' in ''.join(doc.xpath('//w:t/text()', namespaces=NS))
    with ZipFile(ROOT / 'assets/contract-layout.docx') as letterhead:
        assert z.read('word/media/image2.png') == letterhead.read('word/media/image2.png')
        assert z.read('word/footer1.xml') == letterhead.read('word/footer1.xml')
    footer = ET.fromstring(z.read('word/footer1.xml'))
    assert footer.xpath('//w:fldSimple[starts-with(@w:instr,"PAGE")]', namespaces=NS), 'Downloaded Word must keep its actual PAGE field'

print(f'Verified: {len(results)} print scenarios, identical A4 geometry at 4 zoom levels, no missing text,')
print('Each paragraph stays on its preview sheet, visible footer strips, black sans-serif PAGE 2/3, unchanged Word.')
