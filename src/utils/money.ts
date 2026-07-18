// Money is stored as integer minor units (cents) everywhere in the DB, and
// converted to the client's expected wire shape at the serialization boundary.
//
// The mobile contract is deliberately inconsistent and we honour it exactly:
//   - Commerce (products, cart, orders): MAJOR units as decimals — `price: 68`,
//     `shipping: 6.99`, `total: 79.43`.
//   - Events: MINOR units as integers — `priceCents: 3500`.

/** Round a decimal to 2 places the same way the mock does (avoids fp drift). */
export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** Integer cents → major-unit decimal (e.g. 6899 → 68.99). */
export const centsToMajor = (cents: number): number => round2(cents / 100);

/** Major-unit decimal → integer cents (e.g. 68.99 → 6899). */
export const majorToCents = (major: number): number => Math.round(major * 100);
