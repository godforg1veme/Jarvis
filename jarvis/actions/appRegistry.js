const apps = {

  dota2: {
    id: "dota2",
    displayName: "Dota 2",
    aliases: [
      "дота",
      "доту",
      "доте",
      "dota",
      "dota 2",
      "дота 2"
    ],
    type: "steam",
    steamAppId: "570",
    processNames: ["dota2.exe"],
    safeNoConfirm: true
  },

  chrome: {
    id: "chrome",
    displayName: "Google Chrome",
    aliases: [
      "хром",
      "chrome",
      "браузер",
      "гугл хром"
    ],
    type: "path",
    possiblePaths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ],
    processNames: ["chrome.exe"],
    safeNoConfirm: true
  },

  firefox: {
    id: "firefox",
    displayName: "Firefox",
    aliases: [
      "фаерфокс",
      "фаер фокс",
      "firefox",
      "мозила",
      "mozila",
      "лиса",
      "огненный лис"
    ],
    type: "path",
    possiblePaths: [
      "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe"
    ],
    processNames: ["firefox.exe"],
    safeNoConfirm: true
  },

  notepad: {
    id: "notepad",
    displayName: "Блокнот",
    aliases: [
      "блокнот",
      "нота",
      "notepad",
      "нотепад"
    ],
    type: "path",
    possiblePaths: [
      "C:\\Windows\\System32\\notepad.exe",
      "C:\\Windows\\notepad.exe"
    ],
    processNames: ["notepad.exe"],
    safeNoConfirm: true
  },

  calculator: {
    id: "calculator",
    displayName: "Калькулятор",
    aliases: [
      "калькулятор",
      "кальк",
      "calc",
      "calculator"
    ],
    type: "path",
    possiblePaths: [
      "C:\\Windows\\System32\\calc.exe",
      "C:\\Windows\\calc.exe"
    ],
    processNames: ["CalculatorApp.exe", "calc.exe"],
    safeNoConfirm: true
  }
};

module.exports = { apps };
