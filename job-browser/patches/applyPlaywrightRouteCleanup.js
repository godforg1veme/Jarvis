// Build-time compatibility patch for the pinned Playwright 1.64.0 bundle.
// Fail closed if upstream changes; never patch a running browser process.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');

const VERSION = '1.64.0';
const INPUT_SHA256 = '2325ca4c1c83070e89dc49fb82525508f0a68e0cf12e2a624277968da216b7e0';
const OUTPUT_SHA256 = '9570b91312203319b0be44f50307553eaf9dafd78db381f0559d96dc59a0c320';
const failure = () => new Error('PLAYWRIGHT_ROUTE_PATCH_FAILED');

function once(source, needle, replacement) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) throw failure();
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function patchTerminal(source, begin, end) {
  const first = source.indexOf(begin);
  if (first < 0 || source.indexOf(begin, first + begin.length) >= 0) throw failure();
  const last = source.indexOf(end, first + begin.length);
  if (last < 0 || source.indexOf(end, last + end.length) >= 0) throw failure();
  const old = source.slice(first, last);
  const started = once(old, 'this._startHandling();', 'this._startHandling();\n        try {');
  const patched = once(started, 'this._endHandling();', '} finally { this._endHandling(); }');
  return source.slice(0, first) + patched + source.slice(last);
}

function patchedBundle(source) {
  let result = once(source,
    'this._routesInFlight = /* @__PURE__ */ new Set();\n        this._consoleApiExposed = false;',
    `this._routesInFlight = /* @__PURE__ */ new Set();
        this.on(BrowserContextEvent.PageClosed, (page) => {
          for (const route of this._routesInFlight) {
            if (route._request?._frame?._page === page) this.removeRouteInFlight(route);
          }
        });
        this._consoleApiExposed = false;`);
  const routeStart = 'Route = class extends SdkObject {';
  const routeEnd = 'Response2 = class extends SdkObject {';
  const first = result.indexOf(routeStart), last = result.indexOf(routeEnd, first + routeStart.length);
  if (first < 0 || last < 0 || result.indexOf(routeStart, first + routeStart.length) >= 0
    || result.indexOf(routeEnd, last + routeEnd.length) >= 0) throw failure();
  let route = result.slice(first, last);
  route = patchTerminal(route, 'async abort(errorCode = "failed") {', 'redirectNavigationRequest(url3) {');
  route = patchTerminal(route, 'redirectNavigationRequest(url3) {', 'async fulfill(overrides) {');
  route = patchTerminal(route, 'async fulfill(overrides) {', '// See https://github.com/microsoft/playwright/issues/12929');
  route = patchTerminal(route, 'async continue(overrides) {', '_startHandling() {');
  return result.slice(0, first) + route + result.slice(last);
}

function apply(packageRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== 'playwright-core' || manifest.version !== VERSION) throw failure();
  const bundle = path.join(packageRoot, 'lib', 'coreBundle.js');
  const input = fs.readFileSync(bundle);
  const digest = createHash('sha256').update(input).digest('hex');
  if (digest === OUTPUT_SHA256) return;
  if (digest !== INPUT_SHA256) throw failure();
  const output = patchedBundle(input.toString('utf8'));
  if (createHash('sha256').update(output).digest('hex') !== OUTPUT_SHA256) throw failure();
  new vm.Script(output, { filename: 'coreBundle.js' });
  const temporary = `${bundle}.jarvis-patch-${process.pid}`;
  try {
    fs.writeFileSync(temporary, output, { flag: 'wx', mode: 0o644 });
    fs.renameSync(temporary, bundle);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw failure(); } }
}

if (require.main === module) {
  try {
    const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), 'node_modules', 'playwright-core');
    apply(root);
    process.stdout.write('PLAYWRIGHT_ROUTE_PATCHED\n');
  } catch {
    process.stderr.write('PLAYWRIGHT_ROUTE_PATCH_FAILED\n');
    process.exitCode = 1;
  }
}

module.exports = { apply, patchedBundle, INPUT_SHA256, OUTPUT_SHA256 };
