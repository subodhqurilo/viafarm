const getCartQuantityMap = (cart) => {
  const map = {};

  if (!cart || !Array.isArray(cart.items)) return map;

  for (const item of cart.items) {
    if (item.product) {
      map[item.product.toString()] = Number(item.quantity) || 0;
    }
  }

  return map;
};

module.exports = { getCartQuantityMap };
