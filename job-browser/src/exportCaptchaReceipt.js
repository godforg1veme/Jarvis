const { ManualState } = require('./manualState');
async function exportReceipt() {
  const state = await new ManualState({ root: '/home/pwuser/profile/manual-recovery', ownerId: process.env.JARVIS_JOB_BROWSER_OWNER_ID }).read();
  return { phase: state.phase, receipt: state.lastReceipt || null };
}
if (require.main === module) exportReceipt().then(v => process.stdout.write(JSON.stringify(v)))
  .catch(() => { process.stderr.write('JOB_CAPTCHA_RECEIPT_UNAVAILABLE\n'); process.exitCode = 1; });
module.exports = { exportReceipt };
