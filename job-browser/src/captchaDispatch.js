// Do not let a 307/308 turn an approved captcha POST into an unguarded POST.
// Browser redirects are not guaranteed to pass through Playwright routing again.
async function dispatchCaptcha(route) {
  let response;
  try {
    response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
    const u = new URL(route.request().url());
    if (u.pathname !== '/captcha') {
      await route.fulfill({ status: 204, headers: { 'cache-control': 'no-store' } });
      // The synthetic 204 is not evidence of the upstream result.
      return { acknowledged: response.status() === 200 };
    }
    const headers = response.headers();
    if (response.status() !== 200 || !/^application\/json(?:;|$)/i.test(headers['content-type'] || '')
      || Number(headers['content-length'] || 0) > 8192) return await route.abort();
    const body = await response.body();
    if (body.length > 8192) return await route.abort();
    return await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body });
  } catch { return route.abort().catch(() => {}); }
  finally { await response?.dispose?.().catch(() => {}); }
}
module.exports = { dispatchCaptcha };
