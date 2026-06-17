function buildTrayMenuTemplate({ isMicOn, onToggleMic, onQuit }) {
  return [
    {
      label: isMicOn ? "Выключить микрофон" : "Включить микрофон",
      click: onToggleMic,
    },
    { type: "separator" },
    {
      label: "Закрыть Jarvis",
      click: onQuit,
    },
  ];
}

module.exports = { buildTrayMenuTemplate };
