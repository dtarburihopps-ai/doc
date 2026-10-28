"""Compare every field visible during UI testing with the downloaded Word."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as ET
import json,re,hashlib

root=Path(__file__).resolve().parents[1]
out=Path('/tmp/contract-audit')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
normalize=lambda text: re.sub(r'\s+', '', str(text))
terms=['одного','двух','трех','четырех','пяти','шести','семи','восьми','девяти','десяти','одиннадцати','двенадцати']
months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
checks=0
with ZipFile(root/'dist/Шаблон рассрочки.docx')as source:
 for item in json.loads((out/'downloads.json').read_text()):
  with ZipFile(out/item['name'])as z:
   assert z.testzip() is None
   for part in source.namelist():
    if part not in ['word/document.xml','word/settings.xml']:
     assert z.read(part)==source.read(part),(item['name'],part)
     checks+=1
   doc=ET.fromstring(z.read('word/document.xml'));text=''.join(doc.xpath('//w:t/text()',namespaces=ns));flat=normalize(text)
   state=item['state'];fields=state['fields']
   for key,value in fields.items():
    if key in ['months','contractDate']or not value.strip():continue
    assert normalize(value)in flat,(item['name'],key,value)
    checks+=1
   for key,value in state['manual'].items():
    if value.strip():
     assert normalize(value)in flat,(item['name'],key,value)
     checks+=1
   for p in doc.findall('./w:body/w:p',ns):
    value=''.join(p.xpath('.//w:t/text()',namespaces=ns))
    if value.strip().startswith('г.'):
     assert state['city']in value and str(state['templateYear'])in value
     checks+=1
   n=int(fields['months']);term=terms[n-1]+(' календарного месяца'if n==1 else' календарных месяцев')
   assert normalize(term)in flat
   checks+=1
   if fields['contractDate']:
    day,month,year=map(int,fields['contractDate'].split('.'));date='«'+str(day).zfill(2)+'»'+months[month-1]+str(state['templateYear'])+'г.'
    assert normalize(date)in flat,(item['name'],date)
    checks+=1
   footer=ET.fromstring(z.read('word/footer1.xml'))
   assert footer.xpath('//w:fldSimple[starts-with(@w:instr,"PAGE")]',namespaces=ns)
   if item['name']=='cleared.docx':
    assert 'Семёнова'not in text and 'Иванова-Ёлкина'not in text and '222-33-44'not in text
   if item['name']=='all-fields.docx':
    assert doc.findall('.//w:br',ns),'Multiline fields must preserve their line breaks'
   if item['name']=='legal-edit.docx':
    assert 'Учебная редакция пункта для проверки ручного ввода.'in text
   if item['name']=='legal-cleared.docx':
    assert 'Учебная редакция пункта'not in text
   if item['name']=='positive-rounding.docx':
    rows=doc.findall('.//w:tbl',ns)[0].findall('w:tr',ns)[1:]
    amounts=[int(normalize(''.join(row.findall('w:tc',ns)[1].xpath('.//w:t/text()',namespaces=ns))))for row in rows]
    assert len(amounts)==11 and all(a>0 for a in amounts)and sum(amounts)==5000
assert hashlib.sha256((root/'dist/Шаблон рассрочки.docx').read_bytes()).hexdigest()=='c1229f0fbc66ad616c0a5d67a51516ce5137f8d30ff6f95b94e05940a24515bf'
print(f'Passed {checks} Word checks across UI exports: all entered fields, manual values, original styles/images/footers; template unchanged')
