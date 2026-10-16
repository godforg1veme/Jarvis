export function sendText(rfb, text) {
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point < 32 || point === 127) continue;
    rfb.sendKey(point <= 255 ? point : (0x01000000 | point), null);
  }
}
export function bindKeyboard(input, getRfb) {
  let composing = false;
  const send = event => {
    const rfb = getRfb(); if (!rfb || composing || event.isComposing) return;
    if (event.inputType === 'deleteContentBackward') rfb.sendKey(0xff08, 'Backspace');
    else sendText(rfb, input.value);
    input.value = '';
  };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', event => { composing = false; send(event); });
  input.addEventListener('input', send);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); getRfb()?.sendKey(0xff0d, 'Enter'); }
    if (event.key === 'Backspace' && !input.value) { event.preventDefault(); getRfb()?.sendKey(0xff08, 'Backspace'); }
  });
}
