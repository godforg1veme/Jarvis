const crypto = require('node:crypto');
const { validateExternalProbe } = require('../operations/vpnSupervisor/externalProbeMonitor');

const CLIENT_ID = /^vpn-[a-f0-9]{12}$/;
const NODES = new Set(['de', 'nl']);
const PROTOCOLS = new Set(['vless', 'hysteria2']);
const ACCEPTED_CHECK = Object.freeze({ vless: 'vless_tcp_8443', hysteria2: 'hysteria2_udp_hop' });
const PROBE_BINDINGS = Object.freeze({
  'de:vless': Object.freeze({ runnerNode: 'nl', label: 'Probe NL to DE VLESS' }),
  'de:hysteria2': Object.freeze({ runnerNode: 'nl', label: 'Probe NL to DE Hysteria' }),
  'nl:vless': Object.freeze({ runnerNode: 'de', label: 'Probe DE to NL VLESS' }),
  'nl:hysteria2': Object.freeze({ runnerNode: 'de', label: 'Probe DE to NL Hysteria' }),
});

class ProbeWorkflowError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function probeBindingFor({ sourceNode, protocol, clientId, label }) {
  const binding = probeRouteFor({ sourceNode, protocol });
  if (!binding || !CLIENT_ID.test(String(clientId || '')) || label !== binding.label) {
    throw new ProbeWorkflowError('PROBE_BINDING_INVALID');
  }
  return Object.freeze({ ...binding, clientId, label });
}

function probeRouteFor({ sourceNode, protocol, runnerNode }) {
  const binding = PROBE_BINDINGS[`${sourceNode}:${protocol}`];
  if (!binding || (runnerNode !== undefined && runnerNode !== binding.runnerNode)) {
    throw new ProbeWorkflowError('PROBE_BINDING_INVALID');
  }
  return Object.freeze({ sourceNode, runnerNode: binding.runnerNode, protocol, label: binding.label });
}

function uriForProtocol(value, protocol) {
  const uri = String(value || '');
  const expected = protocol === 'vless' ? 'vless://' : 'hy2://';
  if (!uri.startsWith(expected) || uri.length > 2048) throw new ProbeWorkflowError('PROBE_EXPORT_INVALID');
  return uri;
}

function operationFor(protocol, action) {
  const prefix = protocol === 'hysteria2' ? 'vpn.hysteria2.client.' : 'vpn.client.';
  return `${prefix}${action}`;
}

function resultOrThrow(response, unavailableCode, failedCode) {
  const result = response?.result;
  if (result?.state === 'succeeded') return result.data || {};
  throw new ProbeWorkflowError(result?.state === 'unknown' ? unavailableCode : failedCode);
}

class ProbeCredentialWorkflow {
  constructor({ clients, now = () => new Date(), verifiedBindings = async () => false }) {
    this.clients = clients || {};
    this.now = now;
    this.verifiedBindings = verifiedBindings;
  }

  _client(node) {
    if (!NODES.has(node) || !this.clients[node]) throw new ProbeWorkflowError('PROBE_RUNNER_UNAVAILABLE');
    return this.clients[node];
  }

  async _request(node, operation, requestArguments) {
    return this._client(node).request({
      version: 1,
      requestId: crypto.randomUUID(),
      operation,
      arguments: requestArguments,
      sentAt: this.now().toISOString(),
    });
  }

  async _transfer(binding, sourceAction) {
    const verified = probeBindingFor(binding);
    let credential = null;
    try {
      const exported = await this._request(verified.sourceNode, operationFor(verified.protocol, sourceAction), { clientId: verified.clientId });
      credential = uriForProtocol(resultOrThrow(exported, 'PROBE_EXPORT_UNKNOWN', 'PROBE_EXPORT_FAILED').shareUri, verified.protocol);
      const installed = await this._request(verified.runnerNode, 'vpn.external_probe.credential.install', {
        targetNode: verified.sourceNode,
        protocol: verified.protocol,
        credential,
      });
      const installData = resultOrThrow(installed, 'PROBE_INSTALL_UNKNOWN', 'PROBE_INSTALL_FAILED');
      const probed = await this._request(verified.runnerNode, 'vpn.external_probe.run', { targetNode: verified.sourceNode });
      const probeData = resultOrThrow(probed, 'PROBE_RUN_UNKNOWN', 'PROBE_RUN_FAILED');
      const snapshot = validateExternalProbe(probeData, verified.sourceNode, this.now());
      const acceptedCheck = ACCEPTED_CHECK[verified.protocol];
      const status = snapshot.checks[acceptedCheck].status;
      if (status !== 'healthy') {
        throw new ProbeWorkflowError(status === 'failed' ? 'PROBE_ACCEPTANCE_FAILED' : 'PROBE_ACCEPTANCE_UNKNOWN');
      }
      return {
        targetNode: verified.sourceNode,
        runnerNode: verified.runnerNode,
        protocol: verified.protocol,
        installedAt: String(installData.installedAt || '').slice(0, 40),
        acceptedCheck,
      };
    } finally {
      credential = null;
    }
  }

  install(binding) { return this._transfer(binding, 'export'); }
  rotate(binding) { return this._transfer(binding, 'rotate'); }

  async recheck(binding) {
    const route = probeRouteFor(binding);
    const response = await this._request(route.runnerNode, 'vpn.external_probe.run', { targetNode: route.sourceNode });
    const probeData = resultOrThrow(response, 'PROBE_RUN_UNKNOWN', 'PROBE_RUN_FAILED');
    const snapshot = validateExternalProbe(probeData, route.sourceNode, this.now());
    const acceptedCheck = ACCEPTED_CHECK[route.protocol];
    const status = snapshot.checks[acceptedCheck].status;
    if (status !== 'healthy') {
      throw new ProbeWorkflowError(status === 'failed' ? 'PROBE_ACCEPTANCE_FAILED' : 'PROBE_ACCEPTANCE_UNKNOWN');
    }
    return {
      targetNode: route.sourceNode,
      runnerNode: route.runnerNode,
      protocol: route.protocol,
      acceptedCheck,
    };
  }

  async enable() {
    if (!await this.verifiedBindings()) throw new ProbeWorkflowError('PROBE_ACCEPTANCE_INCOMPLETE');
    const first = await this._request('nl', 'vpn.external_probe.monitor.enable', { targetNode: 'de' });
    resultOrThrow(first, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
    let secondError;
    try {
      const second = await this._request('de', 'vpn.external_probe.monitor.enable', { targetNode: 'nl' });
      resultOrThrow(second, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
    } catch (error) {
      secondError = error;
    }
    if (secondError) {
      try {
        const compensation = await this._request('nl', 'vpn.external_probe.monitor.disable', { targetNode: 'de' });
        resultOrThrow(compensation, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
      } catch {
        throw new ProbeWorkflowError('PROBE_MONITOR_UNKNOWN');
      }
      throw new ProbeWorkflowError(secondError?.code === 'PROBE_MONITOR_FAILED' ? 'PROBE_MONITOR_FAILED' : 'PROBE_MONITOR_UNKNOWN');
    }
    return { monitoring: true };
  }

  async disable() {
    const [de, nl] = await Promise.all([
      this._request('nl', 'vpn.external_probe.monitor.disable', { targetNode: 'de' }),
      this._request('de', 'vpn.external_probe.monitor.disable', { targetNode: 'nl' }),
    ]);
    resultOrThrow(de, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
    resultOrThrow(nl, 'PROBE_MONITOR_UNKNOWN', 'PROBE_MONITOR_FAILED');
    return { monitoring: false };
  }
}

module.exports = { PROBE_BINDINGS, ProbeCredentialWorkflow, ProbeWorkflowError, probeBindingFor, probeRouteFor };
