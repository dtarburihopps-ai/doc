/* Print the document in its own A4 frame, independently of the editor's zoom,
   columns, window width and scroll position. No network or external assets. */
(() => {
  const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const pageMarker = '{{CONTRACT_PAGE_FIELD}}';

  async function prepareWordFields(archive) {
    // Work only on the temporary ZIP used by docx-preview. The original DOCX
    // retains actual Word fields, cached results and header/footer references.
    for (const name of Object.keys(archive.files)) {
      if (!/^word\/(?:header|footer)\d+\.xml$/.test(name)) continue;
      const xml = new DOMParser().parseFromString(await archive.file(name).async('string'), 'application/xml');
      let changed = false;
      for (const field of [...xml.getElementsByTagNameNS(wordNamespace, 'fldSimple')]) {
        if (!/^\s*PAGE(?:\s|$)/i.test(field.getAttributeNS(wordNamespace, 'instr') || '')) continue;
        const run = xml.createElementNS(wordNamespace, 'w:r');
        const props = field.getElementsByTagNameNS(wordNamespace, 'rPr')[0];
        if (props) run.append(props.cloneNode(true));
        const text = xml.createElementNS(wordNamespace, 'w:t');
        text.textContent = pageMarker;
        run.append(text);
        field.replaceWith(run);
        changed = true;
      }
      // Also support PAGE fields stored as begin / instruction / separator /
      // cached result / end runs (including fields inside content controls).
      for (const paragraph of xml.getElementsByTagNameNS(wordNamespace, 'p')) {
        let field = null;
        for (const run of [...paragraph.children]) {
          if (run.localName !== 'r') continue;
          const char = run.getElementsByTagNameNS(wordNamespace, 'fldChar')[0];
          const type = char?.getAttributeNS(wordNamespace, 'fldCharType');
          if (type === 'begin') field = { instruction: '', result: [], separated: false };
          if (!field) continue;
          if (type === 'separate') field.separated = true;
          if (!field.separated) {
            for (const text of run.getElementsByTagNameNS(wordNamespace, 'instrText')) field.instruction += text.textContent;
          } else {
            field.result.push(...run.getElementsByTagNameNS(wordNamespace, 't'));
          }
          if (type === 'end') {
            if (/^\s*PAGE(?:\s|$)/i.test(field.instruction) && field.result.length) {
              field.result.forEach((text, index) => { text.textContent = index ? '' : pageMarker; });
              changed = true;
            }
            field = null;
          }
        }
      }
      if (changed) archive.file(name, new XMLSerializer().serializeToString(xml));
    }
  }
  function normalizeXml(documentXml, settingsXml) {
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const even = settingsXml.getElementsByTagNameNS(ns, 'evenAndOddHeaders')[0];
    const enabled = even && !['0', 'false', 'off'].includes(even.getAttributeNS(ns, 'val'));
    if (!enabled) {
      // Word ignores dormant even-page parts when this setting is off.
      // Apply this only to the temporary browser rendering copy.
      for (const tag of ['headerReference', 'footerReference']) {
        for (const ref of [...documentXml.getElementsByTagNameNS(ns, tag)]) {
          if (ref.getAttributeNS(ns, 'type') === 'even') ref.remove();
        }
      }
    }
  }
  function normalizeDocument(root, sourceXml) {
    // Use standard images with the Word shape's exact dimensions in Chromium's
    // frame-printing path. Decode them before opening the print dialog.
    // This avoids VML -> SVG image loading/printing problems without redrawing
    // or changing a single pixel of the supplied artwork.
    for (const svg of root.querySelectorAll('svg')) {
      if (svg.children.length !== 1 || svg.firstElementChild.localName !== 'image') continue;
      const source = svg.firstElementChild.getAttribute('href');
      if (!source) continue;
      const image = root.ownerDocument.createElement('img');
      image.alt = '';
      image.src = source.replace(/^data:application\/octet-stream;base64,iVBOR/, 'data:image/png;base64,iVBOR')
        .replace(/^data:application\/octet-stream;base64,\/9j\//, 'data:image/jpeg;base64,/9j/');
      image.style.cssText = svg.style.cssText;
      image.style.objectFit = 'fill';
      image.dataset.wordDrawing = 'true';
      svg.replaceWith(image);
    }
    const startElement = sourceXml.getElementsByTagNameNS(wordNamespace, 'pgNumType')[0];
    const start = Number(startElement?.getAttributeNS(wordNamespace, 'start') || 1);
    [...root.querySelectorAll('section.docx')].forEach((page, index) => {
      for (const region of page.querySelectorAll('header, footer')) {
        const walker = root.ownerDocument.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        const fields = [];
        while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(pageMarker)) fields.push(walker.currentNode);
        for (const text of fields) {
          const field = root.ownerDocument.createElement('span');
          field.dataset.wordField = 'PAGE';
          field.textContent = String(start + index);
          text.replaceWith(field);
        }
      }
    });
    // docx-preview omits Word's table indentation. The signature table has a
    // negative indent; without it, its right edge exceeds A4 and Chromium
    // scales the entire document down to fit the overflow.
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const sources = [...sourceXml.getElementsByTagNameNS(ns, 'tbl')];
    [...root.querySelectorAll('article table')].forEach((table, index) => {
      const props = [...(sources[index]?.children || [])].find(p => p.localName === 'tblPr');
      if (!props) return;
      const indent = props.getElementsByTagNameNS(ns, 'tblInd')[0];
      if (indent) table.style.marginInlineStart = `${Number(indent.getAttributeNS(ns, 'w')) / 20}pt`;
      const layout = props.getElementsByTagNameNS(ns, 'tblLayout')[0];
      if (layout?.getAttributeNS(ns, 'type') === 'fixed') table.style.tableLayout = 'fixed';
      const cells = [...sources[index].getElementsByTagNameNS(ns, 'tc')];
      [...table.querySelectorAll('td, th')].forEach((cell, cellIndex) => {
        const direction = cells[cellIndex]?.getElementsByTagNameNS(ns, 'textDirection')[0];
        if (direction?.getAttributeNS(ns, 'val') === 'lrTb') {
          // lrTb is Word's ordinary left-to-right horizontal text. The bundled
          // renderer incorrectly maps that explicit value to vertical-lr.
          cell.style.writingMode = 'horizontal-tb';
          cell.style.transform = 'none';
        }
      });
    });
  }
  const css = `
    @page { size: A4 portrait; margin: 0; }
    html, body { width: 210mm; margin: 0; padding: 0; background: white; }
    * { box-sizing: border-box; }
    .docx-wrapper { display: block; background: white; padding: 0; margin: 0; }
    .docx-wrapper > section.docx {
      box-sizing: border-box; width: 210mm !important;
      height: 297mm !important; min-height: 297mm !important;
      margin: 0 !important;
      box-shadow: none !important; position: relative;
      break-after: page; page-break-after: always;
      overflow: visible;
    }
    .docx-wrapper > section.docx:last-child {
      break-after: auto; page-break-after: auto;
    }
    section.docx > header, section.docx > footer,
    section.docx > article { flex-shrink: 0; }
    .docx { line-height: normal; }
    .docx p { min-height: 1em; }
    .docx [data-bind] { background: transparent; box-shadow: none; color: inherit; }
    .docx p { outline: none; }
    .docx tr { break-inside: avoid; }
    .docx { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  `;

  async function prepare() {
    const wrapper = document.querySelector('#preview .docx-wrapper');
    if (!wrapper) throw Error('Договор ещё загружается. Повторите печать через несколько секунд.');
    document.getElementById('contractPrintFrame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'contractPrintFrame';
    frame.title = 'Печать договора — A4';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:210mm;height:297mm;border:0;';
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Договор рассрочки</title></head><body></body></html>');
    doc.close();
    for (const style of document.querySelectorAll('#docStyles style')) {
      doc.head.append(doc.importNode(style, true));
    }
    const style = doc.createElement('style');
    style.textContent = css;
    doc.head.append(style);
    const content = doc.importNode(wrapper, true);
    for (const node of content.querySelectorAll('[contenteditable]')) {
      node.removeAttribute('contenteditable');
      node.removeAttribute('tabindex');
    }
    doc.body.append(content);
    await doc.fonts.ready;
    await Promise.all([...doc.images].map(img => img.decode()));
    await new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => {
      frame.contentWindow.requestAnimationFrame(resolve);
    }));
    return frame;
  }

  async function run() {
    const frame = await prepare();
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
  window.ContractPrint = { prepare, run, normalizeDocument, normalizeXml, prepareWordFields };
})();
