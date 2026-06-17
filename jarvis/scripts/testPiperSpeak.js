const fs = require('fs');
const path = require('path');
const { createPiperService } = require('../tts/piperService');

function loadTtsSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tts-settings.json'), 'utf-8'));
  } catch {
    return {};
  }
}

async function main() {
  const text = process.argv.slice(2).join(' ').trim()
    || 'Привет. Piper подключен к Джарвису и работает как запасной голос.';

  const service = createPiperService({
    settings: {
      ...loadTtsSettings(),
      provider: 'piper',
    },
  });
  const result = await service.speak(text);

  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
