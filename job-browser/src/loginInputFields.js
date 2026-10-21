// Only geometry and a closed keyboard hint leave the isolated HH browser.
async function readLoginInputFields(page) {
  return page.evaluate(() => {
    const fields = [];
    const nodes = document.querySelectorAll('input,textarea,[contenteditable="true"]');
    for (const node of nodes) {
      if (fields.length >= 20) break;
      if (node.disabled || node.readOnly || node.getAttribute('aria-disabled') === 'true') continue;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
      const tag = node.tagName.toLowerCase();
      const rawType = tag === 'input' ? node.type.toLowerCase() : 'text';
      if (tag === 'input' && !['text', 'password', 'email', 'tel', 'number', 'search', 'url'].includes(rawType)) continue;
      const rect = node.getBoundingClientRect();
      const x = Math.max(0, Math.min(1024, rect.x));
      const y = Math.max(0, Math.min(768, rect.y));
      const right = Math.max(0, Math.min(1024, rect.right));
      const bottom = Math.max(0, Math.min(768, rect.bottom));
      if (right - x < 4 || bottom - y < 4) continue;
      const inputMode = ['text', 'numeric', 'decimal', 'tel', 'email', 'url', 'search'].includes(node.inputMode) ? node.inputMode : 'text';
      fields.push({ x, y, width: right - x, height: bottom - y,
        type: ['password', 'email', 'tel', 'number', 'search', 'url'].includes(rawType) ? rawType : 'text',
        inputMode, multiline: tag === 'textarea' || node.isContentEditable });
    }
    return fields;
  });
}
module.exports = { readLoginInputFields };
