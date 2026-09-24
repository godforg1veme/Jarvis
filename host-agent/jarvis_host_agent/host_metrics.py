"""Host-only aggregate counters; no process arguments or network addresses."""
from pathlib import Path

_previous_cpu = None


def extra_metrics():
    global _previous_cpu
    output = {}
    try:
        # guest times are already included in user/nice and must not be added twice.
        cpu = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
        current = (sum(cpu), cpu[3] + cpu[4])
        if _previous_cpu and current[0] > _previous_cpu[0]:
            output['cpuUsedPercent'] = round(max(0, min(100, 100 * (1 - (current[1] - _previous_cpu[1]) / (current[0] - _previous_cpu[0])))), 2)
        _previous_cpu = current
        memory = {row.split(':', 1)[0]: int(row.split()[1]) for row in Path('/proc/meminfo').read_text().splitlines() if ':' in row}
        output['memoryTotalBytes'] = memory['MemTotal'] * 1024
        if memory.get('SwapTotal', 0) > 0:
            output['swapUsedPercent'] = round(100 * (1 - memory['SwapFree'] / memory['SwapTotal']), 2)
        received = sent = 0
        for row in Path('/proc/net/dev').read_text().splitlines()[2:]:
            name, values = row.split(':', 1)
            if name.strip() == 'lo':
                continue
            fields = values.split()
            received += int(fields[0]); sent += int(fields[8])
        output['networkRxBytes'] = received; output['networkTxBytes'] = sent
    except (OSError, ValueError, IndexError, KeyError):
        pass  # Missing counters are omitted, never fabricated as zero usage.
    return output
