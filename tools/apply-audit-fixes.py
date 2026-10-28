"""Apply the audited fixes to the legacy standalone bundle, preserving its Word.

Each replacement accepts either the exact old code or the already fixed code.
The assertions stop the update if a different application version is supplied.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
file = root / 'dist/Договор рассрочки.html'
html = file.read_text()


def patch(old, new, count=1):
    global html
    if new in html:
        assert html.count(new) == count, new[:80]
    elif old in html:
        assert html.count(old) == count, old[:80]
        html = html.replace(old, new)
    else:
        raise AssertionError(old[:80])


# A rounded regular instalment must leave a positive last instalment. Prefer
# a lower multiple of 100 before falling back to whole rubles for tiny balances.
patch('i=s>0&&s*(t-1)<=a?s:Math.floor(a/t)',
      'i=s>0&&s*(t-1)<a?s:Math.floor(a/t/100)>0?Math.floor(a/t/100)*100:Math.floor(a/t)')

# Read the amount, not a following month/quantity. In an explicit calculation,
# the first number after the last equals sign is the stated final amount.
patch('function nn(n,e,t){let r=Array.from(n.matchAll(new RegExp(ye,"g")));return r.length?pr(r.at(-1)[0],e,t):null}',
      'function nn(n,e,t){let r=String(n).split("=").at(-1).match(new RegExp(ye));return r?pr(r[0],e,t):null}')

patch(r'/^[А-ЯЁA-Z]\.?$/i.test(r)',
      r'/^(?:[А-ЯЁA-Z]\.?|[А-ЯЁA-Z]\.[А-ЯЁA-Z]\.?)$/i.test(r)')

# Choose a passport-related line that actually contains the issue date.
patch(r'R=t.find(y=>/(?:дата выдачи|паспорт выдан|когда выдан)/i.test(y))||C||D',
      r'R=[t.find(y=>/(?:дата выдачи|паспорт выдан|когда выдан)/i.test(y)),C,D].find(y=>y&&/\d{1,2}\.\d{1,2}\.\d{4}/.test(y))')

# Replacing textContent on the paragraph currently being edited destroys the
# caret, notably when Chrome inserts a trailing nonbreaking space. Keep its DOM
# until blur; update the source XML, form fields and other occurrences as usual.
patch('h.textContent!==s&&(h.textContent=s),h.classList.toggle("manual",ct.has(r))',
      '!(document.activeElement?.isContentEditable&&document.activeElement.contains(h))&&h.textContent!==s&&(h.textContent=s),h.classList.toggle("manual",ct.has(r))')

# A nested editing host keeps the binding span in place when selected content
# contains line breaks. The enclosing paragraph remains editable as before.
patch('a.dataset.bind=i,a.title=Jt[i]',
      'a.dataset.bind=i,window.ContractEditing.protectField(a),a.title=Jt[i]')

# A delayed refresh from the form must not replace a paragraph while the user
# pauses during preview typing. Blur already requests a fresh preview afterward.
patch('O("preview").addEventListener("input",n=>{',
      'O("preview").addEventListener("focusin",()=>clearTimeout(Cr));O("preview").addEventListener("input",n=>{')
patch('if(n!==xe){ke=!0;return}Ma(h)',
      'if(O("preview").contains(document.activeElement)&&document.activeElement.isContentEditable){ke=!1;return}if(n!==xe){ke=!0;return}Ma(h)')

# Chrome adds a terminal <br> inside multiline editing hosts. Form values use
# the same trimmed boundaries as the Word value, retaining internal line breaks.
patch('O(u).value=ct.get(u),ct.delete(u),jt(u,!0)',
      'O(u).value=ct.get(u).trim(),ct.delete(u),jt(u,!0)')

patch('["fullName","surname","firstname","product","total","contractDate"])O(i).value.trim()',
      '["fullName","surname","firstname","product","total","downPayment","contractDate"])O(i).value.trim()')

patch('let a=0,s=!0;for(let i=0;i<n.rows.length;i++){let h=',
      'n.rows.some(i=>i.amount===0)&&n.total>n.pv&&e.push("В графике есть нулевые платежи. Проверьте срок и остаток.");let a=0,s=!0;for(let i=0;i<n.rows.length;i++){let h=')

# Recognising a name-only note must not silently turn a manually entered deposit
# back into automatic 50% mode.
old = r'Wt=!n.sources.downPayment||n.sources.downPayment.startsWith("\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D\u043E:")'
new = r'Wt=n.sources.downPayment?n.sources.downPayment.startsWith("\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D\u043E:"):Wt'
patch(old, new)

# Common payment headings are not customer names.
patch(r'&&!/^(правое|левое|серийный|наша|первый|в подарок|кем выдан|дата договора)/i.test(y)),f=',
      r'&&!/^(правое|левое|серийный|наша|первый|в подарок|кем выдан|дата договора)/i.test(y)&&!/^(?:оплата|оплачено|рассрочка|внутренняя|первоначальный|итого|сумма|подарок|дополнительно)(?:\s|:|$)/i.test(y)),f=')


def escaped(text):
    return ''.join(f'\\u{ord(char):04X}' if ord(char) > 127 else char for char in text)


# The product no longer has a browser Print button; status messages must explain
# the existing Word download workflow consistently.
patch(escaped('Печать и скачивание доступны.'), 'Скачивание доступно.', 2)
patch('"' + escaped('Правки в предпросмотре попадут в печать и DOCX.') + '"',
      '"Правки в предпросмотре попадут в скачанный документ."')
patch('`' + escaped('Ручные правки: ${Ot}. Они сохраняются в печати и DOCX.') + '`',
      '`Ручные правки: ${Ot}. Они сохраняются в скачанном Word.`')
if 'id="contractEditing"' not in html:
    assert html.count('<script>') == 1
    html = html.replace('<script>', '<script id="contractEditing">\n' + (root/'src/editing.js').read_text() + '\n</script>\n<script>', 1)
file.write_text(html)
print('Applied audit fixes; embedded Word template is unchanged')
