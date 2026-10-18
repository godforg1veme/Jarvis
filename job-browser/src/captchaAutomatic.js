const { randomUUID } = require('node:crypto');
const { normalizeAnswer } = require('./captchaTelegramProtocol');
const { hashKey } = require('./captchaTelegramBrowser');

// Invoked inside the controller's serialization queue. Each RPC performs at
// most one OCR/answer operation so it retains the existing deadline.
class CaptchaAutomatic {
  constructor({ coordinator, recognize, evidence, report = () => {} }) { Object.assign(this, { coordinator, recognize, evidence, report }); }
  async challenge(controller, refresh) {
    const state = this.coordinator.state;
    if (state.phase === 'idle') return { outcome: 'idle' };
    // A checkpoint write may have failed in this process after dispatch. The
    // same fail-closed rule as restart applies before preparing another image.
    if (state.automatic?.phase === 'running') {
      await this.coordinator.finishAutomatic(true);
      controller.current = null;
    }
    const auto = this.coordinator.state.automatic;
    // Existing human/legacy claims may describe an uncertain submission.
    if (auto?.phase === 'human' || !auto && (state.claims.length || state.seedRequired)) {
      return controller.issueChallenge(refresh);
    }
    const challenge = await controller.issueChallenge(Boolean(auto) || refresh);
    if (challenge.outcome !== 'ready') return challenge;
    const key = hashKey(controller.current.key);
    if (!await this.coordinator.beginAutomatic(key)) {
      // A repeated picture is not an independent retry. Stop automation.
      if (this.coordinator.state.automatic?.phase === 'ready') {
        await this.coordinator.write({ automatic: { ...this.coordinator.state.automatic, phase: 'human' } });
      }
      return challenge;
    }
    let human = false, submitting = false, stage = 'evidence', record;
    const update = patch => record ? this.evidence.update(record.id, patch) : Promise.resolve();
    try {
      record = await this.evidence?.start({ recoveryId: this.coordinator.state.recoveryId,
        attempt: this.coordinator.state.automatic.attempts, pngBase64: challenge.pngBase64 });
      stage = 'ocr';
      const text = normalizeAnswer(await this.recognize(Buffer.from(challenge.pngBase64, 'base64')));
      stage = 'evidence';
      if (text) {
        await update({ answer: text, phase: 'answer_saved' });
        await update({ phase: 'dispatch_started' });
        submitting = true;
        stage = 'submit';
        const result = await controller.submitAnswer({ challengeId: challenge.challengeId,
          revision: challenge.revision, operationId: randomUUID(), text });
        stage = 'evidence';
        await update({ phase: result.outcome, receipt: controller.lastAttemptReceipt || null });
        if (result.outcome === 'solved') return { outcome: 'idle' };
        // Only a positively observed rejection authorizes another answer.
        human = result.outcome !== 'new_challenge';
      } else await update({ phase: 'ocr_invalid' });
    } catch {
      // OCR failure is a failed attempt. After a durable browser claim, any
      // exception is potentially an unknown POST and blocks a second attempt.
      human = submitting || stage === 'evidence';
      if (stage === 'evidence') this.report('JOB_CAPTCHA_EVIDENCE_UNAVAILABLE');
      else {
        try { await update({ phase: submitting ? 'submission_failed' : 'ocr_failed', receipt: controller.lastAttemptReceipt || null }); }
        catch { human = true; this.report('JOB_CAPTCHA_EVIDENCE_UNAVAILABLE'); }
      }
    }
    await this.coordinator.finishAutomatic(human);
    // A fresh human image is prepared on the next tick. Do not accidentally
    // return the image whose answer was consumed above.
    if (this.coordinator.state.automatic?.phase === 'human') controller.current = null;
    return { outcome: 'preparing' };
  }
}
module.exports = { CaptchaAutomatic };
