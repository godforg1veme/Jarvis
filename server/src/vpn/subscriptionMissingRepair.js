const crypto = require('node:crypto');

const ENDPOINTS = [['de', 'hy2'], ['de', 'vless'], ['nl', 'hy2'], ['nl', 'vless']];
const CLIENT_ID = /^vpn-[a-f0-9]{12}$/;
function bindings(sub) {
  return Object.fromEntries(['de', 'nl'].map((node) => {
    const raw = sub[`client_id_${node}`] ?? sub[node === 'de' ? 'clientIdDe' : 'clientIdNl'];
    return [node, typeof raw === 'string' ? JSON.parse(raw) : raw];
  }));
}
function operation(protocol, verb) {
  return protocol === 'hy2' ? `vpn.hysteria2.client.${verb}` : `vpn.client.${verb}`;
}
function childId(parent, node, protocol) {
  const bytes = crypto.createHash('sha256').update(`${parent}:${node}:${protocol}:issue`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function missingEndpoints(service, sub) {
  const ids = bindings(sub);
  const missing = [];
  for (const [node, protocol] of ENDPOINTS) {
    const clientId = ids[node]?.[protocol];
    if (!CLIENT_ID.test(clientId || '')) throw new Error('BINDING_INVALID');
    const response = await service._request(operation(protocol, 'export'), { clientId }, undefined, node);
    if (response?.result?.state === 'failed' && response.result.errorCode === 'VPN_CLIENT_NOT_FOUND') {
      missing.push({ node, protocol, clientId });
    } else if (response?.result?.state !== 'succeeded' || !response.result.data?.shareUri) {
      throw new Error('EXPORT_UNAVAILABLE');
    }
  }
  return missing;
}

async function executeMissingRepair(service, record, sub) {
  const targets = record.arguments.missing;
  if (!Array.isArray(targets) || !targets.length || targets.length > 4) throw new Error('INVALID_TARGETS');
  const currentMissing = await missingEndpoints(service, sub);
  if (JSON.stringify(currentMissing) !== JSON.stringify(targets)) throw new Error('STALE_TARGETS');
  const ids = bindings(sub);
  const checkpoint = { subscriptionId: sub.id, operations: targets.map(({ node, protocol }) => ({ node, protocol, requestId: childId(record.id, node, protocol) })) };
  // Persist every mutation identifier before sending any mutation to Host Agent.
  await service.repository.complete({ requestId: record.id, status: 'running', result: checkpoint });
  for (const target of targets) {
    const requestId = childId(record.id, target.node, target.protocol);
    const response = await service._request(operation(target.protocol, 'issue'), {
      label: `Подписка ${sub.id.slice(0, 8)} ${target.protocol} ${record.id.slice(0, 6)}`,
    }, requestId, target.node);
    const newId = response?.result?.state === 'succeeded' ? response.result.data?.client?.id : null;
    if (!CLIENT_ID.test(newId || '')) throw new Error('ISSUE_UNCERTAIN');
    const expected = { de: { ...ids.de }, nl: { ...ids.nl } };
    ids[target.node][target.protocol] = newId;
    checkpoint.operations.find((item) => item.requestId === requestId).clientId = newId;
    await service.repository.complete({ requestId: record.id, status: 'running', result: checkpoint });
    const saved = await service.subscriptionService.repository.replaceBindings({ id: sub.id, userId: sub.userId, expected, replacement: ids });
    if (!saved) throw new Error('BIND_UNCERTAIN');
  }
  await service.repository.complete({ requestId: record.id, status: 'succeeded', result: checkpoint });
}

module.exports = { missingEndpoints, executeMissingRepair };
