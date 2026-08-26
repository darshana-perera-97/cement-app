import { Link } from 'react-router-dom';
import { canEditDetails } from '../auth';
import {
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
import { useBagProducts } from './BagProductsContext';
import { getPaymentCheques, cdmPortion, onlineTransferPortion } from './paymentCheques';
import { doorStepNotesText, formatPoChequeWithBank, formatPoChequesList, isPoCashPayment } from './poChequeDisplay';
import MonthlyTargetProgressBar from './MonthlyTargetProgressBar';
import { MANAGER_ACCESS_OPTIONS } from './navConfig';

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
    case 'unloadRequest':
      return {
        title: 'Unload request',
        subtitle: [row.date, row.customerName, row.driverName].filter(Boolean).join(' · ') || null,
      };
    case 'purchaseOrder':
      return {
        title: row.cancelled ? 'Purchase order (cancelled)' : 'Purchase order',
        subtitle:
          [
            row.poNumber,
            row.date,
            row.distributorName,
            formatPoChequesList(row.cheques),
          ]
            .filter((v) => v && v !== '—')
            .join(' · ') || null,
      };
    case 'user':
      return {
        title: 'User details',
        subtitle: [row.name, row.role].filter(Boolean).join(' · ') || row.username || null,
      };
    case 'distributor':
      return {
        title: 'Supplier details',
        subtitle: [row.contact, row.email].filter(Boolean).join(' · ') || row.name || null,
      };
    case 'lorry':
      return {
        title: 'Lorry details',
        subtitle: row.number || null,
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
    case 'companyCheque':
      return {
        title: 'Company cheque',
        subtitle: [row.chequeDate, row.chequeNumber ? `#${row.chequeNumber}` : null].filter(Boolean).join(' · ') || null,
      };
    case 'ownerCheque':
      return {
        title: 'Owner cheque',
        subtitle: [row.chequeDate, row.chequeNumber ? `#${row.chequeNumber}` : null].filter(Boolean).join(' · ') || null,
      };
    case 'poCheque':
      return {
        title: 'Issued cheque',
        subtitle:
          [
            row.chequeDate,
            row.accountLabel && row.chequeNumber
              ? `${row.accountLabel} · #${row.chequeNumber}`
              : row.chequeNumber
                ? `#${row.chequeNumber}`
                : row.accountLabel,
            row.product,
          ]
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
    case 'unloadRequest':
      return <UnloadRequestDetailContent row={row} />;
    case 'purchaseOrder':
      return <PurchaseOrderDetailContent row={row} />;
    case 'user':
      return <UserDetailContent row={row} />;
    case 'distributor':
      return <DistributorDetailContent row={row} />;
    case 'lorry':
      return <LorryDetailContent row={row} />;
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
    case 'companyCheque':
      return <CompanyChequeDetailContent row={row} />;
    case 'ownerCheque':
      return <OwnerChequeDetailContent row={row} />;
    case 'poCheque':
      return <PoChequeDetailContent row={row} />;
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

function ChipList({ label, items }) {
  const list = Array.isArray(items) ? items.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
  return (
    <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {list.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">—</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {list.map((item) => (
            <span
              key={item}
              className="rounded-lg bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200/80"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DistributorDetailContent({ row }) {
  let locations = [];
  if (Array.isArray(row.locations) && row.locations.length > 0) {
    locations = row.locations;
  } else if (String(row.location ?? '').trim()) {
    locations = [row.location];
  }
  const products = Array.isArray(row.products) ? row.products : [];

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Name" value={displayText(row.name)} className="col-span-2" />
        <SummaryField label="Contact number" value={displayText(row.contact)} />
        <SummaryField label="Email" value={displayText(row.email)} valueClassName="break-all" />
      </SummaryGrid>
      <ChipList label="Locations" items={locations} />
      <ChipList label="Products" items={products} />
    </>
  );
}

function LorryDetailContent({ row }) {
  return (
    <SummaryGrid>
      <SummaryField label="Lorry number" value={displayText(row.number)} className="col-span-2" valueClassName="font-semibold tabular-nums" />
      <SummaryField label="Note" value={displayText(row.note)} className="col-span-2" />
      <SummaryField label="Added" value={formatDateTime(row.createdAt)} />
      <SummaryField label="Updated" value={row.updatedAt ? formatDateTime(row.updatedAt) : '—'} />
    </SummaryGrid>
  );
}

function IncentiveDetailContent({ row }) {
  const { brands } = useBagProducts();
  const brand = brands.find((b) => b.key === row.brandKey);

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
  const { brands } = useBagProducts();
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
        {Number(row.doorStockTransportCostPerBag) > 0 ? (
          <SummaryField
            label="Door step transport / bag"
            value={formatMoney(row.doorStockTransportCostPerBag)}
            valueClassName="tabular-nums"
          />
        ) : null}
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
        {brands.map((b) => {
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
  const { brands } = useBagProducts();
  return (
    <>
      <SummaryGrid>
        <SummaryField label="Invoice #" value={displayText(row.invoiceNumber)} valueClassName="font-mono" />
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
        {brands.map((b) => {
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
        <SummaryField label="Customer ID" value={displayText(row.id)} className="col-span-2" valueClassName="font-mono" />
        <SummaryField label="Customer" value={displayText(row.name)} className="col-span-2" />
        <SummaryField label="Collector" value={displayText(row.collectorName)} className="col-span-2" />
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
      {Number(row.monthlyTargetBags) > 0 ? (
        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly bag target</p>
          <MonthlyTargetProgressBar
            className="mt-2"
            sold={row.monthlyBagsSold}
            target={row.monthlyTargetBags}
            progressPct={row.monthlyTargetProgressPct}
            monthLabel={row.monthlyTargetMonth}
          />
        </div>
      ) : null}
      {row.id ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to={`/dashboard/customers/${encodeURIComponent(row.id)}`}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            View account
          </Link>
          {canEditDetails() ? (
            <Link
              to={`/dashboard/customers/${encodeURIComponent(row.id)}?edit=1`}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
            >
              Edit details
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function PaymentDetailContent({ row }) {
  const cash = Math.max(0, Number(row.cashAmount) || 0);
  const cdm = cdmPortion(row);
  const onlineTransfer = onlineTransferPortion(row);
  const chequeLines = getPaymentCheques(row);

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Receipt #" value={displayText(row.billNumber)} valueClassName="font-mono" />
        <SummaryField label="Customer" value={displayText(row.customerName)} className="col-span-2 sm:col-span-1" />
        <SummaryField label="Recorded by" value={displayText(row.recordedBy)} />
        {row.requiresApproval ? (
          <SummaryField
            label="Approval"
            value={
              String(row.approvalStatus ?? 'pending').trim().toLowerCase() === 'approved'
                ? 'Approved'
                : String(row.approvalStatus ?? 'pending').trim().toLowerCase() === 'rejected'
                  ? 'Rejected'
                  : 'Pending manager approval'
            }
            valueClassName={
              String(row.approvalStatus ?? 'pending').trim().toLowerCase() === 'approved'
                ? 'text-emerald-800'
                : String(row.approvalStatus ?? 'pending').trim().toLowerCase() === 'rejected'
                  ? 'text-rose-800'
                  : 'text-amber-800'
            }
          />
        ) : null}
        {cash > 0 ? (
          <SummaryField label="Cash" value={formatMoney(cash)} valueClassName="tabular-nums text-emerald-800" />
        ) : null}
        {cdm > 0 ? (
          <SummaryField
            label="CDM deposit"
            value={formatMoney(cdm)}
            valueClassName="tabular-nums text-sky-800"
          />
        ) : null}
        {row.cdmNumber ? (
          <SummaryField label="CDM number" value={displayText(row.cdmNumber)} valueClassName="font-mono" />
        ) : null}
        {onlineTransfer > 0 ? (
          <SummaryField
            label="Online transfer"
            value={formatMoney(onlineTransfer)}
            valueClassName="tabular-nums text-sky-800"
          />
        ) : null}
        {row.onlineTransferReference ? (
          <SummaryField
            label="Transfer reference"
            value={displayText(row.onlineTransferReference)}
            valueClassName="font-mono"
          />
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
      {Array.isArray(row.billCashAllocations) && row.billCashAllocations.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment by bill</p>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {row.billCashAllocations.map((b) => (
              <li
                key={b.billId}
                className="rounded-lg bg-emerald-50/80 px-3 py-2 ring-1 ring-emerald-100 tabular-nums"
              >
                {b.billDate || '—'}
                <span className="ml-2 font-semibold text-emerald-900">{formatMoney(b.cashAmount)}</span>
                {b.billTotal != null && b.billTotal !== '' ? (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    bill {formatMoney(b.billTotal)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : Array.isArray(row.appliedBills) && row.appliedBills.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applied to bills</p>
          <ul className="space-y-1.5 text-sm text-slate-700">
            {row.appliedBills.map((b) => (
              <li
                key={b.id}
                className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100 tabular-nums"
              >
                {b.date || '—'}
                {b.totalAmount != null && b.totalAmount !== '' ? (
                  <span className="ml-2 font-medium text-slate-900">{formatMoney(b.totalAmount)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function PromotionDetailContent({ row }) {
  const { brands } = useBagProducts();
  const type = String(row?.type ?? '').trim();
  const promoKind =
    type === 'invoice_discount' ? 'Invoice discount' : type === 'target_promotion' ? 'Target promotion' : 'Free bag issue';
  const totalBags = brands.reduce((sum, b) => sum + (Number(row[`${b.key}Bags`]) || 0), 0);
  const amount = Number(row.discountAmount) || 0;

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Type" value={promoKind} />
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField
          label="Bill / Invoice"
          value={row.invoiceNumber || (row.billNumber ? `#${row.billNumber}` : '—')}
          valueClassName="font-mono"
        />
        <SummaryField label="Customer" value={displayText(row.customerName)} className="col-span-2 sm:col-span-1" />
        <SummaryField label="Recorded by" value={displayText(row.enteredBy || row.addedBy)} />
        {amount > 0 ? (
          <SummaryField
            label="Amount"
            value={new Intl.NumberFormat(undefined, { style: 'currency', currency: 'LKR' }).format(amount)}
            className="col-span-2 bg-emerald-50 ring-emerald-100"
            valueClassName="tabular-nums font-semibold text-emerald-900"
          />
        ) : (
          <SummaryField
            label="Total free bags"
            value={totalBags}
            className="col-span-2 bg-indigo-50 ring-indigo-100"
            valueClassName="tabular-nums font-semibold text-indigo-900"
          />
        )}
      </SummaryGrid>
      {row.reason ? <NoteBlock label="Reason" value={row.reason} /> : null}
      {type === 'invoice_discount' && row.discountMode ? (
        <NoteBlock
          label="Discount"
          value={
            row.discountMode === 'per_bag'
              ? `${row.discountValue} LKR per bag`
              : `${row.discountValue} LKR for whole invoice`
          }
        />
      ) : null}
      {type === 'free_bags' || !type ? (
        <BrandSections title="Free bags by brand">
          {brands.map((b) => {
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
      ) : null}
    </>
  );
}

function UnloadRequestDetailContent({ row }) {
  const { brands } = useBagProducts();
  const totalBags = brands.reduce((sum, b) => sum + (Number(row[`${b.key}Bags`]) || 0), 0);
  const status = displayText(row.status || 'pending');

  return (
    <>
      <SummaryGrid>
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Status" value={status} valueClassName="capitalize" />
        <SummaryField label="Shop" value={displayText(row.customerName)} className="col-span-2 sm:col-span-1" />
        <SummaryField label="Driver" value={displayText(row.driverName)} />
        <SummaryField label="Submitted" value={formatDateTime(row.createdAt)} className="col-span-2 sm:col-span-1" />
        <SummaryField
          label="Total bags"
          value={totalBags}
          className="col-span-2 bg-emerald-50 ring-emerald-100"
          valueClassName="tabular-nums font-semibold text-emerald-900"
        />
      </SummaryGrid>
      {row.note ? <NoteBlock label="Driver note" value={row.note} /> : null}
      <BrandSections title="Bags by brand">
        {brands.map((b) => {
          const bags = Number(row[`${b.key}Bags`]) || 0;
          const active = brandHasBags(row, b.key);
          return (
            <BrandSectionShell key={b.key} brand={b} active={active} emptyText="No bags for this brand">
              <dl className="grid grid-cols-1 gap-px bg-slate-100">
                <BrandFieldCell brand={b} lead label="Bags" value={bags} valueClassName="tabular-nums font-semibold text-slate-900" />
              </dl>
            </BrandSectionShell>
          );
        })}
      </BrandSections>
    </>
  );
}

function poChequeStatusLabel(chequeDate) {
  const d = String(chequeDate ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return d <= today ? 'Deducted from bank balance' : 'Pending (cash out on converting date)';
}

function PurchaseOrderDetailContent({ row }) {
  const cheques = Array.isArray(row.cheques) ? row.cheques : [];

  return (
    <>
      {row.cancelled ? (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 ring-1 ring-rose-100">
          Cancelled{row.cancelledBy ? ` by ${row.cancelledBy}` : ''}
          {row.cancelledAt ? ` · ${formatDateTime(row.cancelledAt)}` : ''}
        </p>
      ) : null}
      <SummaryGrid>
        <SummaryField label="PO number" value={displayText(row.poNumber)} valueClassName="font-mono font-semibold" />
        <SummaryField label="Date" value={displayText(row.date)} />
        <SummaryField label="Distributor" value={displayText(row.distributorName)} className="col-span-2" />
        <SummaryField
          label="Distribution location"
          value={displayText(row.distributionLocation)}
          className="col-span-2"
        />
        <SummaryField label="Product" value={displayText(row.product)} className="col-span-2" />
        <SummaryField
          label="Amount"
          value={Number(row.quantity) || 0}
          valueClassName="tabular-nums"
        />
        <SummaryField
          label="Invoice price / unit"
          value={formatMoney(row.unitPrice)}
          valueClassName="tabular-nums"
        />
        <SummaryField
          label="Total invoice amount"
          value={formatMoney(row.lineTotal ?? row.totalAmount)}
          className="col-span-2 bg-indigo-50 ring-indigo-100"
          valueClassName="tabular-nums font-semibold text-indigo-900"
        />
        <SummaryField label="Lorry" value={displayText(row.vehicleNumber)} />
        <SummaryField label="Driver" value={displayText(row.driverName)} />
        <SummaryField
          label="Cheque mode"
          value={
            row.chequeMode === 'perProduct'
              ? 'Per product'
              : row.chequeMode === 'shared'
                ? 'Whole order'
                : '—'
          }
        />
        <SummaryField label="Created by" value={displayText(row.createdBy)} />
        <SummaryField label="Created" value={formatDateTime(row.createdAt)} />
      </SummaryGrid>
      {row.doorStock || String(row.notes ?? '').trim() ? (
        <NoteBlock label="Notes" value={doorStepNotesText(row) || 'Door step'} />
      ) : null}
      {cheques.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payments</p>
          {cheques.map((c, i) => (
            <div
              key={`${c.paymentType || 'chq'}-${c.chequeNumber || 'cash'}-${i}`}
              className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100"
            >
              <p className="text-sm font-medium text-slate-900">{formatPoChequeWithBank(c)}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {isPoCashPayment(c) ? (
                  <>
                    Paid in cash on {displayText(row.date)}
                    {c.amount != null && Number(c.amount) > 0 ? ` · ${formatMoney(c.amount)}` : ''}
                  </>
                ) : (
                  <>
                    Converting date {displayText(c.chequeDate)}
                    {c.amount != null && Number(c.amount) > 0 ? ` · ${formatMoney(c.amount)}` : ''}
                  </>
                )}
              </p>
              {!isPoCashPayment(c) && poChequeStatusLabel(c.chequeDate) && (c.bankAccountId || c.amount) ? (
                <p
                  className={`mt-1 text-xs font-medium ${
                    String(c.chequeDate ?? '').slice(0, 10) <=
                    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
                      ? 'text-emerald-800'
                      : 'text-amber-800'
                  }`}
                >
                  {poChequeStatusLabel(c.chequeDate)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-400">No payments recorded on this PO.</p>
      )}
    </>
  );
}

function UserDetailContent({ row }) {
  const isDriver = String(row.role || '').toLowerCase() === 'driver';
  const isManager = String(row.role || '').toLowerCase() === 'manager';
  const accessLabels = Array.isArray(row.access)
    ? row.access
        .map((key) => MANAGER_ACCESS_OPTIONS.find((o) => o.key === key)?.label || key)
        .filter(Boolean)
    : [];
  return (
    <>
      <SummaryGrid>
        <SummaryField label="Name" value={displayText(row.name || row.username)} className="col-span-2" />
        <SummaryField label="Role" value={displayText(row.role)} />
        <SummaryField label="Contact" value={displayText(row.contact)} />
        <SummaryField label="NIC" value={displayText(row.nic)} className="col-span-2" valueClassName="font-mono" />
        {isDriver ? (
          <SummaryField
            label="Driver license"
            value={displayText(row.driverLicense)}
            className="col-span-2"
            valueClassName="font-mono"
          />
        ) : null}
        <SummaryField label="Added" value={formatDateTime(row.createdAt)} />
        <SummaryField label="Created by" value={displayText(row.createdBy)} />
      </SummaryGrid>
      {isManager ? <ChipList label="Dashboard access" items={accessLabels} /> : null}
    </>
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
  const { brands } = useBagProducts();
  return (
    <BrandSections title="Stock movement by brand">
      {brands.map((b) => {
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

function PoChequeDetailContent({ row }) {
  const chequeLabel =
    row.accountLabel && row.chequeNumber
      ? `${row.accountLabel} · #${row.chequeNumber}`
      : row.chequeNumber
        ? `#${row.chequeNumber}`
        : displayText(row.accountLabel);
  return (
    <SummaryGrid>
      <SummaryField label="Converting date" value={displayText(row.chequeDate)} />
      <SummaryField label="Cheque" value={chequeLabel} valueClassName="font-mono" className="col-span-2" />
      <SummaryField label="Bank account" value={displayText(row.accountLabel)} className="col-span-2" />
      <SummaryField label="Product" value={displayText(row.product)} />
      <SummaryField label="PO id" value={displayText(row.poId)} valueClassName="font-mono text-xs" />
      <SummaryField
        label="Amount"
        value={formatMoney(row.amount)}
        className="col-span-2 bg-rose-50 ring-rose-100"
        valueClassName="font-semibold tabular-nums text-rose-900"
      />
      {row.futureDated ? (
        <SummaryField
          label="Status"
          value="Pending (future dated)"
          className="col-span-2 bg-amber-50 ring-amber-100"
          valueClassName="font-semibold text-amber-900"
        />
      ) : (
        <SummaryField
          label="Status"
          value="Cleared on converting date"
          className="col-span-2 bg-slate-50 ring-slate-100"
          valueClassName="font-semibold text-slate-800"
        />
      )}
    </SummaryGrid>
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
        {row.chequeReturned ? (
          <SummaryField
            label="Return status"
            value="Marked as returned"
            className="col-span-2 bg-rose-50 ring-rose-100"
            valueClassName="font-semibold text-rose-900"
          />
        ) : null}
        {row.chequeReturned && row.chequeReturnedBy ? (
          <SummaryField label="Returned by" value={displayText(row.chequeReturnedBy)} />
        ) : null}
        {row.chequeReturned && row.chequeReturnedAt ? (
          <SummaryField label="Returned at" value={displayText(row.chequeReturnedAt)} />
        ) : null}
      </SummaryGrid>
    </>
  );
}

function CompanyChequeDetailContent({ row }) {
  return (
    <>
      <SummaryGrid>
        <SummaryField label="Cheque date" value={displayText(row.chequeDate)} />
        <SummaryField label="Received date" value={displayText(row.receivedDate)} />
        <SummaryField label="Cheque #" value={displayText(row.chequeNumber)} valueClassName="font-mono" />
        <SummaryField label="Note" value={displayText(row.description)} className="col-span-2 sm:col-span-1" />
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

function OwnerChequeDetailContent({ row }) {
  return (
    <>
      <SummaryGrid>
        <SummaryField label="Cheque date" value={displayText(row.chequeDate)} />
        <SummaryField label="Received date" value={displayText(row.receivedDate)} />
        <SummaryField label="Cheque #" value={displayText(row.chequeNumber)} valueClassName="font-mono" />
        <SummaryField label="Note" value={displayText(row.description)} className="col-span-2 sm:col-span-1" />
        <SummaryField
          label="Cheque amount"
          value={formatMoney(row.amount)}
          className="col-span-2 bg-amber-50 ring-amber-100"
          valueClassName="font-semibold tabular-nums text-amber-900"
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
