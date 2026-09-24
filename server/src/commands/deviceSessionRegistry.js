class DeviceSessionRegistry {
  constructor() {
    this.sessions = new Map();
  }

  register(device, socket) {
    const entry = { deviceId: device.id, userId: device.user_id, socket };
    const previous = this.sessions.get(device.id);
    if (previous && previous.socket !== socket) {
      try { previous.socket.close(1000, 'replaced by a newer session'); } catch (_) {}
    }
    this.sessions.set(device.id, entry);
    return () => {
      if (this.sessions.get(device.id)?.socket === socket) this.sessions.delete(device.id);
    };
  }

  get(deviceId) {
    return this.sessions.get(String(deviceId || '')) || null;
  }

  isCurrent(deviceId, socket) {
    return this.sessions.get(String(deviceId || ''))?.socket === socket;
  }

  unregister(deviceId, socket) {
    if (!this.isCurrent(deviceId, socket)) return false;
    this.sessions.delete(String(deviceId || ''));
    return true;
  }

  send(deviceId, message) {
    const session = this.get(deviceId);
    if (!session || !session.socket || session.socket.readyState !== 1) return false;
    session.socket.send(JSON.stringify(message));
    return true;
  }

  clear() {
    this.sessions.clear();
  }
}

module.exports = { DeviceSessionRegistry };
