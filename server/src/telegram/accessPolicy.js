function createTelegramAccessPolicy(allowedIds) {
  const allowed = new Set((allowedIds || []).map(String));
  return Object.freeze({
    isAllowed(telegramUserId) {
      return allowed.has(String(telegramUserId || ''));
    },
    size: allowed.size,
  });
}

module.exports = { createTelegramAccessPolicy };
