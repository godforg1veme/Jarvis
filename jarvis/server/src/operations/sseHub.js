class SseHub {
  constructor(options = {}) {
    this.clients = new Map();
    this.nextEventId = 1;
    this.heartbeatMs = options.heartbeatMs || 25000;
  }

  subscribe(sessionId, response, lastEventId = '') {
    const client = { response, heartbeat: null };
    const sessionClients = this.clients.get(sessionId) || new Set();
    sessionClients.add(client);
    this.clients.set(sessionId, sessionClients);
    response.write('retry: 3000\n\n');
    if (lastEventId) response.write('event: refresh\ndata: {"reason":"reconnected"}\n\n');
    client.heartbeat = setInterval(() => response.write(': heartbeat\n\n'), this.heartbeatMs);
    const remove = () => this.remove(sessionId, client);
    response.on('close', remove);
    response.on('error', remove);
    return remove;
  }

  remove(sessionId, client) {
    if (client.heartbeat) clearInterval(client.heartbeat);
    client.heartbeat = null;
    const sessionClients = this.clients.get(sessionId);
    if (!sessionClients) return;
    sessionClients.delete(client);
    if (sessionClients.size === 0) this.clients.delete(sessionId);
  }

  publish(event, payload) {
    const id = String(this.nextEventId++);
    const data = JSON.stringify(payload);
    for (const sessionClients of this.clients.values()) {
      for (const client of sessionClients) client.response.write(`id: ${id}\nevent: ${event}\ndata: ${data}\n\n`);
    }
  }

  closeSession(sessionId) {
    const sessionClients = this.clients.get(sessionId);
    if (!sessionClients) return;
    for (const client of [...sessionClients]) {
      this.remove(sessionId, client);
      client.response.end();
    }
  }

  close() {
    for (const sessionId of [...this.clients.keys()]) this.closeSession(sessionId);
  }
}

module.exports = { SseHub };
