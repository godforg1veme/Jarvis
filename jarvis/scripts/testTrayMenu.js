const assert = require("assert");
const { buildTrayMenuTemplate } = require("../trayMenu");

function actionItems(template) {
  return template.filter((item) => item.type !== "separator");
}

const offTemplate = buildTrayMenuTemplate({
  isMicOn: false,
  onToggleMic: () => {},
  onQuit: () => {},
});

let items = actionItems(offTemplate);
assert.strictEqual(items.length, 2);
assert.strictEqual(items[0].label, "Включить микрофон");
assert.strictEqual(typeof items[0].click, "function");
assert.strictEqual(items[1].label, "Закрыть Jarvis");
assert.strictEqual(typeof items[1].click, "function");

const onTemplate = buildTrayMenuTemplate({
  isMicOn: true,
  onToggleMic: () => {},
  onQuit: () => {},
});

items = actionItems(onTemplate);
assert.strictEqual(items.length, 2);
assert.strictEqual(items[0].label, "Выключить микрофон");
assert.strictEqual(items[1].label, "Закрыть Jarvis");

console.log("[test] tray menu OK");
