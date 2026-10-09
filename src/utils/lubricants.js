// Most recent purchase on record (by cost paid), or 0 if the product has
// never had one logged — what the Lubricants product card shows in place
// of the old selling-price "Revise Price" figure (removed: Pump 2's oil
// pricing was always driven by purchase cost, never a separate selling
// rate, so that figure was display-only and never fed any pricing logic).
export function latestPurchaseCost(product) {
  const latest = lastPurchaseOf(product)
  return latest ? Number(latest.cost) || 0 : 0
}

// Groups a product's purchase history by cost paid per unit, summing the
// quantity bought at each distinct cost — e.g. "20 units @ ₹260, 10 @ ₹280".
// Highest cost first, since that's usually the most recent restock.
export function purchaseBatchesByCost(product) {
  const totals = new Map()
  for (const entry of product?.purchaseHistory || []) {
    const cost = Number(entry.cost) || 0
    totals.set(cost, (totals.get(cost) || 0) + (Number(entry.qty) || 0))
  }
  return [...totals.entries()]
    .map(([cost, qty]) => ({ cost, qty }))
    .sort((a, b) => b.cost - a.cost)
}

// Most recent purchase on record (by date), or null if the product has
// never had one logged — e.g. to pre-fill a form with "whatever we last
// paid for this", same helper Lubricants' own "Record Purchase" form uses.
export function lastPurchaseOf(product) {
  const history = product?.purchaseHistory || []
  if (!history.length) return null
  return [...history].sort((a, b) => b.date.localeCompare(a.date))[0]
}

// How much stock is available at a specific PURCHASE cost — Fuel Entry's
// oil rows sell out of whichever restock batch the manager picks by its
// actual per-unit cost (see purchaseBatchesByCost). Cost-based rather than
// a single running selling price, since this business reprices each
// restock individually — the batches the manager actually needs to tell
// apart are "the ₹38 lot" vs "the ₹23 lot" — exactly what Purchase History
// already shows. There's no per-batch stock ledger
// (`product.stock` is one running total, decremented by every sale
// regardless of which batch it came from), so this is the total ever
// bought at that cost, capped at whatever is still on hand overall — an
// approximation, not a tracked lot.
export function stockAvailableAtCost(product, cost) {
  return availableAtCostBreakdown(product, cost).available
}

// Exported so any screen displaying a product's raw `stock` (e.g. the
// Lubricants product card) can defend against the same float-noise issue,
// not just the Available-at-cost figure computed below.
export function round3(n) {
  return Math.round(n * 1000) / 1000
}

// The full working behind stockAvailableAtCost above, so a tooltip can show
// exactly which numbers produced the "Available" figure instead of just the
// answer — both functions share this one calculation, so the tooltip can
// never disagree with the actual clamp applied to the count field.
export function availableAtCostBreakdown(product, cost) {
  // Rounded here too, as a display-layer safety net — stock is written by
  // several code paths (sale, purchase, edit/delete undo) and this is the
  // one place both the "Available" label and the count-field clamp read
  // from, so a stray float-noise value (e.g. 96.00000000000026) never
  // reaches the screen even if it somehow slipped past the write-time
  // rounding in DataContext.
  const totalStock = round3(Math.max(0, Number(product?.stock) || 0))
  const batches = purchaseBatchesByCost(product)
  const targetCost = Number(cost)

  // Only one cost has ever been paid — there's no other batch stock could
  // belong to, so all of it is available at this (only) cost. This also
  // covers a product's opening stock, recorded as its own purchase entry
  // (see LubricantService.create_product), so it isn't undercounted as "0
  // available" here while Lubricants shows the real stock figure.
  if (batches.length <= 1) {
    return { available: totalStock, totalStock, singleBatch: true }
  }

  const batch = batches.find((b) => b.cost === targetCost)
  if (!batch) {
    return { available: 0, totalStock, costNotFound: true }
  }

  // Units already sold at THIS exact rate (a real Pump 2 oil-row count,
  // summed server-side — see LubricantService's sold_count_by_rate) have to
  // come off this batch's own purchased total before it's compared against
  // the product's one aggregate running stock. Without this, a product with
  // more than one batch (say 12 @ ₹26 and 8 @ ₹25, only the ₹25 one ever
  // sold from) kept showing "Available: 8" at ₹25 forever, no matter how
  // many of those 8 were already sold — because the untouched ₹26 batch's
  // own units kept the OVERALL stock comfortably above 8, so the
  // min(batch.qty, totalStock) clamp never actually caught the problem.
  const soldAtCost = Number(product?.soldCountByRate?.[targetCost] ?? 0)
  const remainingAtCost = round3(Math.max(0, batch.qty - soldAtCost))

  return {
    available: round3(Math.max(0, Math.min(remainingAtCost, totalStock))),
    totalStock,
    purchasedAtCost: round3(batch.qty),
    soldAtCost: round3(soldAtCost),
  }
}
