const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const { inspectCachedResponseError } = require('../src/cachedResponseError');
const { readSubmissionReceipt } = require('../src/submissionReceipt');

test('Linux pinned Playwright reads only the original cached local GET 403',
  { skip: process.platform !== 'linux', timeout: 30000 }, async () => {
    let upstreamCases = 0;
    const server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html></html>'); return;
      }
      upstreamCases++;
      const body = req.url.includes('large') ? Buffer.alloc(32769, 0x61)
        : req.url.includes('invalid') ? Buffer.from([0xff])
          : Buffer.from('XSRF rejected');
      const encoding = req.url.includes('gzip') ? 'gzip' : req.url.includes('br') ? 'br'
        : req.url.includes('deflate') ? 'deflate' : null;
      const wire = encoding === 'gzip' ? zlib.gzipSync(body) : encoding === 'br' ? zlib.brotliCompressSync(body)
        : encoding === 'deflate' ? zlib.deflateSync(body) : body;
      res.writeHead(403, { 'content-type': 'text/plain', ...(encoding ? { 'content-encoding': encoding } : {}) });
      res.write(wire.subarray(0, Math.max(1, Math.floor(wire.length / 2))));
      res.end(wire.subarray(Math.max(1, Math.floor(wire.length / 2))));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true, chromiumSandbox: true });
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const foreignContext = await browser.newContext();
      const foreignPage = await foreignContext.newPage();
      await foreignPage.goto(`http://127.0.0.1:${server.address().port}/`);
      let foreignRequest;
      await foreignPage.route('**/case/chunked', async route => {
        foreignRequest = route.request(); await route.fulfill({ status: 204 });
      });
      await foreignPage.evaluate(async url => { await fetch(url); },
        `http://127.0.0.1:${server.address().port}/case/chunked`);
      assert.ok(foreignRequest);
      const outcomes = new Map();
      await page.route('**/case/*', async route => {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
        try {
          response.body = () => assert.fail('APIResponse.body must not be called');
          const request = route.request();
          const key = new URL(request.url()).pathname.split('/').at(-1);
          const result = await readSubmissionReceipt(response, {}, request);
          const wrongUrl = { status: () => 403, url: () => 'http://other.invalid/', headers: () => response.headers(),
            _request: response._request, _initializer: response._initializer };
          const wrongUid = { status: () => 403, url: () => response.url(), headers: () => response.headers(),
            _request: response._request, _initializer: { fetchUid: 'wrong' } };
          outcomes.set(key, { result, wrongUrl: inspectCachedResponseError(wrongUrl, request),
            wrongUid: inspectCachedResponseError(wrongUid, request),
            foreignContext: inspectCachedResponseError(response, foreignRequest) });
        } finally { await route.fulfill({ status: 204 }); await response.dispose(); }
      });
      for (const key of ['chunked', 'gzip', 'br', 'deflate', 'large', 'invalid'])
        await page.evaluate(async url => { await fetch(url); },
          `http://127.0.0.1:${server.address().port}/case/${key}`);
      assert.equal(upstreamCases, 6);
      for (const key of ['chunked', 'gzip', 'br', 'deflate']) {
        const value = outcomes.get(key);
        assert.equal(value.result.reasonCode, 'JOB_HH_RECEIPT_XSRF_REJECTED');
        assert.equal(value.result.submissionDiagnostic.errorClass, 'xsrf_rejected');
        assert.equal(value.wrongUrl, 'body_unavailable');
        assert.equal(value.wrongUid, 'body_unavailable');
        assert.equal(value.foreignContext, 'body_unavailable');
      }
      for (const key of ['large', 'invalid']) {
        const value = outcomes.get(key);
        assert.equal(value.result.reasonCode, 'JOB_HH_RECEIPT_FORBIDDEN');
        assert.equal(value.result.submissionDiagnostic.errorClass, 'body_unavailable');
      }
    } finally {
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
