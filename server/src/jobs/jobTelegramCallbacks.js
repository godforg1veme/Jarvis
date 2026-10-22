const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const { parseSettingsCallback } = require('./jobSettingsControls');
const SIMPLE = /^job:(menu|settings|profile|base_letter|applications_sync|check|captcha|captcha_refresh|pause|resume|connect|disconnect|back|resumes|resumes_refresh)$/;
const TARGET = new RegExp(`^job:(view|prepare|base|improved|custom|custom_ai|application|application_refresh|save|hide|draft|regenerate|edit|translate|send|confirm|cancel|approve|cfg_ok|resume_select):(${UUID})$`, 'i');
const PAGE = /^job:(saved|applications):([0-9]{1,4})$/;
const RESUME_CHOICE = new RegExp(`^job:(rs_pick|rs_auto):(${UUID}):([0-9]{1,2})$`, 'i');
const RESUME_TARGET = new RegExp(`^job:(rs_ok|rs_status):(${UUID})$`, 'i');

function parseJobCallback(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 64 || /[\x00-\x20\x7f]/.test(value)) return null;
  const choice = RESUME_CHOICE.exec(value);
  if (choice) {
    const index=Number(choice[3]),action=choice[1].toLowerCase();
    if(String(index)!==choice[3]||index>(action==='rs_pick'?19:1))return null;
    return {action,targetId:choice[2].toLowerCase(),index};
  }
  const resume=RESUME_TARGET.exec(value);if(resume)return {action:resume[1].toLowerCase(),targetId:resume[2].toLowerCase()};
  const settings = parseSettingsCallback(value); if (settings) return settings;
  const simple = SIMPLE.exec(value); if (simple) return { action: simple[1] };
  const target = TARGET.exec(value); if (target) return { action: target[1].toLowerCase(), targetId: target[2].toLowerCase() };
  const page = PAGE.exec(value); if (page) return { action: page[1], page: Number(page[2]) };
  return null;
}
function isJobCallback(value) { return parseJobCallback(value) !== null; }
function isJobVacancyUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'hh.ru'
    && !url.username && !url.password && !url.port && /^\/vacancy\/\d{1,20}$/.test(url.pathname) && !url.search && !url.hash; }
  catch { return false; }
}
module.exports = { parseJobCallback, isJobCallback, isJobVacancyUrl };
