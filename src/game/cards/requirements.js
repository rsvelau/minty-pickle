// The die requirement in square brackets on an Equipment ability.
//
// How each form reads (my reading, to confirm in the rules walkthrough). With
// several dice, a plain number is about their TOTAL:
//   '4+'          total 4 or more
//   '12'          total exactly 12 (Salt Shot 🎲🎲 [12] = double six)
//   '11-'         total 11 or less
//   '1,2'         one die showing 1 or 2 (a list of allowed faces)
//   '2-3'         one die showing 2 or 3 (a range of faces)
//   '2-'          one die showing 2 or less  (same as '11-' but for one die)
//   '2, 5+'       two dice: one shows 2, the other 5 or more (one condition per die, any order)
//   'Any'         any value
//   '2x Target’s' total at least twice the target's die (the monster's current die)
//   null          no dice needed
//
// checkRequirement(req, values, { targetDie }) -> true | false
export function checkRequirement(req, values, { targetDie = null } = {}) {
  if (req === null || req === undefined) return true;
  const r = String(req).trim();
  const total = values.reduce((a, b) => a + b, 0);
  if (/^any$/i.test(r)) return values.length > 0;
  if (/^2x target/i.test(r)) return targetDie !== null && total >= 2 * targetDie;
  // One condition per die ('2, 5+'): match them in any order.
  if (r.includes(',') && r.split(',').some((p) => /[+\-]$/.test(p.trim()))) {
    const conds = r.split(',').map((p) => p.trim());
    if (conds.length !== values.length) return false;
    const fits = (c, v) => single(c, v);
    const permute = (left, used) => (left.length === 0 ? true
      : values.some((v, k) => !used.has(k) && fits(left[0], v) && permute(left.slice(1), new Set([...used, k]))));
    return permute(conds, new Set());
  }
  // A list of allowed faces ('1,2'): every die must show one of them.
  if (r.includes(',')) {
    const faces = r.split(',').map((p) => Number(p.trim()));
    return values.length > 0 && values.every((v) => faces.includes(v));
  }
  // A range of faces ('2-3'): every die within it.
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(r);
  if (range) return values.length > 0 && values.every((v) => v >= Number(range[1]) && v <= Number(range[2]));
  return single(r, total);
}

// One condition against one number: '4+', '11-', '7'.
function single(c, n) {
  const m = /^(\d+)\s*([+\-])?$/.exec(c);
  if (!m) return false;
  const k = Number(m[1]);
  if (m[2] === '+') return n >= k;
  if (m[2] === '-') return n <= k;
  return n === k;
}
