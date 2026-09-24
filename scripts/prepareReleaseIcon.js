const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const source = path.join(__dirname, '..', 'assets', 'tray-icon.png');
const targetDirectory = path.join(__dirname, '..', 'build');
const target = path.join(targetDirectory, 'jarvis.ico');
const resizedPng = path.join(targetDirectory, 'jarvis-256.png');
fs.mkdirSync(targetDirectory, { recursive: true });

const resizeScript = [
  'Add-Type -AssemblyName System.Drawing',
  "$source = [Environment]::GetEnvironmentVariable('JARVIS_RELEASE_ICON_SOURCE')",
  "$target = [Environment]::GetEnvironmentVariable('JARVIS_RELEASE_ICON_TARGET')",
  '$input = [System.Drawing.Image]::FromFile($source)',
  '$bitmap = New-Object System.Drawing.Bitmap 256, 256',
  '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
  '$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
  '$graphics.Clear([System.Drawing.Color]::Transparent)',
  '$graphics.DrawImage($input, 0, 0, 256, 256)',
  '$graphics.Dispose(); $input.Dispose()',
  '$bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)',
  '$bitmap.Dispose()',
].join('; ');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', resizeScript], {
  env: { ...process.env, JARVIS_RELEASE_ICON_SOURCE: source, JARVIS_RELEASE_ICON_TARGET: resizedPng },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const png = fs.readFileSync(resizedPng);

if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error('The Jarvis tray asset must be a PNG image.');
}

const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (!width || !height || width > 256 || height > 256) {
  throw new Error('The release icon must be between 1 and 256 pixels in each dimension.');
}

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(width === 256 ? 0 : width, 6);
header.writeUInt8(height === 256 ? 0 : height, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);

fs.writeFileSync(target, Buffer.concat([header, png]));
console.log('Jarvis Windows icon is ready for packaging.');
