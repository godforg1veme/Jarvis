const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { accessError } = require('../access/accessPolicy');
const COOKIE = '__Host-jarvis-mini';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const csrfFor = (token) => hash(`jarvis-mini-csrf:${token}`);
function readToken(request) {
  const cookies = String(request.headers.cookie || '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${COOKIE}=`));
  if (cookies.length !== 1) return null;
  const token = cookies[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
class SessionService {
  constructor({ pool, accessService }) {
    this.pool = pool;
    this.accessService = accessService;
  }
  async create(telegramId) {
    return this.accessService.transaction(async (db) => {
      const actor = await this.accessService.repository.get(
        db,
        'telegram',
        telegramId,
      );
      if (!actor || actor.blocked) throw accessError('forbidden');
      const token = randomBytes(32).toString('hex'),
        csrfToken = csrfFor(token);
      await db.query('DELETE FROM mini_app_sessions WHERE expires_at<=now()');
      await db.query(
        "INSERT INTO mini_app_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
        [hash(token), hash(csrfToken), actor.userId],
      );
      return { token, csrfToken, actor };
    });
  }
  async requireSession(request) {
    const token = readToken(request);
    if (!token) throw accessError('unauthorized');
    const row = (
      await this.pool.query(
        'SELECT user_id,csrf_hash FROM mini_app_sessions WHERE token_hash=$1 AND expires_at>now()',
        [hash(token)],
      )
    ).rows[0];
    if (!row) throw accessError('unauthorized');
    const actor = await this.accessService.getAccessForUser(row.user_id);
    if (!actor || actor.blocked) throw accessError('forbidden');
    return { actor, token, csrfToken: csrfFor(token), csrfHash: row.csrf_hash };
  }
  requireCsrf(request, session) {
    const csrf = request.headers['x-jarvis-csrf'];
    if (
      typeof csrf !== 'string' ||
      csrf.length !== 64 ||
      !timingSafeEqual(Buffer.from(hash(csrf)), Buffer.from(session.csrfHash))
    )
      throw accessError('invalid_csrf');
  }
  async revoke(token) {
    await this.pool.query('DELETE FROM mini_app_sessions WHERE token_hash=$1', [
      hash(token),
    ]);
  }
}
function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${token ? 1800 : 0}`;
}
module.exports = { SessionService, sessionCookie, readToken, hash };
