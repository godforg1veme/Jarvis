const { jobError } = require('./jobSchemas');

class CurrencyRates {
  constructor({ fetchImpl = globalThis.fetch } = {}) { this.fetch = fetchImpl; this.cache = null; }
  async get({ date = new Date() } = {}) {
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(date);
    if (this.cache?.requestedDate === day) return this.cache;
    const response = await this.fetch('https://www.cbr.ru/scripts/XML_daily.asp', { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok || !response.body) throw jobError('JOB_RATES_UNAVAILABLE');
    const reader = response.body.getReader(); let total = 0; const chunks = [];
    try {
      for (;;) { const part = await reader.read(); if (part.done) break;
        total += part.value.byteLength;
        if (total > 128 * 1024) { await reader.cancel(); throw jobError('JOB_RATES_UNAVAILABLE'); }
        chunks.push(Buffer.from(part.value)); }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString('latin1');
    const dateMatch = text.match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/);
    if (!dateMatch || /<!DOCTYPE|<!ENTITY/i.test(text)) throw jobError('JOB_RATES_UNAVAILABLE');
    const rateDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    const rates = { RUB: 1 };
    for (const entry of text.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
      const code = entry[1].match(/<CharCode>([A-Z]{3})<\/CharCode>/)?.[1];
      const nominal = Number(entry[1].match(/<Nominal>(\d+)<\/Nominal>/)?.[1]);
      const value = Number(entry[1].match(/<Value>([\d,]+)<\/Value>/)?.[1]?.replace(',', '.'));
      if (code && nominal > 0 && value > 0) rates[code] = value / nominal;
    }
    this.cache = { requestedDate: day, date: rateDate, fresh: rateDate === day, rates };
    return this.cache;
  }
}

module.exports = { CurrencyRates };
