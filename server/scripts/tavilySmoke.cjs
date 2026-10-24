// One public basic search. Never print the credential, query or source bodies.
const fs = require('node:fs');
const { TavilyMcpClient } = require('../src/search/tavilyMcpClient');

async function main() {
  let apiKey = process.env.JARVIS_TAVILY_API_KEY || '';
  const args = process.argv.slice(2);
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--key-file') throw new Error('SMOKE_ARGUMENTS_INVALID');
    if (fs.statSync(args[1]).size > 2048) throw new Error('SMOKE_KEY_INVALID');
    apiKey = fs.readFileSync(args[1], 'utf8').trim();
  }
  if (!apiKey.trim()) {
    process.stdout.write(JSON.stringify({ status: 'key_required', sourceCount: 0 }) + '\n');
    process.exitCode = 2;
    return;
  }
  const client = new TavilyMcpClient({ apiKey, timeoutMs: 15000 });
  const start = Date.now();
  try {
    const result = await client.search({ query: 'Tavily official documentation' });
    process.stdout.write(JSON.stringify({ status: result.status, sourceCount: result.sources.length, durationMs: Date.now() - start }) + '\n');
    if (result.status !== 'ok') process.exitCode = 1;
  } finally { await client.close(); }
}
main().catch(() => {
  process.stdout.write(JSON.stringify({ status: 'smoke_unavailable', sourceCount: 0 }) + '\n');
  process.exitCode = 1;
});
