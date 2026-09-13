function parseRemoteCommand(text, options = {}) {
  const value = String(text || '').trim();
  const pattern = options.allowMissingDevice
    ? /^\/desktop\s+(?:([a-f0-9-]{36})\s+)?([^\s]+)(?:\s+([\s\S]+))?$/i
    : /^\/desktop\s+([a-f0-9-]{36})\s+([^\s]+)(?:\s+([\s\S]+))?$/i;
  const match = pattern.exec(value);
  if (!match) return null;
  let args = {};
  if (match[3]) {
    try {
      args = JSON.parse(match[3]);
    } catch (_) {
      return { error: 'Аргументы должны быть корректным JSON-объектом.' };
    }
  }
  return { deviceId: match[1] || null, action: match[2], args };
}

function commandIdFromText(text, command) {
  const match = new RegExp(`^\\/${command}\\s+([a-f0-9-]{36})$`, 'i').exec(String(text || '').trim());
  return match ? match[1] : null;
}

function parseOpenFolderIntent(text) {
  const value = String(text || '').trim();
  const match = /^(?:привет[,.!\s]*)?(?:(?:ты\s+)?(?:можешь|сможешь)\s+)?(?:пожалуйста[,.!\s]*)?(?:открой|открыть|покажи|показать)\s+(?:мне\s+)?(?:эту\s+)?папку(?:\s+(.+?))?[?.!]*$/iu.exec(value);
  if (!match) return null;
  const path = String(match[1] || '').trim().replace(/^[«"'`]+|[»"'`]+$/g, '').trim();
  return { path };
}

function isWindowsAbsolutePath(value) {
  return /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/])/i.test(String(value || '').trim());
}

function confirmationResponse(prompt, commandId) {
  const answer = String(prompt || '').trim();
  const buttons = [
    [
      { text: '✅ Подтвердить', data: `cmd:confirm:${commandId}` },
      { text: '❌ Отклонить', data: `cmd:reject:${commandId}` },
    ],
  ];
  return {
    answer,
    buttons,
    toString() { return answer; },
    [Symbol.toPrimitive]() { return answer; },
  };
}

async function createCommandReply({ command, userId, conversationId, originChannel, originDeviceId, commandService, defaultDeviceId }) {
  const deviceId = command.deviceId || defaultDeviceId;
  if (!deviceId) return 'Укажи ID устройства: /desktop DEVICE_ID ACTION JSON';
  try {
    const result = await commandService.create({
      userId,
      conversationId,
      originChannel,
      originDeviceId,
      deviceId,
      action: command.action,
      args: command.args,
    });
    if (result.status === 'awaiting_confirmation') {
      return confirmationResponse(result.prompt, result.command.id);
    }
    return result.status === 'running'
      ? 'Команда отправлена на Desktop.'
      : `Команда не выполнена: ${result.error || result.status}.`;
  } catch (error) {
    if (error.publicCode === 'ACTION_UNSUPPORTED_BY_DEVICE') return 'Это действие не заявлено возможностями выбранного Desktop.';
    if (error.publicCode === 'DEVICE_NOT_FOUND') return 'Устройство не найдено среди ваших устройств.';
    if (error.publicCode === 'DEVICE_REVOKED') return 'Выбранное устройство отозвано.';
    throw error;
  }
}

async function remoteCommandReply({ text, userId, conversationId = null, originChannel, originDeviceId = null, commandService, defaultDeviceId = null, orchestrator = null }) {
  const value = String(text || '').trim();
  if (!commandService) return null;
  const statusCommandId = commandIdFromText(value, 'command');
  if (statusCommandId) {
    try {
      const command = await commandService.get({ userId, commandId: statusCommandId });
      const suffix = command.error_code ? ` (${command.error_code})` : '';
      return `Команда ${command.id}: ${command.status}${suffix}.`;
    } catch (error) {
      if (error.publicCode === 'COMMAND_NOT_FOUND') return 'Команда не найдена.';
      throw error;
    }
  }

  const decisionMatch = /^\/(confirm|reject)(?:\s+([a-f0-9-]{36}))?$/i.exec(value);
  if (decisionMatch) {
    const action = decisionMatch[1].toLowerCase();
    const commandId = decisionMatch[2] || null;
    try {
      if (orchestrator) {
        const workflowResult = action === 'confirm'
          ? await orchestrator.confirm({ userId, conversationId, originChannel, originDeviceId, commandId, text: value })
          : await orchestrator.reject({ userId, conversationId, originChannel, originDeviceId, commandId, text: value });
        if (workflowResult && workflowResult.handled) return workflowResult.answer;
      }
      const result = action === 'confirm'
        ? await commandService.approve({ userId, commandId, originChannel, originDeviceId })
        : await commandService.reject({ userId, commandId, originChannel, originDeviceId });
      if (result.status === 'running') return 'Подтверждение принято. Действие выполняется на компьютере.';
      if (result.status === 'failed') return `Команда не выполнена: ${result.error || 'ошибка доставки'}.`;
      return 'Действие отменено.';
    } catch (error) {
      if (error.publicCode === 'CONFIRMATION_UNAVAILABLE') return 'Подтверждение не найдено, уже использовано или истекло.';
      throw error;
    }
  }

  const command = parseRemoteCommand(value, { allowMissingDevice: Boolean(defaultDeviceId) });
  if (!command) return null;
  if (command.error) return command.error;
  return createCommandReply({
    command,
    userId,
    conversationId,
    originChannel,
    originDeviceId,
    commandService,
    defaultDeviceId,
  });
}

module.exports = {
  commandIdFromText,
  isWindowsAbsolutePath,
  parseOpenFolderIntent,
  parseRemoteCommand,
  remoteCommandReply,
};
