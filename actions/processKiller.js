const { execFile } = require("child_process");

function isSafeProcessName(processName) {
  return /^[a-zA-Z0-9_. -]+\.exe$/i.test(String(processName || ""));
}

function execFilePromise(command, args, execFileImpl = execFile) {
  return new Promise((resolve) => {
    execFileImpl(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function isProcessRunning(processName, execFileImpl = execFile) {
  const result = await execFilePromise("tasklist.exe", ["/FI", `IMAGENAME eq ${processName}`], execFileImpl);
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return output.includes(processName.toLowerCase());
}

async function closeProcessByName(processName, execFileImpl = execFile) {
  if (!isSafeProcessName(processName)) {
    return {
      ok: false,
      processName,
      error: "Unsafe process name.",
    };
  }

  if (process.platform !== "win32") {
    return {
      ok: false,
      processName,
      error: "Process closing is only supported on Windows.",
    };
  }

  const running = await isProcessRunning(processName, execFileImpl);
  if (!running) {
    return {
      ok: true,
      processName,
      notFound: true,
    };
  }

  const result = await execFilePromise("taskkill.exe", ["/IM", processName, "/T", "/F"], execFileImpl);
  if (result.error) {
    return {
      ok: false,
      processName,
      error: result.stderr.trim() || result.stdout.trim() || result.error.message,
    };
  }

  return {
    ok: true,
    processName,
    killed: true,
  };
}

async function closeAppProcesses(app, options = {}) {
  const processNames = Array.isArray(app && app.processNames) ? app.processNames : [];
  const execFileImpl = options.execFile || execFile;
  const killed = [];
  const notFound = [];
  const errors = [];

  if (processNames.length === 0) {
    return {
      ok: false,
      killed,
      notFound,
      errors: ["No allowed process names configured."],
    };
  }

  for (const processName of processNames) {
    const result = await closeProcessByName(processName, execFileImpl);
    if (result.killed) killed.push(processName);
    if (result.notFound) notFound.push(processName);
    if (!result.ok) errors.push(`${processName}: ${result.error}`);
  }

  return {
    ok: errors.length === 0,
    killed,
    notFound,
    errors,
  };
}

module.exports = {
  closeAppProcesses,
  closeProcessByName,
  isSafeProcessName,
};
