class EchoProvider {
  constructor() {
    this.name = 'echo';
  }

  async answer({ text }) {
    const normalized = String(text || '').trim();
    return `Jarvis получил: ${normalized}`;
  }
}

module.exports = { EchoProvider };
