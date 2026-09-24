const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modelPath = path.join(root, 'models', 'vosk-model-small-ru-0.22');
const required = ['am', 'conf'];

if (!fs.existsSync(modelPath) || required.some((name) => !fs.existsSync(path.join(modelPath, name)))) {
  process.stderr.write('Cloud Desktop packaging requires models/vosk-model-small-ru-0.22 with am and conf.\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Cloud Desktop wake-word model is ready for packaging.\n');
}
