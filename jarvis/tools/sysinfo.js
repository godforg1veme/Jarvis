const os = require('os');
const { execSync } = require('child_process');

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}д ${h}ч ${m}м`;
}

function formatBytes(bytes) {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb.toFixed(1) + ' GB';
}

function getWindowsVersion() {
  try {
    return execSync('ver', { encoding: 'utf-8' }).trim();
  } catch {
    return os.release();
  }
}

function getDiskInfo() {
  try {
    const output = execSync('wmic logicaldisk where "DriveType=3" get DeviceID,FreeSpace,Size /format:csv', { encoding: 'utf-8' });
    const lines = output.trim().split('\n').filter(l => l.includes(','));
    const disks = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 4) {
        const letter = parts[1];
        const free = parseInt(parts[2]) || 0;
        const total = parseInt(parts[3]) || 0;
        if (letter && total > 0) {
          disks.push({
            letter,
            total: formatBytes(total),
            free: formatBytes(free),
            used: formatBytes(total - free),
          });
        }
      }
    }
    return disks;
  } catch {
    return [];
  }
}

async function execute(args, confirmed) {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'N/A';
  const totalMem = formatBytes(os.totalmem());
  const freeMem = formatBytes(os.freemem());
  const usedMem = formatBytes(os.totalmem() - os.freemem());
  const uptime = formatUptime(os.uptime());
  const winVer = getWindowsVersion();
  const disks = getDiskInfo();

  const lines = [
    `💻 ОС: Windows (${os.release()})`,
    `📅 Аптайм: ${uptime}`,
    `🧠 CPU: ${cpuModel} (${cpus.length} ядер)`,
    `🟢 Частота: ${cpus[0]?.speed || 0} MHz`,
    `💾 RAM: ${usedMem} / ${totalMem} (свободно: ${freeMem})`,
  ];

  if (disks.length > 0) {
    lines.push('');
    lines.push('💿 Диски:');
    for (const d of disks) {
      lines.push(`  ${d.letter} ${d.used} / ${d.total} (свободно: ${d.free})`);
    }
  }

  return {
    ok: true,
    type: 'sys',
    title: 'Системная информация',
    content: lines.join('\n'),
    data: {
      os: os.release(),
      hostname: os.hostname(),
      arch: os.arch(),
      cpuModel,
      cpuCores: cpus.length,
      cpuSpeed: cpus[0]?.speed || 0,
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      uptime: os.uptime(),
      disks,
    },
  };
}

function getSchema() {
  return 'sys: системная информация. Args: {} (без аргументов).';
}

module.exports = { execute, getSchema };