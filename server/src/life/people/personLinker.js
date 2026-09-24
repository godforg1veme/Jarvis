const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function normalizeName(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function containsName(text, name) {
  if (!name) return false;
  return ` ${text} `.includes(` ${name} `);
}

class PersonLinker {
  constructor(options = {}) {
    this.peopleRepository = options.peopleRepository;
    this.projectionRepository = options.projectionRepository;
    this.classify = typeof options.classify === 'function' ? options.classify : null;
  }

  async link(event) {
    const people = await this.peopleRepository.listPeople({ userId: event.user_id, includeArchived: false, limit: 100 });
    if (!people.length) return null;
    const text = normalizeName(event.summary);
    const exact = people.filter((person) => [person.display_name, ...(Array.isArray(person.aliases) ? person.aliases : [])]
      .some((name) => containsName(text, normalizeName(name))));
    if (exact.length === 1) return this._persist(event, exact[0], 'trusted', 1);
    if (exact.length > 1 || !this.classify) return exact.length > 1 ? { ambiguous: true, candidates: exact.length } : null;
    let candidate = null;
    try {
      candidate = await this.classify({
        summary: String(event.summary || '').slice(0, 1000),
        people: people.slice(0, 50).map((person) => ({ id: person.id, displayName: person.display_name, aliases: (person.aliases || []).slice(0, 8) })),
      });
    } catch (_) {
      return null;
    }
    if (!candidate || !UUID.test(String(candidate.personId || '')) || Number(candidate.confidence) < 0.7) return null;
    const person = people.find((item) => item.id === candidate.personId);
    return person ? this._persist(event, person, 'inferred', Math.min(Number(candidate.confidence), 0.95)) : null;
  }

  async _persist(event, person, origin, confidence) {
    const link = await this.projectionRepository.createLink({
      userId: event.user_id, eventId: event.id, targetType: 'person', targetId: person.id,
      relationType: 'person.mentioned', origin, confidence,
    });
    return link ? { link, person } : null;
  }
}

module.exports = { PersonLinker, containsName, normalizeName };
