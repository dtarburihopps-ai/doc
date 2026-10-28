"""Sync the standalone print module and refresh the staff ZIP."""
from pathlib import Path
import re
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
html = root / 'dist/Договор рассрочки.html'
text = html.read_text()
text, count = re.subn(r'(<script id="contractPrint">)[\s\S]*?(</script>)',
                      lambda m: m[1] + '\n' + (root / 'src/print.js').read_text() + '\n' + m[2], text)
assert count == 1
text, count = re.subn(r'(<script id="contractEditing">)[\s\S]*?(</script>)',
                      lambda m: m[1] + '\n' + (root / 'src/editing.js').read_text() + '\n' + m[2], text)
assert count == 1
html.write_text(text)
with ZipFile(root / 'dist/contract-kit.zip', 'w', ZIP_DEFLATED, compresslevel=9) as z:
    for source, name in [('Договор рассрочки.html', 'Договор рассрочки.html'),
                         ('staff-guide.pdf', 'Инструкция для сотрудников.pdf'),
                         ('Как пользоваться.txt', 'Как пользоваться.txt')]:
        z.write(root / 'dist' / source, name)
print('Standalone HTML and staff ZIP updated')
