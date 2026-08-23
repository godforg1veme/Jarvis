function buildTrayMenuTemplate({ isMicOn, showTranscriptionBar, onToggleMic, onToggleTranscriptionBar, onQuit }) {
  return [
    {
      label: isMicOn ? "Выключить микрофон" : "Включить микрофон",
      click: onToggleMic,
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
