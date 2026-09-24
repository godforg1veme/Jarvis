const { isDeviceToken } = require('./deviceCredentials');

class DeviceAuthenticationError extends Error {
  constructor() {
    super('device authentication failed');
    this.name = 'DeviceAuthenticationError';
    this.statusCode = 401;
    this.publicCode = 'DEVICE_AUTH_REQUIRED';
  }
}

function readBearerToken(headers = {}) {
  const value = String(headers.authorization || '').trim();
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  const token = match ? match[1].trim() : '';
  if (!isDeviceToken(token)) throw new DeviceAuthenticationError();
  return token;
}

function createDeviceAuthenticator(deviceRepository) {
  return async function authenticate(headers) {
    let token;
    try {
      token = readBearerToken(headers);
    } catch (error) {
      throw error instanceof DeviceAuthenticationError ? error : new DeviceAuthenticationError();
    }
    try {
      const device = await deviceRepository.findActiveByToken(token);
      if (!device) throw new DeviceAuthenticationError();
      return device;
    } catch (error) {
      if (error instanceof DeviceAuthenticationError) throw error;
      throw error;
    }
  };
}

module.exports = {
  DeviceAuthenticationError,
  createDeviceAuthenticator,
  readBearerToken,
};
