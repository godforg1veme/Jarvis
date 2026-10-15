function classifyPage({ status = 0, pathname = '', text = '', iframeSources = [], vacancyLinks = 0, vacancyContent = false }) {
  const count = Number.isInteger(vacancyLinks) ? Math.min(Math.max(vacancyLinks, 0), 1000) : 0;
  const content = String(text).slice(0, 64000);
  const challenges = new Set();
  for (const source of iframeSources.slice(0, 100)) {
    let url; try { url = new URL(source); } catch { continue; }
    if (['smartcaptcha.yandexcloud.net', 'smartcaptcha.cloud.yandex.ru'].includes(url.hostname)) challenges.add('yandex_smartcaptcha');
    else if (['www.google.com', 'www.recaptcha.net'].includes(url.hostname) && url.pathname.includes('/recaptcha/')) challenges.add('recaptcha');
    else if (url.hostname === 'hcaptcha.com' || url.hostname.endsWith('.hcaptcha.com')) challenges.add('hcaptcha');
    else if (url.hostname === 'challenges.cloudflare.com') challenges.add('cloudflare_challenge');
  }
  let state = 'unknown';
  if (status === 429) state = 'rate_limited';
  else if (challenges.size || /подтвердите.{0,30}не робот|введите.{0,25}(?:символы|код с картинки)|капч[ау]|verify you are human/iu.test(content)) {
    state = 'captcha'; if (!challenges.size) challenges.add('unspecified_captcha');
  } else if ([401, 403].includes(status) || /access denied|доступ (?:временно )?(?:запрещ[её]н|ограничен)|checking your browser|проверка (?:вашего )?браузера|ddos-guard|just a moment/iu.test(content)) state = 'access_denied';
  else if (pathname.startsWith('/account/login') || pathname.startsWith('/login')) state = 'login_required';
  else if (status >= 200 && status < 300 && pathname === '/search/vacancy' && count > 0) state = 'search';
  else if (status >= 200 && status < 300 && /^\/vacancy\/\d+\/?$/.test(pathname) && vacancyContent) state = 'vacancy';
  return { state, challenges: [...challenges].sort(), vacancyLinks: count };
}
function classifySession(input) {
  const observation = classifyPage(input);
  if (['captcha', 'access_denied', 'rate_limited', 'login_required'].includes(observation.state)) {
    return { authenticated: false, state: observation.state, challenges: observation.challenges };
  }
  const privateRoute = /^\/applicant\/(?:resumes|my_resumes|profile)(?:\/[a-zA-Z0-9_-]{1,100})?\/?$/.test(input.pathname || '');
  const authenticated = input.status === 200 && privateRoute && /Мои резюме/iu.test(String(input.text || '').slice(0, 64000));
  return { authenticated, state: authenticated ? 'authenticated' : 'unknown', challenges: [] };
}
module.exports = { classifyPage, classifySession };
