const assert = require('assert');
const path = require('path');
const { QuantumCore, createQuantumCore, COLOR_PALETTES } = require('../renderer/quantumCore');

console.log('[testQuantumCore] Starting QuantumCore tests...');

// 1. Check exports
assert.strictEqual(typeof QuantumCore, 'function', 'QuantumCore should be a class/constructor');
assert.strictEqual(typeof createQuantumCore, 'function', 'createQuantumCore should be a factory function');
assert(COLOR_PALETTES.cyan, 'COLOR_PALETTES should include cyan');
assert(COLOR_PALETTES.alert, 'COLOR_PALETTES should include alert');

// 2. Initialize instance in Node.js headless environment
const core = createQuantumCore({
  autoStart: false,
  width: 320,
  height: 320,
  mouseTracking: true,
});

assert(core, 'core instance should be created');
assert.strictEqual(core.mode, 'idle', 'default mode should be idle');
assert.strictEqual(core.isPaused, true, 'isPaused should be true when autoStart is false');

// 3. Verify 3D Geometry Structure
// Central Singularity
assert(core.coreData.coreGroup, 'coreGroup should exist');
assert(core.plasma, 'plasma sphere should exist');
assert(core.glowShell, 'glowShell should exist');
assert(core.cage1, 'geodesic cage 1 should exist');
assert(core.cage2, 'geodesic cage 2 should exist');

// 4 Concentric Gyroscopic Rings
assert(core.coreData.r1Group, 'Ring 1 (Outer heavy caliper) should exist');
assert.strictEqual(core.calipers.length, 4, 'Should have exactly 4 calipers on Ring 1');

assert(core.coreData.r2Group, 'Ring 2 (Segmented graduation compass) should exist');

assert(core.coreData.r3Group, 'Ring 3 (Data ring) should exist');
assert.strictEqual(core.nodes.length, 3, 'Should have exactly 3 data nodes on Ring 3');

assert(core.coreData.r4Group, 'Ring 4 (Polar orbital gyroscope) should exist');

// 64-Channel Circular Equalizer
assert(core.coreData.waveGroup, 'Wave group should exist');
assert.strictEqual(core.waveNeedles.length, 64, 'Should have exactly 64 needles in equalizer');

// Planar Holographic Scanner Disc
assert(core.coreData.scannerGroup, 'Scanner tomography group should exist');
assert.strictEqual(core.coreData.scannerGroup.visible, false, 'Scanner should be invisible in idle mode');

// 3 Orbital Photon Comets
assert.strictEqual(core.comets.length, 3, 'Should have exactly 3 photon comets');

// 4. Test Mode Switching
core.setMode('speech');
assert.strictEqual(core.mode, 'speech', 'mode should be speech');

core.setMode('vortex');
assert.strictEqual(core.mode, 'vortex', 'mode should be vortex');

core.setMode('scanner');
assert.strictEqual(core.mode, 'scanner', 'mode should be scanner');
assert.strictEqual(core.coreData.scannerGroup.visible, true, 'scanner should be visible in scanner mode');

core.setMode('alert');
assert.strictEqual(core.mode, 'alert', 'mode should be alert');
assert.strictEqual(core.activeTheme, 'alert', 'theme should switch to alert');
assert.strictEqual(core.plasmaMat.color.getHex(), COLOR_PALETTES.alert.plasma, 'plasma color should be red in alert');

core.setMode('idle');
assert.strictEqual(core.mode, 'idle', 'mode should return to idle');
assert.strictEqual(core.coreData.scannerGroup.visible, false, 'scanner should be hidden in idle');
assert.strictEqual(core.activeTheme, 'cyan', 'theme should return to cyan');
assert.strictEqual(core.plasmaMat.color.getHex(), COLOR_PALETTES.cyan.plasma, 'plasma color should be cyan in idle');

// 5. Test Audio Level & Spectrum input
core.setAudioLevel(0.8, new Uint8Array([255, 128, 64, 32]));
assert.strictEqual(core.audioAmplitude, 0.8, 'audioAmplitude should match');
assert(core.audioFrequencyData, 'frequency data should be set');

core.setAudioLevel(-0.5);
assert.strictEqual(core.audioAmplitude, 0, 'amplitude should be clamped to 0');

core.setAudioLevel(2.5);
assert.strictEqual(core.audioAmplitude, 1.0, 'amplitude should be clamped to 1.0');

// 6. Test Custom Theme
core.setTheme('#ff00ff');
assert.strictEqual(core.plasmaMat.color.getHex(), 0xff00ff, 'custom theme should apply hex color');

core.setTheme('cyan');
assert.strictEqual(core.plasmaMat.color.getHex(), COLOR_PALETTES.cyan.plasma, 'setting theme name should restore palette');

// 7. Test Animation Step (tick)
core.tick(0.016);
assert(core.currentRotSpeed > 0, 'currentRotSpeed should be positive');

// Switch to vortex and step animation
core.setMode('vortex');
core.tick(0.1);
assert(core.currentRotSpeed > 1.0, 'currentRotSpeed should accelerate toward 3.8 in vortex mode');

// Switch to speech with audio data and step animation
core.setMode('speech');
core.setAudioLevel(0.9, new Uint8Array(64).fill(200));
core.tick(0.016);
assert(core.waveNeedles[0].mesh.scale.y > 0.1, 'needles should react to frequency data in speech mode');

// 8. Test Viewport Resize & Properties
core.resize(400, 300);
assert.strictEqual(core.camera.aspect, 400 / 300, 'camera aspect ratio should be updated');

core.setSpeed(1.5);
assert.strictEqual(core.speedFactor, 1.5, 'speed factor should update');

core.setPulse(2.0);
assert.strictEqual(core.pulseFactor, 2.0, 'pulse factor should update');

core.setScale(0.8);
assert.strictEqual(core.scaleFactor, 0.8, 'scale factor should update');
assert.strictEqual(core.modelGroup.scale.x, 0.8, 'modelGroup scale should match');

// 9. Test Mouse tracking and updateMouse
core.updateMouse(0.5, -0.3);
assert.strictEqual(core.mouse.x, 0.5, 'mouse.x should update');
assert.strictEqual(core.mouse.y, -0.3, 'mouse.y should update');

core.setTracking(false);
assert.strictEqual(core.mouseTracking, false, 'mouseTracking should disable');

// 9b. Test Pause and Resume
core.resume();
assert.strictEqual(core.isPaused, false, 'isPaused should be false after resume()');
core.pause();
assert.strictEqual(core.isPaused, true, 'isPaused should be true after pause()');

// 10. Test Destruction & Cleanup
core.destroy();
assert.strictEqual(core.isDestroyed, true, 'core should be marked destroyed');
assert.strictEqual(core.scene, null, 'scene should be null after destroy');
assert.strictEqual(core.renderer, null, 'renderer should be null after destroy');

console.log('[testQuantumCore] All QuantumCore tests passed successfully!');
