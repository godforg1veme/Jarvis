const { menuAction } = require('./telegramMenu');
const { parseMemoryCommand } = require('../memory/memoryService');

const ACTION_PERMISSION = Object.freeze({ life: 'life', memory: 'memory', documents: 'documents',
  devices: 'devices', vpn: 'vpn', operations: 'operations', jobs: 'jobs' });
const DENIED_ANSWER = 'Этот раздел недоступен с текущими правами. Обратись к администратору.';

function callbackPermissions(data) {
  const prefix = String(data || '').split(':', 1)[0];
  if (prefix === 'flow') return []; // Cancels only an existing scoped state.
  if (prefix === 'gallery') return ['memory', 'documents', 'devices'];
  const permission = ({ mem: 'memory', doc: 'documents', dev: 'devices', cmd: 'devices',
    life: 'life', vpn: 'vpn', vpsup: 'vpn', job: 'jobs' })[prefix];
  return permission ? [permission] : ['assistant'];
}

function textPermissions(text) {
  const action = menuAction(text);
  if (action) return ACTION_PERMISSION[action] ? [ACTION_PERMISSION[action]] : [];
  const command = /^\/(\w+)(?:@\w+)?(?:\s|$)/.exec(String(text || '').trim())?.[1]?.toLowerCase();
  if (command === 'start') return [];
  if (command && /^(?:vpn|happ)/.test(command)) return ['vpn'];
  if (command && /^(?:life)/.test(command)) return ['life'];
  if (['documents', 'document_delete'].includes(command)) return ['documents'];
  if (['devices', 'pair', 'revoke', 'desktop', 'command', 'confirm', 'reject'].includes(command)) return ['devices'];
  if (['memory', 'forget', 'remember'].includes(command)) return ['memory'];
  if (parseMemoryCommand(text)) return ['memory'];
  return ['assistant'];
}

function interactionPermissions(kind) {
  if (kind.startsWith('job_')) return ['jobs'];
  if (kind.startsWith('life_')) return ['life'];
  if (kind.startsWith('vpn_')) return ['vpn'];
  if (kind.startsWith('device_')) return ['devices'];
  if (kind.startsWith('memory_')) return ['memory'];
  return ['assistant'];
}

async function messagePermissions(input, context, interactions) {
  if (input.replyMessageId && input.captchaReplyHint) return ['jobs'];
  if (input.attachment) return ['documents'];
  if (input.voice) return ['assistant'];
  if (!menuAction(input.text) && !/^\/start(?:@\w+)?$/i.test(input.text) && interactions) {
    const active = await interactions.getActive({ userId: context.user.id,
      conversationId: context.conversation.id, chatId: context.chatId });
    if (active.interaction) return interactionPermissions(active.interaction.kind);
  }
  return textPermissions(input.text);
}

function permits(access, permissions) {
  return Boolean(access && !access.blocked && permissions.every((id) => access.permissions.includes(id)));
}

module.exports = { ACTION_PERMISSION, DENIED_ANSWER, callbackPermissions, textPermissions,
  interactionPermissions, messagePermissions, permits };
