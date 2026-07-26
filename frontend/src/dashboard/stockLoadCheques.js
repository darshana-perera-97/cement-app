import { BRANDS } from './brandTheme';

function todayYmdLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Flatten stock load records into one row per cheque (from Add a stock load). */
export function buildStockChequeRows(loads) {
  const rows = [];
  for (const load of loads) {
    const loadDate = String(load.date ?? '').slice(0, 10);
    for (const b of BRANDS) {
      const chequeNumber = String(load[`${b.key}Cheque`] ?? '').trim();
      if (!chequeNumber) continue;
      const convertingDate = String(load[`${b.key}ConvertingDate`] ?? '').slice(0, 10);
      rows.push({
        rowKey: `${load.id || load.stockId}-${b.key}`,
        date: loadDate,
        chequeNumber,
        convertingDate: convertingDate && /^\d{4}-\d{2}-\d{2}$/.test(convertingDate) ? convertingDate : loadDate,
        amount: Number(load[`${b.key}Cost`]) || 0,
        brand: b.label,
        stockId: String(load.stockId ?? '').trim(),
      });
    }
  }
  rows.sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return a.chequeNumber.localeCompare(b.chequeNumber);
  });
  return rows;
}

/** Totals grouped by converting date for today and future cheques. */
export function buildUpcomingConvertingRows(chequeRows, today = todayYmdLocal()) {
  const map = new Map();
  for (const r of chequeRows) {
    const cd = String(r.convertingDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cd) || cd < today) continue;
    const cur = map.get(cd) || { convertingDate: cd, amount: 0 };
    cur.amount += Number(r.amount) || 0;
    map.set(cd, cur);
  }
  return [...map.values()].sort((a, b) => a.convertingDate.localeCompare(b.convertingDate));
}
