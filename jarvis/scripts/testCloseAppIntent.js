const assert = require("assert");
const { parseIntent } = require("../voice/intentParser");
const { executeIntent } = require("../actions/executeIntent");

async function main() {
  const closeIntent = parseIntent("джарвис выключи доту");
  assert.strictEqual(closeIntent.ok, true);
  assert.strictEqual(closeIntent.action, "close_app");
  assert.strictEqual(closeIntent.appId, "dota2");

  const launchIntent = parseIntent("джарвис включи доту");
  assert.strictEqual(launchIntent.ok, true);
  assert.strictEqual(launchIntent.action, "launch_app");
  assert.strictEqual(launchIntent.appId, "dota2");

  const calls = [];
  const result = await executeIntent(closeIntent, {
    closeAppProcesses: async (app) => {
      calls.push(app);
      return {
        ok: true,
        killed: ["dota2.exe"],
        notFound: [],
      };
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].processNames, ["dota2.exe"]);
  assert.match(result.message, /Dota 2/);

  const unknownClose = await executeIntent({
    ok: true,
    action: "close_app",
    appId: "missing",
  });
  assert.strictEqual(unknownClose.ok, false);

  console.log("[test] close app intent OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
