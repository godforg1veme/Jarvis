function providerProfileForConfig(config) {
  const provider = String(config.modelProvider || 'unknown');
  const model = config.openrouterFreeFirst ? 'free-first'
    : provider === 'openrouter'
    ? String(config.openrouterModel || '')
    : provider === 'salad'
      ? String(config.saladModel || '')
      : 'echo';
  const needsReinforcement = config.openrouterFreeFirst || /deepseek\/deepseek-v4-flash-0731/i.test(model);
  return Object.freeze({
    provider,
    model,
    instructionMode: needsReinforcement ? 'reinforced-current-user' : 'system',
  });
}

module.exports = { providerProfileForConfig };
