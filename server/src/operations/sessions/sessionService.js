const { createCredential, credentialHash } = require('./sessionCredentials');
class SessionService {
  constructor(options) { this.repository = options.repository; }
  async request({ label, metadata }) { const verifier = createCredential(); const request = await this.repository.createRequest({ verifierHash: credentialHash(verifier), label, metadata }); return { request, verifier }; }
  async poll({ requestId, verifier, label, metadata }) {
    const hash = credentialHash(verifier); const request = await this.repository.getRequest({ id: requestId, verifierHash: hash });
    if (!request) return { state: 'not_found' };
    if (request.state !== 'approved') return { state: request.state };
    const credential = createCredential(); const session = await this.repository.consumeApproved({ id: requestId, verifierHash: hash, credentialHash: credentialHash(credential), label, metadata });
    return session ? { state: 'approved', credential, session } : { state: 'consumed' };
  }
  async decide(input) { return this.repository.decide(input); }
  async listSessions(currentSessionId) {
    const sessions = await this.repository.listActiveSessions();
    return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
  }
  async revokeSession({ sessionId, currentSessionId }) {
    const session = await this.repository.revokeSession(sessionId, sessionId === currentSessionId ? 'self_logout' : 'owner_forget');
    return { revoked: Boolean(session), current: sessionId === currentSessionId };
  }
}
module.exports = { SessionService };
