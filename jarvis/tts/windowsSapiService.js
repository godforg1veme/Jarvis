const { spawn: defaultSpawn } = require('child_process');

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const SPEAK_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Speech',
  '$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]))',
  '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  "$russian = $synth.GetInstalledVoices() | Where-Object { $_.Voice.Culture.Name -eq 'ru-RU' } | Select-Object -First 1",
  'if ($null -ne $russian) { $synth.SelectVoice($russian.VoiceInfo.Name) }',
  '$synth.Speak($text)',
].join('; ');

function createWindowsSapiService(options = {}) {
  const spawn = options.spawn || defaultSpawn;
  const platform = options.platform || process.platform;

  async function speak(text) {
    const content = String(text || '').trim();
    if (!content) return { ok: false, skipped: true, reason: 'empty text' };
    if (platform !== 'win32') return { ok: false, skipped: true, reason: 'Windows SAPI is unavailable' };

    const encodedText = Buffer.from(content, 'utf8').toString('base64');
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodePowerShell(SPEAK_SCRIPT),
        encodedText,
      ], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Windows SAPI exited with code ${code}`)));
    });
    return { ok: true, provider: 'windows-sapi' };
  }

  return { speak };
}

module.exports = { SPEAK_SCRIPT, createWindowsSapiService, encodePowerShell };
