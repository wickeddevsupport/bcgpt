
export function normalize(s) {
  return (s || "").toLowerCase().trim();
}

export function levenshtein(a, b) {
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b[i - 1] === a[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

export function ambiguity(label, options) {
  const err = new Error("AMBIGUOUS_MATCH");
  err.code = "AMBIGUOUS_MATCH";
  err.label = label;
  err.options = (options || []).map(o => ({ id: o.id, name: o.name }));
  throw err;
}

export function resolveByName(items, name, label = "item") {
  const n = normalize(name);

  const exact = (items || []).filter(i => normalize(i.name) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return ambiguity(label, exact);

  const contains = (items || []).filter(i => normalize(i.name).includes(n));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) return ambiguity(label, contains);

  const scored = (items || [])
    .map(i => ({ i, score: levenshtein(normalize(i.name), n) }))
    .sort((a, b) => a.score - b.score)
    .filter(s => s.score <= Math.max(3, n.length / 2));

  if (scored.length === 1) return scored[0].i;
  if (scored.length > 1) return ambiguity(label, scored.map(s => s.i));

  const err = new Error("NO_MATCH");
  err.code = "NO_MATCH";
  err.label = label;
  throw err;
}
