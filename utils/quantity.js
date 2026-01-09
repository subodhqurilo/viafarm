/**
 * Increase quantity to next whole number
 * Examples:
 * 2.1  -> 3
 * 2.5  -> 3
 * 2.9  -> 3
 * 3.0  -> 4
 */
const increaseToNextInteger = (currentQty) => {
  const qty = Number(currentQty);
  if (isNaN(qty) || qty < 0) return 1;

  return Math.floor(qty) + 1;
};

/**
 * Decrease quantity to previous whole number
 * Examples:
 * 3.9 -> 3
 * 3.1 -> 3
 * 3.0 -> 2
 */
const decreaseToPrevInteger = (currentQty) => {
  const qty = Number(currentQty);
  if (isNaN(qty) || qty <= 1) return 1;

  const intPart = Math.floor(qty);
  return intPart === qty ? intPart - 1 : intPart;
};

module.exports = {
  increaseToNextInteger,
  decreaseToPrevInteger,
};
