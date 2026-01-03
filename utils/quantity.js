/**
 * Safely add decimal quantities
 * Fixes JS floating precision issue
 * Example:
 * 2.2 + 0.5 = 2.7
 * 4.9 + 0.1 = 5.0
 */
const addDecimalQuantity = (currentQty, addQty) => {
  const a = Number(currentQty);
  const b = Number(addQty);

  if (isNaN(a) || a < 0) return Number(b) || 0;
  if (isNaN(b) || b <= 0) return a;

  // ✅ precision safe (2 decimal places)
  return Number((a + b).toFixed(2));
};

module.exports = {
  addDecimalQuantity,
};
