import { Link } from 'react-router-dom';
import {
  BRANDS,
  BrandFieldCell,
  BrandSectionShell,
  BrandSections,
  NoteBlock,
  SummaryField,
  SummaryGrid,
  brandHasBags,
  brandHasLoadActivity,
  displayText,
  formatAmount,
  formatDateTime,
  formatMoney,
} from './detailModalShared';
import { getPaymentCheques } from './paymentCheques';

export function getRowDetailMeta(variant, row) {
  if (row == null || typeof row !== 'object') {
    return { title: 'Details', subtitle: null };
  }

  switch (variant) {
    case 'load': {
      const stockId = displayText(row.stockId);
      const parts = [row.date, row.vehicleNumber].filter(Boolean);
      return {
        title: 'Load details',
        subtitle: [stockId !== '—' ? stockId : null, ...parts].filter(Boolean).join(' · ') || null,
      };
    }
    case 'bill':
      return {
        title: 'Bill details',
        subtitle: [row.stockId, row.date, row.customerName].filter(Boolean).join(' · ') || null,
      };
    case 'customer':
      return {
        title: 'Customer details',
        subtitle: [row.location, row.contactNumber, row.email].filter(Boolean).join(' · ') || row.name || null,
      };
    case 'payment':
      return {
        title: 'Payment details',
        subtitle: [row.date, row.customerName, row.billNumber ? `#${row.billNumber}` : null]
          .filter(Boolean)
          .join(' · ') || null,
      };
    case 'promotion':
      return {
        title: 'Promotion details',
        subtitle: [row.date, row.customerName, row.billNumber ? `#${row.billNumber}` : null]
          .filter(Boolean)
          .join(' · ') || null,
      };
    case 'user':
      return {
        title: 'User details',
        subtitle: row.username || null,
      };
    case 'transaction':
      return {
        title: 'Transaction details',
        subtitle: [row.date, row.type].filter(Boolean).join(' · ') || null,
      };
    case 'ledgerDay':
      return {
        title: 'Daily ledger',
        subtitle: row.date || null,
      };
    case 'overdueBill':
      return {
        title: 'Overdue bill',
        subtitle: row.customerName || null,
      };
    case 'bankDaily':
      return {
        title: 'Daily bank summary',
        subtitle: row.date || null,
      };
    case 'bankCheque':
      return {
        title: 'Cheque details',
        subtitle: [row.chequeDate, row.customerName, row.billNumber !== '—' ? `#${row.billNumber}` : null]
          .filter(Boolean)
          .join(' · ') || null,
      };
    case 'incentive':
      return {
        title: 'Incentive details',
        subtitle: [row.stockId, row.brandLabel, row.date].filter((v) => v && v !== '—').join(' · ') || null,
      };
    default:
      return { title: 'Details', subtitle: null };
  }
}

export function RowDetailContent({ variant, row }) {
  if (row == null || typeof row !== 'object') return null;

  switch (variant) {
    case 'load':
      return <LoadDetailContent row={row} />;
    case 'bill':
      return <BillDetailContent row={row} />;
    case 'customer':
      return <CustomerDetailContent row={row} />;
    case 'payment':
      return <PaymentDetailContent row={row} />;
    case 'promotion':
      return <PromotionDetailContent row={row} />;
    case 'user':
      return <UserDetailContent row={row} />;
    case 'transaction':
      return <TransactionDetailContent row={row} />;
    case 'ledgerDay':
      return <LedgerDayDetailContent row={row} />;
    case 'overdueBill':
      return <OverdueBillDetailContent row={row} />;
    case 'bankDaily':
      return <BankDailyDetailContent row={row} />;
    case 'bankCheque':
      return <BankChequeDetailContent row={row} />;
    case 'incentive':
      return <IncentiveDetailContent row={row} />;
    default:
      return null;
  }
}

function formatMoneyOrDash(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return formatMoney(n);
}

function IncentiveDetailContent({ row }) {
  const brand = BRANDS.find((b) => b.key === row.brandKey);

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Stock ID" value={displayText(row.stockId)} />
        <SummaryField label="Bag type" value={displayText(row.brandLabel)} />
        <SummaryField label="Vehicle" value={displayText(row.vehicleNumber)} />
        <SummaryField label="Added by" value={displayText(row.addedBy)} />
        <SummaryField label="Bag amounts" value={Number(row.bags || 0).toLocaleString()} valueClassName="tabular-nums" />
        <SummaryField label="Total cost" value={formatMoney(row.totalCost)} valueClassName="tabular-nums" />
        <SummaryField label="Per bag cost" value={formatMoney(row.perBagCost)} valueClassName="tabular-nums" />
        <SummaryField label="Invoice number" value={displayText(row.invoiceNumber)} />
        <SummaryField label="Cheque number" value={displayText(row.chequeNumber)} />
        <SummaryField label="Converting date" value={displayText(row.convertingDate)} valueClassName="tabular-nums" />
        <SummaryField label="Transport cost" value={formatMoneyOrDash(row.transportCost)} valueClassName="tabular-nums" />
        <SummaryField label="Transport / bag" value={formatMoneyOrDash(row.transportPerBag)} valueClassName="tabular-nums" />
        <SummaryField label="Margin / bag" value={formatMoneyOrDash(row.margin)} valueClassName="tabular-nums" />
        <SummaryField
          label="Total load amount"
          value={formatMoney(row.totalLoadAmount)}
          className="col-span-2 bg-slate-100/80"
          valueClassName="tabular-nums"
        />
      </SummaryGrid>
      <div className="mt-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-4 py-4 ring-2 ring-indigo-200/50 shadow-sm shadow-indigo-100/40">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Unloading price</p>
        <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-indigo-950">
          {formatMoneyOrDash(row.unloadingPrice)}
        </p>
        <p className="mt-1 text-xs text-indigo-800/70">
          {row.unloadingPrice != null
            ? 'Per bag · purchase cost + transport + margin'
            : 'Add bag cost on the load to calculate'}
        </p>
      </div>
      {brand && row.sourceLoad ? (
        <div className="mt-5">
          <BrandSections title="Brand on this load">
            <BrandSectionShell brand={brand} active>
              <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
                <BrandFieldCell brand={brand} lead label="Bags" value={row.bags} valueClassName="tabular-nums font-semibold" />
                <BrandFieldCell
                  brand={brand}
                  label="Cost"
                  value={formatAmount(row.totalCost)}
                  valueClassName="tabular-nums font-medium"
                />
                <BrandFieldCell brand={brand} label="Invoice" value={displayText(row.invoiceNumber)} valueClassName="text-slate-800" />
                <BrandFieldCell brand={brand} label="Cheque" value={displayText(row.chequeNumber)} valueClassName="text-slate-800" />
                <BrandFieldCell
                  brand={brand}
                  label="Converting date"
                  value={displayText(row.convertingDate)}
                  valueClassName="tabular-nums text-slate-800"
                />
              </dl>
            </BrandSectionShell>
          </BrandSections>
        </div>
      ) : null}
    </>
  );
}

function LoadDetailContent({ row }) {
  const stockId = displayText(row.stockId);

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Stock ID" value={stockId} />
        <SummaryField label="Vehicle" value={displayText(row.vehicleNumber)} />
        <SummaryField label="Added by" value={displayText(row.addedBy)} />
        <SummaryField
          label="Transport / bag"
          value={formatMoney(row.transportCostPerBag)}
          valueClassName="tabular-nums"
        />
        <SummaryField
          label="Margin / bag"
          value={formatMoney(row.marginPerBag ?? 70)}
          valueClassName="tabular-nums"
        />
        <SummaryField
          label="Total amount"
          value={formatMoney(row.totalAmount)}
          className="col-span-2 bg-indigo-50 ring-indigo-100"
        />
      </SummaryGrid>
      <BrandSections title="Cement by brand">
        {BRANDS.map((b) => {
          const active = brandHasLoadActivity(row, b.key);
          const bags = Number(row[`${b.key}Bags`]) || 0;
          return (
            <BrandSectionShell key={b.key} brand={b} active={active} emptyText="No stock on this load">
              <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
                <BrandFieldCell brand={b} lead label="Bags" value={bags} valueClassName="tabular-nums font-semibold" />
                <BrandFieldCell
                  brand={b}
                  label="Cost"
                  value={formatAmount(row[`${b.key}Cost`])}
                  valueClassName="tabular-nums font-medium"
                />
                <BrandFieldCell brand={b} label="Invoice" value={displayText(row[`${b.key}Invoice`])} valueClassName="text-slate-800" />
                <BrandFieldCell brand={b} label="Cheque" value={displayText(row[`${b.key}Cheque`])} valueClassName="text-slate-800" />
                <BrandFieldCell
                  brand={b}
                  label="Converting date"
                  value={displayText(row[`${b.key}ConvertingDate`] || row.date)}
                  valueClassName="tabular-nums text-slate-800"
                />
              </dl>
            </BrandSectionShell>
          );
        })}
      </BrandSections>
    </>
  );
}

function BillDetailContent({ row }) {
  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Stock ID" value={displayText(row.stockId)} />
        <SummaryField label="Customer" value={displayText(row.customerName)} className="col-span-2 sm:col-span-1" />
        <SummaryField label="Entered by" value={displayText(row.enteredBy)} />
        <SummaryField
          label="Total bill"
          value={formatMoney(row.totalAmount)}
          className="col-span-2 bg-indigo-50 ring-indigo-100"
        />
      </SummaryGrid>
      <BrandSections title="Bags sold">
        {BRANDS.map((b) => {
          const bags = Number(row[`${b.key}Bags`]) || 0;
          const active = bags > 0;
          return (
            <BrandSectionShell key={b.key} brand={b} active={active} emptyText="No bags on this bill">
              <dl className="grid grid-cols-2 gap-px bg-slate-100">
                <BrandFieldCell brand={b} lead label="Bags" value={bags} valueClassName="tabular-nums font-semibold" />
                <BrandFieldCell
                  brand={b}
                  label="Price / bag"
                  value={formatMoney(row[`${b.key}UnitPrice`])}
                  valueClassName="tabular-nums font-medium"
                />
              </dl>
            </BrandSectionShell>
          );
        })}
      </BrandSections>
    </>
  );
}

function CustomerDetailContent({ row }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = row.dueDate && row.dueDate < today;
  const overpayment = Math.max(0, Number(row.overpaymentAmount) || 0);
  const amountToPay = Math.max(0, Number(row.remainingAmount) || 0);
  const settled = amountToPay === 0 && overpayment === 0;

  return (
    <>
      <div className="mt-4 space-y-2">
        {overdue ? (
          <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-rose-800">
            Overdue
          </span>
        ) : settled ? (
          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-800">
            Settled
          </span>
        ) : amountToPay > 0 ? (
          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-900">
            Balance due
          </span>
        ) : null}
        {overpayment > 0 ? (
          <span className="ml-1 inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-100">
            Credit balance
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded-xl bg-indigo-50 px-3 py-2.5 ring-1 ring-indigo-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount to pay</p>
          <p
            className={`mt-1 text-lg font-bold tabular-nums ${
              overdue && amountToPay > 0 ? 'text-rose-800' : 'text-slate-900'
            }`}
          >
            {formatMoney(amountToPay)}
          </p>
        </div>
        {overpayment > 0 ? (
          <div className="col-span-2 rounded-xl bg-emerald-50/80 px-3 py-2.5 ring-1 ring-emerald-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Overpayment</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-emerald-900">{formatMoney(overpayment)}</p>
          </div>
        ) : null}
      </div>
      <SummaryGrid>
        <SummaryField label="Customer" value={displayText(row.name)} className="col-span-2" />
        <SummaryField label="Location" value={displayText(row.location)} />
        <SummaryField label="Contact" value={displayText(row.contactNumber)} />
        <SummaryField label="Email" value={displayText(row.email)} />
        <SummaryField
          label="Due date"
          value={displayText(row.dueDate)}
          valueClassName={overdue ? 'font-semibold text-rose-800' : ''}
        />
        <SummaryField
          label="Bill overdue days"
          value={row.overdueDays != null ? String(row.overdueDays) : '14'}
        />
        <SummaryField label="Added by" value={displayText(row.addedBy)} />
        <SummaryField label="Opening balance" value={formatMoney(row.pastBill)} className="col-span-2" />
      </SummaryGrid>
      {row.id ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to={`/dashboard/customers/${encodeURIComponent(row.id)}`}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            View account
          </Link>
          <Link
            to={`/dashboard/customers/${encodeURIComponent(row.id)}?edit=1`}
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
          >
            Edit details
          </Link>
        </div>
      ) : null}
    </>
  );
}

function PaymentDetailContent({ row }) {
  const cash = Math.max(0, Number(row.cashAmount) || 0);
  const chequeLines = getPaymentCheques(row);

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Bill #" value={displayText(row.billNumber)} valueClassName="font-mono" />
        <SummaryField label="Customer" value={displayText(row.customerName)} className="col-span-2 sm:col-span-1" />
        <SummaryField label="Recorded by" value={displayText(row.recordedBy)} />
        {cash > 0 ? (
          <SummaryField label="Cash" value={formatMoney(cash)} valueClassName="tabular-nums text-emerald-800" />
        ) : null}
        <SummaryField
          label="Amount received"
          value={`−${formatMoney(row.amount)}`}
          className="col-span-2 bg-emerald-50 ring-emerald-100"
          valueClassName="font-semibold text-emerald-800 tabular-nums"
        />
      </SummaryGrid>
      {chequeLines.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cheque{chequeLines.length > 1 ? 's' : ''}
          </p>
          {chequeLines.map((c, i) => (
            <div
              key={c.id || i}
              className="rounded-xl bg-violet-50/80 px-3 py-2.5 text-sm ring-1 ring-violet-100"
            >
              <p className="font-semibold tabular-nums text-violet-900">{formatMoney(c.amount)}</p>
              <p className="mt-1 text-xs text-slate-600">
                #{c.chequeNumber || '—'} · {c.chequeDate || '—'}
                {c.chequeDeposited ? ' · Deposited' : ''}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {row.note ? <NoteBlock value={row.note} /> : null}
    </>
  );
}

function PromotionDetailContent({ row }) {
  const totalBags = BRANDS.reduce((sum, b) => sum + (Number(row[`${b.key}Bags`]) || 0), 0);

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Bill #" value={row.billNumber ? `#${row.billNumber}` : '—'} valueClassName="font-mono" />
        <SummaryField label="Customer" value={displayText(row.customerName)} className="col-span-2 sm:col-span-1" />
        <SummaryField label="Recorded by" value={displayText(row.enteredBy || row.addedBy)} />
        <SummaryField
          label="Total free bags"
          value={totalBags}
          className="col-span-2 bg-indigo-50 ring-indigo-100"
          valueClassName="tabular-nums font-semibold text-indigo-900"
        />
      </SummaryGrid>
      {row.reason ? <NoteBlock label="Reason" value={row.reason} /> : null}
      <BrandSections title="Free bags by brand">
        {BRANDS.map((b) => {
          const bags = Number(row[`${b.key}Bags`]) || 0;
          const active = brandHasBags(row, b.key);
          return (
            <BrandSectionShell key={b.key} brand={b} active={active} emptyText="No free bags for this brand">
              <dl className="grid grid-cols-1 gap-px bg-slate-100">
                <BrandFieldCell brand={b} lead label="Free bags" value={bags} valueClassName="tabular-nums font-semibold text-indigo-900" />
              </dl>
            </BrandSectionShell>
          );
        })}
      </BrandSections>
    </>
  );
}

function UserDetailContent({ row }) {
  return (
    <SummaryGrid>
      <SummaryField label="Username" value={displayText(row.username)} className="col-span-2" valueClassName="font-mono" />
      <SummaryField label="Added" value={formatDateTime(row.createdAt)} />
      <SummaryField label="Created by" value={displayText(row.createdBy)} />
    </SummaryGrid>
  );
}

function TransactionDetailContent({ row }) {
  const isCredit = row.direction === 'credit';

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Type" value={displayText(row.type)} />
        <SummaryField
          label="Amount"
          value={isCredit ? `−${formatMoney(row.amount)}` : formatMoney(row.amount)}
          className="col-span-2 bg-indigo-50 ring-indigo-100"
          valueClassName={`tabular-nums font-semibold ${isCredit ? 'text-emerald-800' : 'text-slate-900'}`}
        />
      </SummaryGrid>
      <NoteBlock label="Details" value={row.details} />
    </>
  );
}

function LedgerDayDetailContent({ row }) {
  return (
    <BrandSections title="Stock movement by brand">
      {BRANDS.map((b) => {
        const cell = row.brands?.[b.key] || { start: 0, in: 0, out: 0, end: 0 };
        const active = cell.start > 0 || cell.in > 0 || cell.out > 0 || cell.end > 0;
        return (
          <BrandSectionShell key={b.key} brand={b} active={active} emptyText="No movement for this brand">
            <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
              <BrandFieldCell brand={b} lead label="Start" value={cell.start} valueClassName="tabular-nums" />
              <BrandFieldCell brand={b} label="In" value={cell.in} valueClassName="tabular-nums text-emerald-800" />
              <BrandFieldCell brand={b} label="Out" value={cell.out} valueClassName="tabular-nums text-amber-900" />
              <BrandFieldCell brand={b} label="End" value={cell.end} valueClassName="tabular-nums font-semibold" />
            </dl>
          </BrandSectionShell>
        );
      })}
    </BrandSections>
  );
}

function daysFromBillDateForRow(row) {
  if (row?.daysFromBillDate != null && row.daysFromBillDate !== '') return row.daysFromBillDate;
  const billDate = row?.billDate;
  if (!billDate || !/^\d{4}-\d{2}-\d{2}$/.test(billDate)) return null;
  const [y, m, d] = billDate.split('-').map(Number);
  const bill = new Date(y, m - 1, d);
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((todayMid - bill) / (24 * 60 * 60 * 1000)));
}

function OverdueBillDetailContent({ row }) {
  const daysFromBillDate = daysFromBillDateForRow(row);

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Customer" value={displayText(row.customerName)} className="col-span-2" />
        <SummaryField label="Bill date" value={displayText(row.billDate)} />
        <SummaryField label="Due date" value={displayText(row.dueDate)} />
        <SummaryField
          label="Days overdue"
          value={row.daysOverdue ?? '—'}
          valueClassName="font-semibold text-rose-700 tabular-nums"
        />
        <SummaryField
          label="Days from bill date"
          value={daysFromBillDate ?? '—'}
          valueClassName="tabular-nums"
        />
        <SummaryField label="Bill total" value={formatMoney(row.billTotal)} />
        <SummaryField
          label="Outstanding"
          value={formatMoney(row.outstandingAmount)}
          className="col-span-2 bg-rose-50 ring-rose-100"
          valueClassName="font-semibold text-rose-800 tabular-nums"
        />
      </SummaryGrid>
      {row.details ? <NoteBlock label="Bill details" value={row.details} /> : null}
    </>
  );
}

function BankDailyDetailContent({ row }) {
  const cashIn = Number(row.cashIn) || 0;
  const bankDeposit = Number(row.bankDeposit) || 0;
  const totalIncome = Number(row.totalIncome) || 0;
  const chequePortion = Math.max(0, totalIncome - cashIn);

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} className="col-span-2" />
        <SummaryField
          label="Cash in"
          value={formatMoney(cashIn)}
          valueClassName="tabular-nums text-emerald-800"
        />
        <SummaryField
          label="Bank deposit"
          value={formatMoney(bankDeposit)}
          valueClassName="tabular-nums text-sky-800"
        />
        <SummaryField
          label="Cheques"
          value={formatMoney(chequePortion)}
          valueClassName="tabular-nums text-violet-800"
        />
        <SummaryField
          label="Total income"
          value={formatMoney(totalIncome)}
          className="col-span-2 bg-indigo-50 ring-indigo-100"
          valueClassName="font-semibold tabular-nums"
        />
      </SummaryGrid>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Cash taken in is treated as deposited to the bank on the same day. Total income includes cash and cheques
        recorded on this date.
      </p>
    </>
  );
}

function BankChequeDetailContent({ row }) {
  return (
    <>
      <SummaryGrid>
        <SummaryField label="Cheque date" value={displayText(row.chequeDate)} />
        <SummaryField label="Payment date" value={displayText(row.paymentDate)} />
        <SummaryField label="Customer" value={displayText(row.customerName)} className="col-span-2 sm:col-span-1" />
        <SummaryField label="Bill #" value={displayText(row.billNumber)} valueClassName="font-mono" />
        <SummaryField label="Cheque #" value={displayText(row.chequeNumber)} valueClassName="font-mono" />
        <SummaryField
          label="Cheque amount"
          value={formatMoney(row.amount)}
          className="col-span-2 bg-violet-50 ring-violet-100"
          valueClassName="font-semibold tabular-nums text-violet-900"
        />
        <SummaryField
          label="Bank deposit"
          value={row.chequeDeposited ? 'Marked as deposited' : 'Pending'}
          className={row.chequeDeposited ? 'bg-emerald-50 ring-emerald-100' : 'bg-amber-50 ring-amber-100'}
          valueClassName={row.chequeDeposited ? 'font-semibold text-emerald-900' : 'font-semibold text-amber-900'}
        />
        {row.chequeDeposited && row.chequeDepositedBy ? (
          <SummaryField label="Marked by" value={displayText(row.chequeDepositedBy)} />
        ) : null}
        {row.chequeDeposited && row.chequeDepositedAt ? (
          <SummaryField label="Marked at" value={displayText(row.chequeDepositedAt)} />
        ) : null}
      </SummaryGrid>
    </>
  );
}
