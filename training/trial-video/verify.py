"""Verify the actual tutorial, downloaded DOCX, and recorded video frames."""
import hashlib
import json
import pathlib
import struct
import subprocess
import sys
import zipfile

from lxml import etree

root = pathlib.Path(__file__).resolve().parents[2]
work = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/trial-staff-video-final')
manifest = json.loads((root / 'training/trial-video/chapters.json').read_text())
source = root / 'dist/trial-wearing/Пробное ношение.html'
video = root / 'dist/trial-wearing/staff-walkthrough.mp4'
assert hashlib.sha256(source.read_bytes()).hexdigest() == manifest['appSha256']
fields = json.loads((work / 'final-state.json').read_text())['fields']
with zipfile.ZipFile(work / 'tutorial-trial.docx') as actual, zipfile.ZipFile(work / 'embedded-template.docx') as template:
    members = lambda z: {i.filename for i in z.infolist() if not i.is_dir()}
    assert members(actual) == members(template)
    changed = {n for n in members(actual) if actual.read(n) != template.read(n)}
    assert changed == {'word/document.xml'}, changed
    document = etree.fromstring(actual.read('word/document.xml'))
    text = ' '.join(document.xpath('//w:t/text()', namespaces={'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}))
    for key in ['surname', 'firstname', 'patronymic', 'specialist', 'product', 'total', 'deposit', 'passport', 'passportDate', 'phone', 'startDate', 'endDate', 'visitDate']:
        assert fields[key] in text, key
    for key in ['passportIssuer', 'address']:
        assert fields[key].split() == [word for word in fields[key].split() if word in text], key
    assert 'Москва' in text and '{{' not in text
    assert 'батарейки' not in text and 'футляр' not in text
    assert etree.tostring(document) == etree.tostring(etree.parse(str(work / 'final-word.xml')).getroot())

probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video)]))
stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
assert (stream['codec_name'], stream['pix_fmt'], stream['width'], stream['height']) == ('h264', 'yuv420p', 1920, 1080)
duration = float(probe['format']['duration'])
assert abs(duration - manifest['recording']['duration']) < 0.15
assert 40 < duration < 180
assert manifest['recording']['updates'] > 100
assert manifest['metrics']['maxAlignmentError'] < 0.1
assert manifest['metrics']['maxTipOverlap'] == 0
assert manifest['metrics']['cards'].count('Проверьте все данные!') == 1
assert manifest['checks']['settingsSurviveReload']
assert manifest['checks']['allFieldsFilled']
subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-f', 'null', '-'], check=True)
data = video.read_bytes()
atoms, offset = [], 0
while offset + 8 <= len(data):
    size, name = struct.unpack('>I4s', data[offset:offset + 8])
    if size == 1:
        size = struct.unpack('>Q', data[offset + 8:offset + 16])[0]
    if not size:
        size = len(data) - offset
    assert size >= 8
    atoms.append(name)
    offset += size
assert atoms.index(b'moov') < atoms.index(b'mdat')
for shot in manifest['shots']:
    target = work / ('video-' + shot['name'] + '.jpg')
    timestamp = min(shot['time'], duration - 0.1)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(timestamp), '-i', str(video), '-frames:v', '1', '-q:v', '2', str(target)], check=True)
print(json.dumps({'pass': True, 'duration': duration, 'bytes': len(data), 'control_frames': len(manifest['shots']), 'docx_template_preserved': True}, ensure_ascii=False))
