const SEARCH_QUERIES = Object.freeze([
  'AI Engineer', 'AI Engineering', 'Applied AI', 'Generative AI', 'AI Developer',
  'LLM Engineer', 'LLM Developer', 'AI Backend', 'Software Engineer AI',
  'Prompt Engineer', 'Prompt Engineering', 'промпт', 'промт-инженер', 'Context Engineering',
  'AI Agent', 'Agentic AI', 'AI-ассистент', 'ИИ-агент',
  'AI Enablement', 'AI Implementation', 'AI Solutions', 'AI Solution', 'внедрение ИИ',
  'AI Automation', 'автоматизация AI', 'автоматизация LLM', 'n8n', 'Make AI',
  'AI System Analyst', 'AI Business Analyst', 'аналитик AI', 'RAG',
  'Conversational AI', 'Conversation Designer', 'чат-бот',
  'AI Tester', 'AI QA', 'LLM QA', 'LLM Evaluation', 'AI Quality',
  'Junior AI', 'Junior ML', 'AI Intern', 'ML Intern', 'стажёр ИИ',
  'Machine Learning', 'ML Engineer', 'NLP Engineer', 'Research Engineer', 'Research Scientist',
  'дообучение моделей', 'fine-tuning',
]);

function defaultJobSettings() {
  return { queries: [...SEARCH_QUERIES], exclusions: [], targetRub: 100000,
    officeCity: 'Москва', remote: true, historyDays: 14, intervalMs: 1800000,
    budgetUsd: 3, model: '', paused: false, activated: false };
}

module.exports = { SEARCH_QUERIES, defaultJobSettings };
