const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
assert(source.includes('function displayRecovery(snapshot)'));
assert(source.includes('window.jarvis.onAppRecoveryState'));
assert(source.includes('window.jarvis.selectAppRecovery(item.recoveryId, candidate.candidateId)'));
assert(source.includes('window.jarvis.confirmAppRecovery(pending.recoveryId)'));
assert(source.includes('window.jarvis.cancelAppRecovery'));
assert(source.includes("confirmYes.textContent = 'Запустить'"));
assert(source.includes("event.key === 'Escape' && (state.confirmingRecovery || state.confirmingCommand)"));
const displayResultSource = source.slice(source.indexOf('function displayResult('), source.indexOf('function recoveryStateText('));
const displayRecoverySource = source.slice(source.indexOf('function displayRecovery('), source.indexOf('// --- Confirm Dialog ---'));
assert(!displayResultSource.includes('getAppRecoveryDetails(snapshot.recoveryId'));
assert(displayRecoverySource.includes('getAppRecoveryDetails(snapshot.recoveryId, candidate.candidateId)'));
assert(displayRecoverySource.includes('candidate.candidateId === snapshot.selectedCandidateId'));

console.log('testAppRecoveryRendererBehavior: ok');
