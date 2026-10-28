/** Credit limit in LKR. 0 means the limit is not set. */
export function creditLimitLkr(customer) {
  const n = Number(customer?.creditLimit);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Amount still owed above a set credit limit.
 * Null when the limit is unset, or the balance is within the limit.
 */
export function creditLimitOverage(customer, amountOwed) {
  const limit = creditLimitLkr(customer);
  if (limit <= 0) return null;
  const owedRaw = amountOwed == null ? customer?.remainingAmount : amountOwed;
  const owed = Math.max(0, Number(owedRaw) || 0);
  const overCents = Math.round(owed * 100) - Math.round(limit * 100);
  if (overCents <= 0) return null;
  return {
    limit,
    owed: Math.round(owed * 100) / 100,
    overBy: overCents / 100,
  };
}

export function customersOverCreditLimit(customers) {
  return (Array.isArray(customers) ? customers : [])
    .map((customer) => {
      const overage = creditLimitOverage(customer);
      if (!overage) return null;
      return {
        id: customer.id,
        name: String(customer.name || '').trim() || 'Customer',
        location: String(customer.location || '').trim(),
        ...overage,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) => b.overBy - a.overBy || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}
