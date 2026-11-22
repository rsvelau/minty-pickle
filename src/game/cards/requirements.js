// The die requirement in square brackets on an Equipment ability.
//
// How each form reads (confirmed by the designer): the slotted dice are ADDED
// TOGETHER and the total must match. The one exception is a list with
// conditions ('2, 5+'): one condition per die.
//   '4+'          total 4 or more
//   '12'          total exactly 12 (Salt Shot 🎲🎲 [12] = double six)
//   '11-'         total 11 or less
//   '1,2'         total is 1 or 2
//   '2-3'         total is 2 or 3
//   '2-'          total is 2 or less
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
  // A list of allowed totals ('1,2'), or a range ('2-3'): the dice added together.
  if (r.includes(',')) return values.length > 0 && r.split(',').map((p) => Number(p.trim())).includes(total);
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(r);
  if (range) return values.length > 0 && total >= Number(range[1]) && total <= Number(range[2]);
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
