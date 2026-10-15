const { assertJobScope, jobError } = require('./jobSchemas');
const { response, button } = require('./jobTelegramViews');

// The owner has already logged in and selected the primary resume in the browser.
// This path only verifies it and synchronizes local metadata; it cannot change HH.
class JobBrowserConnectionService {
  constructor({ pool, browserClient }) { Object.assign(this, { pool, browserClient }); }
  async handle({ scope, action }) {
    await assertJobScope(this.pool, scope);
    if (action !== 'connect') return response('Основное резюме выбрано владельцем в браузере. Для изменения подключения нужна отдельная настройка.',
      [[button('В поиск работы', 'menu')]]);
    const selected = await this.browserClient.connection(scope.userId);
    const saved = await this.pool.query(`INSERT INTO job_connections(user_id,resume_id,status)
      VALUES($1,$2,'connected') ON CONFLICT(user_id) DO UPDATE SET status='connected',
      revision=job_connections.revision + CASE WHEN job_connections.status='connected' THEN 0 ELSE 1 END,
      updated_at=now() WHERE job_connections.resume_id=EXCLUDED.resume_id RETURNING id`, [scope.userId, selected.resumeId]);
    if (!saved.rowCount) throw jobError('JOB_REVISION_CONFLICT');
    return response(`HH подключён. Основное резюме: ${selected.title}.`, [[button('В поиск работы', 'menu')]]);
  }
}
module.exports = { JobBrowserConnectionService };
