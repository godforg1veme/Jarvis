const unknown = () => ({ mode: 'unknown', complete: false, employerIds: [] });

function evaluatePrivacy({ privacy, employerId }) {
  if (!privacy?.complete || typeof employerId !== 'string' || !/^\d{1,20}$/.test(employerId)
    || !Array.isArray(privacy.employerIds) || !privacy.employerIds.every((id) => /^\d{1,20}$/.test(id))) {
    return { allowed: false, reasonCode: 'JOB_HH_PRIVACY_UNVERIFIED' };
  }
  if (privacy.mode === 'clients') return { allowed: true, reasonCode: null };
  if (privacy.mode !== 'blacklist') return { allowed: false, reasonCode: 'JOB_HH_PRIVACY_UNVERIFIED' };
  return privacy.employerIds.includes(employerId) ? { allowed: false, reasonCode: 'JOB_HH_EMPLOYER_BLOCKED' }
    : { allowed: true, reasonCode: null };
}

async function visibleOne(locator) {
  const visible = [];
  for (const node of (await locator.all()).slice(0, 21)) if (await node.isVisible()) visible.push(node);
  return visible.length === 1 ? visible[0] : null;
}

async function readEmployerId(page) {
  const ids = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('[data-qa="vacancy-company"], [data-qa="vacancy-company-name"]')];
    const links = roots.flatMap((node) => [...node.querySelectorAll('a[href]'), ...(node.matches('a[href]') ? [node] : [])]);
    return [...new Set(links.slice(0, 100).map((a) => {
      try { const url = new URL(a.href); return url.origin === 'https://hh.ru' && !url.username && !url.password
        ? /^\/employer\/(\d{1,20})\/?$/.exec(url.pathname)?.[1] : null; } catch { return null; }
    }).filter(Boolean))];
  });
  return ids.length === 1 ? ids[0] : null;
}

// Opens settings and the existing list for reading only. Never selects a radio, removes an employer or saves.
async function readResumePrivacy(page, { resumeId, observe = null }) {
  const mark = (phase) => { try { observe?.(phase); } catch {} };
  try {
    mark('resume');
    const url = new URL(page.url());
    if (url.origin !== 'https://hh.ru' || url.pathname !== `/resume/${resumeId}`) return unknown();
    const card = await visibleOne(page.locator('[data-qa="resume-visibility-card"]'));
    if (!card) return unknown();
    await card.click({ timeout: 5000 });
    await page.locator('[data-qa^="resume-visibility-card-access-type-"]').first().waitFor({ state: 'attached', timeout: 5000 });
    mark('settings');
    const selected = await page.locator('[data-qa^="resume-visibility-card-access-type-"]').evaluateAll((nodes) =>
      [...new Set(nodes.filter((node) => [...node.querySelectorAll('input[type="radio"]')].some((input) => input.checked))
        .map((node) => node.getAttribute('data-qa').replace('resume-visibility-card-access-type-', '')))]);
    if (selected.length !== 1) return unknown();
    mark('mode');
    if (selected[0] === 'clients') return { mode: 'clients', complete: true, employerIds: [] };
    if (selected[0] !== 'blacklist') return unknown();
    const activator = await visibleOne(page.locator('[data-qa="applicant-employers-list-activator-blacklist"]'));
    if (!activator) return unknown();
    await activator.click({ timeout: 5000 });
    await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 5000 });
    mark('dialog');
    const dialog = await visibleOne(page.locator('[role="dialog"]'));
    if (!dialog) return unknown();
    const search = dialog.locator('[data-qa="resume-editor-employer-list-search-input"]');
    await search.waitFor({ state: 'visible', timeout: 5000 });
    if (await search.count() !== 1 || await search.inputValue() !== '') return unknown();
    await page.waitForTimeout(500);
    mark('list');
    const snapshot = () => dialog.evaluate((root) => {
      const rows = [...root.querySelectorAll('[data-qa^="resume-editor-employer-list-item-"]')];
      const ids = rows.map((node) => /^resume-editor-employer-list-item-(\d{1,20})$/.exec(node.getAttribute('data-qa'))?.[1]);
      if (rows.length > 1000 || !ids.every(Boolean) || new Set(ids).size !== ids.length) return { failure: 'list_rows' };
      const rowSelector = '[data-qa^="resume-editor-employer-list-item-"]';
      if (root.querySelectorAll('[data-qa="resume-employer-list-item-delete"]').length !== rows.length
        || !rows.every((node) => {
          let group = node;
          for (let level = 0; group && level < 4 && root.contains(group); level++, group = group.parentElement) {
            const rowCount = group.querySelectorAll(rowSelector).length + (group.matches(rowSelector) ? 1 : 0);
            if (rowCount === 1 && group.querySelectorAll('[data-qa="resume-employer-list-item-delete"]').length === 1) return true;
          }
          return false;
        })) return { failure: 'list_controls' };
      if (!rows.every((node, index) => [...node.querySelectorAll('a[href]')].some((a) => { try { const url = new URL(a.href);
        return url.origin === 'https://hh.ru' && !url.username && !url.password && url.pathname === `/employer/${ids[index]}`;
      } catch { return false; } }))) return { failure: 'list_links' };
      const knownButtons = [...root.querySelectorAll('button')].every((node) => !node.innerText.trim()
        || ['Назад', 'Очистить список', 'Готово'].includes(node.innerText.trim()));
      return knownButtons ? { ids: ids.sort() } : { failure: 'list_buttons' };
    });
    const initial = await snapshot(); if (!initial.ids) { mark(initial.failure); return unknown(); }
    const before = initial.ids;
    mark('snapshot');
    const scroll = dialog.locator('[data-qa="modal-content-scroll-container"]');
    if (await scroll.count() > 1) return unknown();
    if (await scroll.count() === 1) await scroll.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await page.waitForTimeout(500);
    const final = await snapshot(), after = final.ids;
    // Virtualized, paged or still loading lists cannot authorize an absent employer.
    if (!after || JSON.stringify(before) !== JSON.stringify(after)) return unknown();
    mark('verified');
    return { mode: 'blacklist', complete: true, employerIds: after };
  } catch { return unknown(); }
}
module.exports = { readResumePrivacy, readEmployerId, evaluatePrivacy };
