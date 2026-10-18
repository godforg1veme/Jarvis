// Run explicitly via docker exec as pwuser; redirect output to a private file.
// This archive never enters HTTP/RPC, standard application logs or Telegram.
const { CaptchaAttemptStore } = require('./captchaAttemptStore');
async function exportAttempts() {
  const root = '/home/pwuser/profile', ownerId = process.env.JARVIS_JOB_BROWSER_OWNER_ID;
  return new CaptchaAttemptStore({ root: `${root}/captcha-evidence`, ownerId }).export();
}
if (require.main === module) exportAttempts().then(v => process.stdout.write(JSON.stringify(v)))
  .catch(() => { process.stderr.write('JOB_CAPTCHA_EVIDENCE_UNAVAILABLE\n'); process.exitCode = 1; });
module.exports = { exportAttempts };
