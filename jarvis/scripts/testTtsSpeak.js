const { createTtsService } = require('../tts/ttsService');

async function main() {
  const text = process.argv.slice(2).join(' ').trim()
    || 'Привет. Это голос Silero baya в Джарвисе.';

  const service = createTtsService();
  const result = await service.speak(text);

  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
