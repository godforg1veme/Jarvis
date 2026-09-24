function buildTrayMenuTemplate({
  isMicOn,
  showHologramWidget,
  showTranscriptionBar,
  visionActive,
  onToggleMic,
  onToggleHologramWidget,
  onToggleTranscriptionBar,
  onStopVision,
  onOpenLifeOs,
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
    {
      label: visionActive ? "Зрение активно — STOP" : "Зрение выключено",
      enabled: visionActive === true,
      click: onStopVision,
    },
    {
      label: "Life OS · Mission Control",
      click: onOpenLifeOs,
    },
    { type: "separator" },
    {
      label: "Закрыть Jarvis",
      click: onQuit,
    },
  ];
}

module.exports = { buildTrayMenuTemplate };
