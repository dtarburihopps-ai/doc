"""Verify printed geometry, complete text, artwork and downloaded DOCX.
Run after: node tests/print-layout.cjs
"""
from pathlib import Path
from zipfile import ZipFile
import base64
import hashlib
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
    for page in result['pages']:
        for paragraph in page['paragraphs']:
            assert norm(paragraph) in text, (result['label'], paragraph)
    images = [im for page in doc for im in page.get_image_info()]
    assert images[0]['width'] == 670  # New original logo, not the old 558px logo.
    assert abs(images[0]['bbox'][2] - images[0]['bbox'][0] - 152.96) < .1
    for strip in images[1:]:
        assert strip['width'] in [2440, 2483]
        assert abs(strip['bbox'][2] - strip['bbox'][0] - 467.45) < .1
    spans = [s for page in doc for block in page.get_text('dict')['blocks'] if 'lines' in block
             for line in block['lines'] for s in line['spans']]
    assert any(abs(s['size'] - 9) < .01 for s in spans), 'No automatic print scaling'
    if result['label'].startswith('zoom-'):
        current = [(s['text'], s['bbox'], s['size']) for s in spans]
        if geometry is None:
            geometry = current
        assert geometry == current, 'Screen zoom/window width changed printed geometry'
    if result['label'] == 'twelve-months':
        assert len(doc) == 3
        for date in ['28.11.2027', '28.10.2028']:
            assert norm(date) in text
    if result['label'] == 'manual':
        assert '12400' in text and '12300' in text
    if result['label'] == 'empty':
        assert 'Попов' not in text and 'Тюмень' in text

shortcut = fitz.open(OUT / 'browser-shortcut.pdf')
assert len(shortcut) == len(results[-1]['pages'])
assert 'Исходный текст' not in ''.join(p.get_text() for p in shortcut)
assert len([im for page in shortcut for im in page.get_image_info()]) == 3

with ZipFile(ROOT / 'dist/Шаблон рассрочки.docx') as target, ZipFile(ROOT / 'assets/letterhead.docx') as source:
    document = ET.fromstring(target.read('word/document.xml'))
    body_text = ''.join(document.xpath('//w:t/text()', namespaces=NS))
    assert hashlib.sha256(body_text.encode()).hexdigest() == '0793a0965c8d8b1e8b1f4987c4f98c916884e62a9318490f3f40004f091b516d'
    for name in source.namelist():
        if name.startswith('word/media/'):
            assert source.read(name) == target.read(name), 'Original artwork must remain byte-identical'
        if re.fullmatch(r'word/(header|footer)\d+\.xml', name):
            def structure(node):
                attrs = [(key, val.removeprefix('letterhead_') if key.endswith('}val') else val)
                         for key, val in sorted(node.attrib.items())]
                return node.tag, attrs, node.text, [structure(child) for child in node]
            assert structure(ET.fromstring(source.read(name))) == structure(ET.fromstring(target.read(name))), 'Letterhead geometry changed'
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
    with ZipFile(ROOT / 'assets/letterhead.docx') as letterhead:
        assert z.read('word/media/image1.png') == letterhead.read('word/media/image1.png')

print('Verified: 7 print scenarios, identical A4 geometry at 4 zoom levels, no missing text,')
print('12-month schedule, manual edits in Word, native print shortcut, original artwork and contract text.')
