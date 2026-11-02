const canonical = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();

// An excerpt must retain the polarity of its source sentence. This deliberately
// rejects ambiguous negation rather than turning a refusal into a commitment.
function supportsQuote(source, quote) {
  const value = canonical(source), fragment = canonical(quote);
  if (!fragment) return false;
  let index = value.indexOf(fragment);
  while (index >= 0) {
    const before = value.slice(Math.max(0,index-240),index);
    const prefix = before.split(/[.!?;\n]/u).pop();
    if (!/(?:^|[^\p{L}])(?:не|нет|без|никогда|not|no|never|without|отказыва\p{L}*)(?:$|[^\p{L}])/iu.test(prefix)) return true;
    index = value.indexOf(fragment,index+1);
  }
  return false;
}
module.exports = { supportsQuote };
