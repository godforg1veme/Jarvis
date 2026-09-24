const { loadConfig } = require('./config/loadConfig');
const { createRuntime } = require('./runtime');

async function main() {
  const config = loadConfig();
  const runtime = await createRuntime(config);

  const shutdown = async (signal) => {
    runtime.app.log.info({ signal }, 'shutting down');
    try {
      await runtime.close();
      process.exitCode = 0;
    } catch (error) {
      runtime.app.log.error({ err: error }, 'graceful shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  await runtime.start();
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  process.stderr.write(`[jarvis-server] startup failed: ${message}\n`);
  process.exitCode = 1;
});
