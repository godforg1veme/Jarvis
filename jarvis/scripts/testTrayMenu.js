const assert = require("assert");
const { buildTrayMenuTemplate } = require("../trayMenu");

function actionItems(template) {
  return template.filter((item) => item.type !== "separator");
}

const offTemplate = buildTrayMenuTemplate({
  isMicOn: false,
  showHologramWidget: false,
  showTranscriptionBar: false,
  onToggleMic: () => {},
  onToggleHologramWidget: () => {},
  onToggleTranscriptionBar: () => {},
  onQuit: () => {},
});

let items = actionItems(offTemplate);
assert.strictEqual(items.length, 4);
assert.strictEqual(items[0].label, "Включить микрофон");
assert.strictEqual(typeof items[0].click, "function");
assert.strictEqual(items[1].label, "3D-Компаньон (Голограмма)");
assert.strictEqual(items[1].type, "checkbox");
assert.strictEqual(items[1].checked, false);
assert.strictEqual(typeof items[1].click, "function");
assert.strictEqual(items[2].label, "Панель транскрипции");
assert.strictEqual(items[2].type, "checkbox");
assert.strictEqual(items[2].checked, false);
assert.strictEqual(typeof items[2].click, "function");
assert.strictEqual(items[3].label, "Закрыть Jarvis");
assert.strictEqual(typeof items[3].click, "function");

const onTemplate = buildTrayMenuTemplate({
  isMicOn: true,
  showHologramWidget: true,
  showTranscriptionBar: true,
  onToggleMic: () => {},
  onToggleHologramWidget: () => {},
  onToggleTranscriptionBar: () => {},
  onQuit: () => {},
});

items = actionItems(onTemplate);
assert.strictEqual(items.length, 4);
assert.strictEqual(items[0].label, "Выключить микрофон");
assert.strictEqual(items[1].label, "3D-Компаньон (Голограмма)");
assert.strictEqual(items[1].checked, true);
assert.strictEqual(items[2].label, "Панель транскрипции");
assert.strictEqual(items[2].checked, true);
assert.strictEqual(items[3].label, "Закрыть Jarvis");

console.log("[test] tray menu OK");

