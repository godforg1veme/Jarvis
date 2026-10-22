const { allowedRequest } = require('./networkPolicy');
const { readResumes } = require('./hhPageReader');
const { validRaiseRequest, ID } = require('./resumeRaiseProtocol');
const BUTTON = 'button[data-qa~="resume-update-button_actions"]';
// Never use the home-page button: HH says it raises all resumes at once.
async function raiseResume({ browser, ledger, userId, operationId, resumeId, receiptTimeoutMs=18000 }) {
  if (!ID.test(resumeId || '') || browser.primaryResumeId !== resumeId) return { outcome: 'ineligible', verified: true };
  const reserved = await ledger.reserve({ userId, operationId, resumeId });
  if (!reserved.execute) { const { execute, ...result } = reserved; return result; }
  let opened, sent = false, settled = null, completion, timer;
  try {
    opened = await browser.open('https://hh.ru/applicant/resumes', 'authenticated');
    const { page } = opened;
    const list = await readResumes(page);
    if (!list.some(r => r.id === resumeId)) return await ledger.finish({ userId, operationId, resumeId }, 'ineligible');
    const cards = page.locator('[data-qa="resume"]').filter({ has: page.locator(`a[href*="/resume/${resumeId}"]`) });
    if (await cards.count() !== 1) return await ledger.finish({ userId, operationId, resumeId }, 'ineligible');
    const button = cards.locator(BUTTON).filter({ hasText: /^(?:Поднять(?: в поиске)?|Обновить)$/u });
    if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled())
      return await ledger.finish({ userId, operationId, resumeId }, 'not_due');
    completion = new Promise(resolve => { settled = resolve; });
    await page.route('**/*', async route => {
      const r = route.request();
      if (['GET','HEAD','OPTIONS'].includes(r.method())) return allowedRequest(r.url()) ? route.fallback() : route.abort();
      let permitted = false;
      try {
        const headers = r.headers();
        const cookie = (await page.context().cookies('https://hh.ru')).filter(c => c.name === '_xsrf').map(c => `${c.name}=${c.value}`).join('; ');
        permitted = !sent && r.frame() === page.mainFrame() && validRaiseRequest({ url: r.url(), method: r.method(),
          resourceType: r.resourceType(), contentType: headers['content-type'], body: r.postDataBuffer(), csrfToken: headers['x-xsrftoken'] }, resumeId, cookie);
      } catch {}
      if (!permitted) return route.abort();
      sent = true;
      let response;
      try {
        response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
        if (response.status() !== 200 || !/^application\/json(?:;|$)/i.test(response.headers()['content-type'] || '')
          || Number(response.headers()['content-length'] || 0) > 32768) { await route.abort(); settled(false); return; }
        const body = await response.body(); if (body.length > 32768) { await route.abort(); settled(false); return; }
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body });
        settled(true);
      } catch { await route.abort().catch(() => {}); settled(false); }
      finally { await response?.dispose?.().catch(() => {}); }
    });
    await button.click({ timeout: 5000 });
    const acknowledged = await Promise.race([completion, new Promise(resolve => {timer=setTimeout(() => resolve(false), receiptTimeoutMs);})]);
    clearTimeout(timer);
    // A 200 alone is insufficient: reload the server's card and see its cooldown.
    if (acknowledged) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      const fresh = cards.locator(BUTTON).filter({ hasText: /^(?:Поднять(?: в поиске)?|Обновить)$/u });
      if (await fresh.count() === 1 && !await fresh.isEnabled()) return await ledger.finish({ userId, operationId, resumeId }, 'raised');
    }
    return await ledger.finish({ userId, operationId, resumeId }, sent ? 'unknown' : 'failed');
  } catch { return await ledger.finish({ userId, operationId, resumeId }, sent ? 'unknown' : 'failed'); }
  finally { clearTimeout(timer); await opened?.page.close().catch(() => {}); }
}
module.exports = { raiseResume };
