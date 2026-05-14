export interface CartLine {
  priceCents: number;
  quantity: number;
}

export function cartTotal(items: CartLine[]): number {
  let total = 0;
  for (const item of items) {
    if (item.quantity < 0) {
      throw new Error(`Negative quantity not allowed: ${item.quantity}`);
    }
    total += item.priceCents * item.quantity;
  }
  return total;
}

export interface CartLineWithProduct {
  quantity: number;
  product: { priceCents: number };
}

export function cartTotalFromLines(lines: CartLineWithProduct[]): number {
  return lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);
}
