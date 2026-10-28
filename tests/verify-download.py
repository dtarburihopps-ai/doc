from pathlib import Path
from zipfile import ZipFile
from lxml import etree as ET
import base64
import re

root=Path(__file__).resolve().parents[1]
out=Path('/tmp/contract-download-check')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with ZipFile(root/'dist/Шаблон рассрочки.docx') as template:
    for name in ['empty.docx','filled.docx','twelve-months.docx']:
        with ZipFile(out/name) as doc:
            assert doc.testzip() is None
            for part in template.namelist():
                if part not in ['word/document.xml','word/settings.xml']:
                    assert template.read(part)==doc.read(part), (name,part)
            xml=ET.fromstring(doc.read('word/document.xml'))
            text=''.join(xml.xpath('//w:t/text()',namespaces=ns))
            assert 'Сочи' in text
            if name=='empty.docx':
                assert 'Попов' not in text
            else:
                for value in ['Попов Владимир Геннадьевич','Terra BTE-SP','74 000','37 000','0000 123456','Учебный отдел выдачи документов','Учебная улица']:
                    assert value in text,(name,value)
                rows=xml.findall('.//w:tbl',ns)[0].findall('w:tr',ns)
                values=[''.join(r.xpath('.//w:t/text()',namespaces=ns))for r in rows]
                if name=='filled.docx':
                    assert '12 400' in values[1] and '12 300' in values[3]
                    assert 'трех календарных месяцев' in text or 'трёх календарных месяцев' in text
                else:
                    assert len(rows)==13
                    assert 'двенадцати календарных месяцев' in text
                    assert '28.10.2027' in text
            footer=ET.fromstring(doc.read('word/footer1.xml'))
            assert footer.xpath('//w:fldSimple[starts-with(@w:instr,"PAGE")]',namespaces=ns)
html=(root/'dist/Договор рассрочки.html').read_text()
embedded=re.search(r'id="embeddedTemplate">([\s\S]*?)</script>',html)[1]
assert base64.b64decode(embedded)==(root/'dist/Шаблон рассрочки.docx').read_bytes()
print('Verified exported Word fields, manual edits, 12-month calendar, original artwork/styles/footers and embedded template')
