const fs = require('fs');
const path = require('path');

const ALIASES_PATH = path.join(__dirname, '..', 'data', 'app-aliases.json');

const COMMAND_TOKENS = ['/run', 'открой', 'открыть', 'запусти', 'запуск', 'run', 'open'];

function loadAliases() {
  try {
    const data = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
    return Array.isArray(data.aliases) ? data.aliases : [];
  } catch {
    return [];
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKnownAliasForms(query) {
  const exactReplacements = {
    'доту': 'дота',
  };

  return exactReplacements[query] || query;
}

function removeCommandTokens(query) {
  let result = query;

  for (const token of COMMAND_TOKENS) {
    const escapedToken = escapeRegExp(token);
    result = result.replace(new RegExp(`(^|\\s)${escapedToken}(?=\\s|$)`, 'gi'), ' ');
  }

  return result.trim().replace(/\s+/g, ' ');
}

function normalizeQuery(originalInput) {
  let query = (originalInput || '').toString().toLowerCase().trim();

  query = removeCommandTokens(query);
  return normalizeKnownAliasForms(query);
}

/**
 * Check if cleanedQuery matches aliasInput with strict rules:
 * - Exact match always OK
 * - Phrase match only if cleanedQuery contains the FULL aliasInput as a separate word/phrase
 * - No contains match for words shorter than 4 characters
 * - Don't match if only part of another word matches
 */
function strictPhraseMatch(cleanedQuery, aliasInput) {
  const normalizedAliasInput = normalizeQuery(aliasInput);
  if (!normalizedAliasInput) return false;

  // Exact match
  if (cleanedQuery === normalizedAliasInput) {
    return true;
  }

  // For short alias inputs (< 4 chars), don't do contains matching
  if (normalizedAliasInput.length < 4) {
    return false;
  }

  // Check if cleanedQuery contains the full normalizedAliasInput as a separate word/phrase
  // We'll use regex with word boundaries to ensure it's not partial matching
  const escapedAlias = escapeRegExp(normalizedAliasInput);
  const regex = new RegExp(`(^|\\s)${escapedAlias}(\\s|$)`, 'i');
  return regex.test(cleanedQuery);
}

function addUnique(list, value) {
  const normalized = (value || '').toString().trim().replace(/\s+/g, ' ');
  if (normalized && !list.includes(normalized)) {
    list.push(normalized);
  }
}

/**
 * Expand a natural-language app query into deterministic resolver variants.
 *
 * @param {string} originalInput - User's raw query.
 * @returns {Array<{query: string, source: string, priority: number}>} Unique query variants with metadata.
 */
function expandQuery(originalInput) {
  const cleanedQuery = normalizeQuery(originalInput);
  const variants = [];

  // Add original cleaned query
  addUnique(variants, cleanedQuery);

  if (!cleanedQuery) {
    return variants;
  }

  // Process each alias group
  for (const aliasGroup of loadAliases()) {
    const inputs = Array.isArray(aliasGroup.input) ? aliasGroup.input : [];
    const queries = Array.isArray(aliasGroup.queries) ? aliasGroup.queries : [];

    // Check if this alias group matches using strict matching
    const matched = inputs.some(aliasInput => strictPhraseMatch(cleanedQuery, aliasInput));
    if (!matched) continue;

    // Add all queries from this matching alias group
    for (const query of queries) {
      addUnique(variants, query);
    }
  }

  // Convert string variants to objects with metadata
  return variants.map(query => {
    // Determine source and priority
    if (query === cleanedQuery) {
      return { query, source: 'original', priority: 0 };
    }
    
    // Find which alias group this query came from
    for (const aliasGroup of loadAliases()) {
      const inputs = Array.isArray(aliasGroup.input) ? aliasGroup.input : [];
      const groupQueries = Array.isArray(aliasGroup.queries) ? aliasGroup.queries : [];
      
      const isExactInputMatch = inputs.some(input => 
        normalizeQuery(input) === normalizeQuery(query)
      );
      
      const isExactQueryMatch = groupQueries.some(groupQuery => 
        normalizeQuery(groupQuery) === normalizeQuery(query)
      );
      
      if (isExactInputMatch || isExactQueryMatch) {
        return { query, source: 'alias-exact', priority: 1 };
      }
    }
    
    // Fallback (should not happen with current logic)
    return { query, source: 'alias-expand', priority: 2 };
  });
}

module.exports = {
  expandQuery,
  normalizeQuery,
  loadAliases,
};