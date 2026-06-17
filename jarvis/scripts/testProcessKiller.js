const assert = require("assert");
const {
  closeAppProcesses,
  isSafeProcessName,
} = require("../actions/processKiller");

async function main() {
  assert.strictEqual(isSafeProcessName("dota2.exe"), true);
  assert.strictEqual(isSafeProcessName("chrome.exe"), true);
  assert.strictEqual(isSafeProcessName("..\\cmd.exe"), false);
  assert.strictEqual(isSafeProcessName("chrome.exe & calc.exe"), false);

  const calls = [];
  const fakeExecFile = (command, args, options, callback) => {
    calls.push({ command, args });

    if (command === "tasklist.exe") {
      callback(null, "Image Name                     PID Session Name\n" +
        "========================= ======== ============\n" +
        "dota2.exe                    1234 Console\n", "");
      return;
    }

    if (command === "taskkill.exe") {
      callback(null, "SUCCESS: The process \"dota2.exe\" with PID 1234 has been terminated.", "");
      return;
    }

    callback(new Error("unexpected command"), "", "unexpected command");
  };

  const result = await closeAppProcesses({
    processNames: ["dota2.exe"],
  }, {
    execFile: fakeExecFile,
  });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.killed, ["dota2.exe"]);
  assert.deepStrictEqual(calls.map((call) => call.command), ["tasklist.exe", "taskkill.exe"]);
  assert.deepStrictEqual(calls[1].args, ["/IM", "dota2.exe", "/T", "/F"]);

  console.log("[test] process killer OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
