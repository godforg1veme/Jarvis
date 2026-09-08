function buildTrayMenuTemplate({
  isMicOn,
  showHologramWidget,
  showTranscriptionBar,
  onToggleMic,
  onToggleHologramWidget,
  onToggleTranscriptionBar,
  onQuit
}) {
  return [
    {
      label: isMicOn ? "Выключить микрофон" : "Включить микрофон",
      click: onToggleMic,
    },
    {
      label: "3D-Компаньон (Голограмма)",
      type: "checkbox",
      checked: showHologramWidget !== false,
      click: (item) => onToggleHologramWidget && onToggleHologramWidget(item.checked),
    },
    {
      label: "Панель транскрипции",
      type: "checkbox",
      checked: showTranscriptionBar,
      click: (item) => onToggleTranscriptionBar(item.checked),
    },
    { type: "separator" },
    {
      label: "Закрыть Jarvis",
      click: onQuit,
    },
  ];
}

module.exports = { buildTrayMenuTemplate };
