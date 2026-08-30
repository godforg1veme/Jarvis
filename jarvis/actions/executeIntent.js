const fs = require("fs");
const { shell: electronShell } = require("electron");
const { apps } = require("./appRegistry");
const { isSteamAppInstalled } = require("./steamApps");
const { closeAppProcesses: defaultCloseAppProcesses } = require("./processKiller");
function getShell(options) {
  return options.shell || electronShell;
}

function shellUnavailableResult() {
  return {
    ok: false,
    message: "Electron shell недоступен. Запуск приложений работает только внутри Electron."
  };
}


async function executeIntent(intent, options = {}) {

  if (!intent || !intent.ok) {

    return {

      ok: false,

      message: "Команда не распознана."

    };

  }

  if (intent.action === "translate_selected") {

    if (typeof options.translateSelectedText !== "function") {

      return {

        ok: false,

        message: "Перевод выделенного текста недоступен."

      };

    }

    return await options.translateSelectedText();

  }

  if (intent.action === "visual_analyze") {

    if (typeof options.analyzeVisualArea !== "function") {

      return {

        ok: false,

        message: "AI-анализ области экрана недоступен."

      };

    }

    return await options.analyzeVisualArea(intent.rawText || "");

  }

  if (intent.action === "visual_continue") {

    if (typeof options.continueVisualDialog !== "function") {

      return {

        ok: false,

        message: "Визуальный контекст недоступен."

      };

    }

    return await options.continueVisualDialog(intent.rawText || "");

  }

  if (intent.action === "clear_visual_context") {

    if (typeof options.clearVisualContext !== "function") {

      return {

        ok: false,

        message: "Очистка визуального контекста недоступна."

      };

    }

    return await options.clearVisualContext();

  }

  if (intent.action === "desktop_agent") {

    if (typeof options.startAgentTask !== "function") {

      return {

        ok: false,

        message: "Desktop Agent недоступен."

      };

    }

    return await options.startAgentTask(intent.command || intent.rawText || "");

  }

  if (intent.action === "recover_app") {

    if (typeof options.startAppRecovery !== "function") {

      return {

        ok: false,

        message: "Поиск неизвестных приложений недоступен."

      };

    }

    const recovery = await options.startAppRecovery(intent.command || intent.rawText || intent.appQuery || "", {
      inputChannel: "voice",
      normalizedQuery: intent.appQuery || "",
    });

    const count = Array.isArray(recovery && recovery.candidates) ? recovery.candidates.length : 0;
    let message = recovery && recovery.error ? recovery.error : "Ищу приложение на компьютере.";
    if (recovery && recovery.state === "awaiting_confirmation" && count === 1) {
      message = `Нашёл ${recovery.candidates[0].displayName}. Запустить? Скажите да или нет.`;
    } else if (recovery && recovery.state === "awaiting_selection") {
      message = `Нашёл несколько вариантов: ${recovery.candidates.map((candidate, index) => `${index + 1}: ${candidate.displayName}`).join("; ")}. Назовите номер.`;
    }

    return {

      ok: recovery && !["failed", "cancelled"].includes(recovery.state),

      type: "app_recovery",

      message,

      recovery,

    };

  }

  if (["open_file", "reveal_file", "find_file"].includes(intent.action)) {

    const executeFileCommand = options.executeFileCommand || (async (args) => {
      const fileCommander = require("../tools/fileCommander");
      return await fileCommander.execute(args);
    });

    const actionMap = {
      open_file: "open",
      reveal_file: "reveal",
      find_file: "find",
    };

    const result = await executeFileCommand({
      action: actionMap[intent.action],
      query: intent.query,
      location: intent.location,
      source: "voice",
    });

    if (result && (result.needsSelection || result.needsConfirmation) && typeof options.showMainWindow === "function") {
      await options.showMainWindow();
    }

    return result;

  }



  if (!["launch_app", "close_app"].includes(intent.action)) {

    return {

      ok: false,

      message: "Это действие не разрешено."

    };

  }



  const app = apps[intent.appId];



  if (!app) {

    return {

      ok: false,

      message: "Такого приложения нет в списке."

    };

  }



  if (!app.safeNoConfirm) {

    return {

      ok: false,

      message: "Для этого действия нужно подтверждение."

    };

  }

  if (intent.action === "close_app") {

    if (!Array.isArray(app.processNames) || app.processNames.length === 0) {

      return {

        ok: false,

        message: `Для ${app.displayName} не настроены разрешенные процессы для завершения.`

      };

    }

    const closeAppProcesses = options.closeAppProcesses || defaultCloseAppProcesses;

    const result = await closeAppProcesses(app);

    if (!result.ok) {

      return {

        ok: false,

        message: `Не удалось выключить ${app.displayName}: ${result.errors.join("; ")}`

      };

    }

    if (result.killed.length === 0) {

      return {

        ok: true,

        message: `${app.displayName} не запущена.`

      };

    }

    return {

      ok: true,

      message: `Выключаю ${app.displayName}.`

    };

  }



  if (app.type === "steam") {

    const installed = await isSteamAppInstalled(app.steamAppId);



    if (!installed) {

      return {

        ok: false,

        message: `${app.displayName} не найдена. Игра не установлена или Steam-библиотека не обнаружена.`

      };

    }



    const shell = getShell(options);
    if (!shell || typeof shell.openExternal !== "function") {
      return shellUnavailableResult();
    }

    await shell.openExternal(`steam://rungameid/${app.steamAppId}`);



    return {

      ok: true,

      message: `Запускаю ${app.displayName}.`

    };

  }



  if (app.type === "path") {

    const existingPath = app.possiblePaths.find((possiblePath) =>

      fs.existsSync(possiblePath)

    );



    if (!existingPath) {

      return {

        ok: false,

        message: `${app.displayName} не найден.`

      };

    }



    const shell = getShell(options);
    if (!shell || typeof shell.openPath !== "function") {
      return shellUnavailableResult();
    }

    const error = await shell.openPath(existingPath);



    if (error) {

      return {

        ok: false,

        message: `Не удалось запустить ${app.displayName}: ${error}`

      };

    }



    return {

      ok: true,

      message: `Запускаю ${app.displayName}.`

    };

  }



  return {

    ok: false,

    message: "Тип приложения не поддерживается."

  };

}



module.exports = { executeIntent };
