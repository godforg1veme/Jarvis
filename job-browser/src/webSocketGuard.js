// Page-scoped routes are disposed with the page. The context route remains a
// backstop for unexpected popups and pages that are not created by Jarvis.
async function newGuardedPage(context) {
  const page = await context.newPage();
  try {
    if (typeof page.routeWebSocket !== 'function') throw new Error('JOB_BROWSER_WS_GUARD_UNAVAILABLE');
    await page.routeWebSocket('**/*', socket => socket.close());
    return page;
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

module.exports = { newGuardedPage };
