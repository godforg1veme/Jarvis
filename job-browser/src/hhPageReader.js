const fail = (code = 'JOB_HH_DOM_CHANGED') => { throw Object.assign(new Error(code), { code }); };
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function readSalary(value) {
  const source = text(value, 1000).replace(/[\u00a0\u202f]/g, ' ');
  const match = /^(?:(от|до)\s+)?(\d[\d ]*)(?:\s*(?:до|[–—-])\s*(\d[\d ]*))?\s*(₽|руб\.?|RUB|RUR|\$|USD|€|EUR)(?![a-zа-яё])(.*)$/iu.exec(source);
  if (!match) return null;
  const low = Number(match[2].replace(/ /g, '')), high = match[3] ? Number(match[3].replace(/ /g, '')) : null;
  if (!(low > 0) || (high !== null && (!(high >= low) || !Number.isFinite(high))) || !Number.isFinite(low)) return null;
  return { from: match[1]?.toLowerCase() === 'до' ? null : low, to: high ?? (match[1]?.toLowerCase() === 'до' ? low : null),
    currency: /\$|USD/i.test(match[4]) ? 'USD' : /€|EUR/i.test(match[4]) ? 'EUR' : 'RUB',
    gross: /на руки|после (?:вычета )?налог/iu.test(match[5]) ? false : /до вычета налог/iu.test(match[5]) ? true : null,
    period: /за месяц|в месяц|ежемесячно/iu.test(match[5]) && !/бонус|преми|kpi/iu.test(match[5]) ? 'month' : 'unknown' };
}

function hhId(value, kind) {
  try {
    const url = new URL(value, 'https://hh.ru');
    const pattern = kind === 'resume' ? /^\/resume\/([a-zA-Z0-9]{1,100})\/?$/ : /^\/vacancy\/(\d{1,20})\/?$/;
    if (url.protocol !== 'https:' || url.hostname !== 'hh.ru' || url.port || url.username || url.password) return null;
    return pattern.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

function normalizeSearch(raw) {
  if (!raw || !Array.isArray(raw.cards) || !Array.isArray(raw.pageLinks)) fail();
  const heading = text(raw.heading, 1000).replace(/[\s\u00a0\u202f]/g, '');
  const foundText = /^(?:Найден[оаы]?)?(\d+)(?:ваканси|предложени)/iu.exec(heading);
  // Live HH uses a separate empty block rather than a numeric zero heading.
  const explicitEmpty = raw.emptyMarker === true && /^Позапросу.+ничегоненайдено$/iu.test(heading);
  if (!foundText && !explicitEmpty) fail();
  const found = foundText ? Number(foundText[1]) : 0;
  if (!Number.isSafeInteger(found) || found < 0 || found > 1000000 || raw.cards.length > 20) fail();
  const ids = raw.cards.map((links) => {
    if (!Array.isArray(links)) fail();
    const unique = [...new Set(links.map((link) => hhId(link, 'vacancy')).filter(Boolean))];
    if (unique.length !== 1) fail();
    return unique[0];
  });
  if (new Set(ids).size !== ids.length || (found > 0 && !ids.length) || (!found && ids.length)) fail();
  const pages = Math.ceil(found / 20);
  const pageIndex = raw.pageIndex ?? 0;
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= Math.max(1, pages)
    || ids.length !== Math.min(20, Math.max(0, found - pageIndex * 20))) fail();
  const observedPages = raw.pageLinks.map((link) => {
    try {
      const url = new URL(link, 'https://hh.ru');
      if (url.origin !== 'https://hh.ru' || url.pathname !== '/search/vacancy') fail();
      const value = url.searchParams.get('page');
      if (!/^\d{1,5}$/.test(value || '')) fail();
      return Number(value) + 1;
    } catch { fail(); }
  });
  if (pages > 1 && !observedPages.includes(pages)) fail('JOB_COLLECTION_WINDOW_SATURATED');
  if (observedPages.some((n) => n > pages)) fail();
  return { items: ids.map((id) => ({ id })), found, pages };
}

function normalizeVacancy(raw, externalId) {
  if (!/^\d{1,20}$/.test(String(externalId)) || hhId(raw?.url, 'vacancy') !== String(externalId)) fail();
  const postings = [];
  for (const source of (raw.jsonLd || []).slice(0, 20)) {
    if (typeof source !== 'string' || source.length > 512000) fail();
    let parsed; try { parsed = JSON.parse(source); } catch { continue; }
    const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
    postings.push(...values.filter((entry) => entry?.['@type'] === 'JobPosting'));
  }
  if (postings.length !== 1) fail();
  const job = postings[0];
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(job.datePosted || '')
    || !Number.isFinite(Date.parse(job.datePosted)) || !text(job.title, 500) || !text(raw.description, 100000)) fail();
  const location = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation;
  const format = text(raw.workFormat, 200).replace(/\s+/gu, ' ').replace(/^Формат работы:\s*/iu, '');
  const workFormat = /^Удал[её]нно$/iu.test(format) ? 'remote' : /^Гибрид$/iu.test(format) ? 'hybrid'
    : /^(?:На месте работодателя|В офисе)$/iu.test(format) ? 'office' : 'unknown';
  // Missing tax status, period or amounts must remain unknown rather than becoming net monthly pay.
  const salaryValue = job.baseSalary?.value;
  const currency = text(job.baseSalary?.currency, 10);
  const amount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const from = amount(salaryValue?.minValue ?? salaryValue?.value);
  const to = amount(salaryValue?.maxValue ?? salaryValue?.value);
  const salary = readSalary(raw.salaryText) || (currency && (from !== null || to !== null) ? { from, to, currency,
    gross: null, period: salaryValue?.unitText === 'MONTH' ? 'month' : 'unknown' } : null);
  return { externalId: String(externalId), title: text(job.title, 500),
    company: text(job.hiringOrganization?.name, 500), description: text(raw.description, 100000),
    city: text(location?.address?.addressLocality, 200), workFormat, remoteRestriction: 'unknown', salary,
    employment: text(raw.employment || (Array.isArray(job.employmentType) ? job.employmentType.join(', ') : job.employmentType), 150),
    url: `https://hh.ru/vacancy/${externalId}`, publishedAt: new Date(job.datePosted).toISOString(),
    archived: raw.archived === true, manualRequired: raw.manualRequired === true, experience: text(raw.experience, 150) };
}

async function readSearchPage(page) {
  const raw = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent?.slice(0, 1000) || '',
    emptyMarker: [...document.querySelectorAll('[data-qa="empty-vacancy-search-block"]')]
      .some((node) => node.getClientRects().length > 0 && /Ничего не нашлось/iu.test(node.textContent.replace(/\s+/gu, ' '))),
    pageIndex: Number(new URL(location.href).searchParams.get('page') || 0),
    cards: [...document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]')].slice(0, 21)
      .map((card) => [...card.querySelectorAll('a[href]')].slice(0, 100).map((a) => a.href)),
    pageLinks: [...document.querySelectorAll('[data-qa="pager-page"] a[href], a[data-qa="pager-page"][href]')]
      .slice(0, 100).map((a) => a.href),
  }));
  return normalizeSearch(raw);
}

async function readVacancyPage(page, externalId) {
  const raw = await page.evaluate(() => ({ url: location.href,
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20).map((s) => s.textContent.slice(0, 512001)),
    description: (() => {
      const descriptions = [...document.querySelectorAll('[data-qa="vacancy-description"]')];
      const first = descriptions[0];
      const visible = first && first.getClientRects().length && getComputedStyle(first).visibility === 'visible'
        ? first.innerText?.slice(0, 100001) || '' : '';
      if (visible.trim()) return visible.length > 100000 ? '' : visible;
      // HH branded vacancy text is kept in a hidden static-markup container.
      // Admit only its single declared description, never arbitrary hidden DOM.
      if (descriptions.length !== 1) return '';
      const container = descriptions[0].closest('.HH-ContainerForStarticMarkup-Hidden-branded-vacancy.g-invisible');
      if (!container || !descriptions[0].matches('.vacancy-branded-user-content[data-qa="vacancy-description"]')) return '';
      const excluded = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
      const blocks = new Set(['ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'BR', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL']);
      let output = '', tooLong = false;
      const append = value => { if (output.length + value.length > 100000) tooLong = true; else output += value; };
      const stack = [{ node: descriptions[0], closing: false }];
      let visited = 0;
      while (stack.length && !tooLong) {
        const { node, closing } = stack.pop();
        if (++visited > 20000) { tooLong = true; break; }
        if (node.nodeType === Node.TEXT_NODE) { append(node.nodeValue || ''); continue; }
        if (node.nodeType !== Node.ELEMENT_NODE || excluded.has(node.tagName)) continue;
        const block = blocks.has(node.tagName);
        if (closing) { if (block && output && !output.endsWith('\n')) append('\n'); continue; }
        if (block && output && !output.endsWith('\n')) append('\n');
        if (block) stack.push({ node, closing: true });
        for (let child = node.lastChild; child; child = child.previousSibling) {
          if (stack.length + visited >= 20000) { tooLong = true; break; }
          stack.push({ node: child, closing: false });
        }
      }
      return tooLong ? '' : output.replace(/\n[\t ]+/gu, '\n').replace(/[\t ]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
    })(),
    experience: document.querySelector('[data-qa="work-experience-text"]')?.textContent?.slice(0, 150) || '',
    workFormat: document.querySelector('[data-qa="work-formats-text"]')?.textContent?.slice(0, 200) || '',
    salaryText: document.querySelector('[data-qa="vacancy-salary"]')?.textContent?.slice(0, 1000) || '',
    employment: document.querySelector('[data-qa="common-employment-text"]')?.textContent?.slice(0, 150) || '',
    archived: Boolean(document.querySelector('[data-qa="vacancy-archived"]')),
    manualRequired: Boolean(document.querySelector('[data-qa="vacancy-response-link-test"]')),
  }));
  return normalizeVacancy(raw, externalId);
}

async function readResumes(page) {
  const cards = await page.locator('[data-qa="resume"]').evaluateAll((nodes) => nodes.slice(0, 21).map((card) => ({
    title: card.querySelector('[data-qa="resume-title"]')?.textContent?.slice(0, 500) || '',
    links: [...card.querySelectorAll('a[href]')].slice(0, 100).map((a) => a.href),
    canRaise: (() => { const controls=[...card.querySelectorAll('button[data-qa~="resume-update-button_actions"]')]
      .filter(n=>n.getClientRects().length && /^(?:Поднять(?: в поиске)?|Обновить)$/u.test(n.textContent.trim()));
      return controls.length===1 ? !controls[0].disabled : null; })(),
  })));
  if (!cards.length || cards.length > 20) fail();
  const records = cards.map((card) => {
    const ids = [...new Set(card.links.map((link) => hhId(link, 'resume')).filter(Boolean))];
    if (ids.length !== 1 || !text(card.title, 500)) fail();
    return { id: ids[0], title: text(card.title, 500), ...(typeof card.canRaise === 'boolean' ? { canRaise: card.canRaise } : {}) };
  });
  if (new Set(records.map((record) => record.id)).size !== records.length) fail();
  return records;
}

module.exports = { hhId, readSalary, normalizeSearch, normalizeVacancy, readSearchPage, readVacancyPage, readResumes };
