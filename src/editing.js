/* Keep a Word binding intact when Chrome replaces a multiline selection. */
(() => {
  function protectField(run) {
    if (run.parentElement?.dataset.fieldHost === 'true') return;
    const host = run.ownerDocument.createElement('span');
    host.dataset.fieldHost = 'true';
    host.contentEditable = 'false';
    // Do not introduce the renderer's default 12pt span font into a 9pt line.
    host.style.cssText = 'font:inherit;color:inherit;line-height:inherit';
    run.replaceWith(host);
    host.append(run);
    run.contentEditable = 'true';
  }
  window.ContractEditing = { protectField };
})();
