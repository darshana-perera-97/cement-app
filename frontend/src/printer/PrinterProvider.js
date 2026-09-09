import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '../apiBase';
import {
  LoadingSpinner,
  ModalBackdrop,
  modalPanelClassMd,
} from '../dashboard/tableToolbar';
import {
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  getPrinterConnection,
  printTestPage,
  reconnectLastPrinter,
  subscribePrinterConnection,
  updatePrinterProperties,
} from './bluetoothPrinter';
import { printScenarioReceipt } from './printerReceipts';
import {
  EMPTY_PRINTER_SETTINGS,
  PRINTER_SETTINGS_CHANGED,
  PRINTER_SCENARIOS,
  shouldAutoPrintScenario,
  shouldShowPrinterIndicator,
} from './printerSettings';

const apiBase = getApiBase();
const PrinterContext = createContext(null);

const SCENARIO_TITLES = Object.fromEntries(PRINTER_SCENARIOS.map((s) => [s.key, s.label]));

export function usePrinter() {
  const ctx = useContext(PrinterContext);
  if (!ctx) {
    throw new Error('usePrinter must be used within PrinterProvider');
  }
  return ctx;
}

export function usePrinterOptional() {
  return useContext(PrinterContext);
}

export function PrinterProvider({ children }) {
  const [settings, setSettings] = useState(EMPTY_PRINTER_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [shop, setShop] = useState(null);
  const [connection, setConnection] = useState(() => getPrinterConnection());
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [printJob, setPrintJob] = useState(null);
  const printResolver = useRef(null);
  const printChain = useRef(Promise.resolve());

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/printer-settings`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSettings({ ...EMPTY_PRINTER_SETTINGS, ...data, scenarios: { ...EMPTY_PRINTER_SETTINGS.scenarios, ...(data.scenarios || {}) } });
    } catch {
      /* keep last */
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadShop = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/shop`);
      if (res.ok) setShop(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadShop();
    const onChanged = () => loadSettings();
    window.addEventListener(PRINTER_SETTINGS_CHANGED, onChanged);
    window.addEventListener('shop-name-updated', loadShop);
    return () => {
      window.removeEventListener(PRINTER_SETTINGS_CHANGED, onChanged);
      window.removeEventListener('shop-name-updated', loadShop);
    };
  }, [loadSettings, loadShop]);

  useEffect(() => subscribePrinterConnection(setConnection), []);

  const showIndicator = shouldShowPrinterIndicator(settings);

  useEffect(() => {
    if (!showIndicator) return undefined;
    reconnectLastPrinter();
    return undefined;
  }, [showIndicator]);

  const openConnectModal = useCallback(() => {
    setActionError('');
    setConnectOpen(true);
  }, []);

  const closeConnectModal = useCallback(() => {
    if (connectBusy || testBusy) return;
    setConnectOpen(false);
    setActionError('');
  }, [connectBusy, testBusy]);

  const handleConnect = useCallback(async () => {
    setConnectBusy(true);
    setActionError('');
    try {
      await connectBluetoothPrinter();
    } catch (e) {
      setActionError(e?.message || 'Could not connect.');
    } finally {
      setConnectBusy(false);
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    disconnectBluetoothPrinter();
    setActionError('');
  }, []);

  const handleTestPrint = useCallback(async () => {
    setTestBusy(true);
    setActionError('');
    try {
      await printTestPage();
    } catch (e) {
      setActionError(e?.message || 'Test print failed.');
    } finally {
      setTestBusy(false);
    }
  }, []);

  const closePrintJob = useCallback((proceed) => {
    const resolve = printResolver.current;
    printResolver.current = null;
    setPrintJob(null);
    if (resolve) resolve(proceed);
  }, []);

  const askPrintCopy = useCallback((job) => {
    return new Promise((resolve) => {
      printResolver.current = resolve;
      setPrintJob(job);
    });
  }, []);

  const requestAutoPrint = useCallback(
    (scenarioKey, payload) => {
      printChain.current = printChain.current
        .catch(() => {})
        .then(async () => {
          if (!payload) return;
          const live = getPrinterConnection();
          if (!shouldAutoPrintScenario(settings, scenarioKey, live.connected)) return;
          const copies = Math.max(1, Number(settings.scenarios?.[scenarioKey]?.copies) || 1);
          const title = SCENARIO_TITLES[scenarioKey] || 'Receipt';
          for (let copy = 1; copy <= copies; copy += 1) {
            const proceed = await askPrintCopy({
              title,
              scenarioKey,
              copy,
              total: copies,
              error: '',
            });
            if (!proceed) return;
            try {
              await printScenarioReceipt(scenarioKey, payload, shop);
            } catch (e) {
              const retry = await askPrintCopy({
                title,
                scenarioKey,
                copy,
                total: copies,
                error: e?.message || 'Print failed.',
              });
              if (retry) {
                copy -= 1;
                continue;
              }
              return;
            }
          }
        });
      return printChain.current;
    },
    [askPrintCopy, connection.connected, settings, shop],
  );

  const value = useMemo(
    () => ({
      settings,
      settingsLoading,
      connection,
      showIndicator,
      openConnectModal,
      closeConnectModal,
      requestAutoPrint,
      reloadSettings: loadSettings,
    }),
    [
      settings,
      settingsLoading,
      connection,
      showIndicator,
      openConnectModal,
      closeConnectModal,
      requestAutoPrint,
      loadSettings,
    ],
  );

  return (
    <PrinterContext.Provider value={value}>
      {children}
      {showIndicator && connectOpen ? (
        <PrinterConnectModal
          connection={connection}
          busy={connectBusy}
          testBusy={testBusy}
          error={actionError}
          onClose={closeConnectModal}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onTestPrint={handleTestPrint}
        />
      ) : null}
      {printJob ? (
        <PrintConfirmModal job={printJob} onPrint={() => closePrintJob(true)} onSkip={() => closePrintJob(false)} />
      ) : null}
    </PrinterContext.Provider>
  );
}

export function PrinterStatusButton() {
  const printer = usePrinterOptional();
  if (!printer?.showIndicator) return null;
  const { connection, openConnectModal } = printer;
  const connected = connection.connected;
  const label = !connection.available
    ? 'Unsupported'
    : connection.connecting
      ? 'Connecting…'
      : connected
        ? 'Connected'
        : 'Off';
  const tone = !connection.available
    ? 'bg-slate-100 text-slate-600 ring-slate-200'
    : connected
      ? 'bg-sky-50 text-sky-800 ring-sky-200'
      : connection.connecting
        ? 'bg-amber-50 text-amber-800 ring-amber-200'
        : 'bg-slate-100 text-slate-600 ring-slate-200';
  const dotTone = connected ? 'bg-sky-500' : connection.connecting ? 'bg-amber-500' : 'bg-slate-400';
  const title = connected
    ? `Bluetooth printer connected${connection.deviceName ? `: ${connection.deviceName}` : ''}. Click to manage.`
    : 'Bluetooth printer. Click to scan and connect.';

  return (
    <button
      type="button"
      onClick={openConnectModal}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold ring-1 transition hover:opacity-90 sm:gap-2 sm:px-3 sm:py-2 ${tone}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {connected ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotTone}`} />
      </span>
      <BluetoothGlyph className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Printer</span>
      <span className="max-w-[4.5rem] truncate tabular-nums sm:max-w-none">{label}</span>
    </button>
  );
}

function BluetoothGlyph({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13.5 2.1a.75.75 0 00-1.28.53v7.16l-3.22-3.22a.75.75 0 10-1.06 1.06L11.69 12l-3.75 3.75a.75.75 0 101.06 1.06l3.22-3.22v7.16a.75.75 0 001.28.53l5.25-4.2a.75.75 0 00.03-1.16L15.06 12l4.75-3.8a.75.75 0 00-.03-1.16l-5.28-4.94zM13.5 6.4l2.62 2.1-2.62 2.1V6.4zm0 7.1l2.62 2.1-2.62 2.1v-4.2z" />
    </svg>
  );
}

function PrinterConnectModal({ connection, busy, testBusy, error, onClose, onConnect, onDisconnect, onTestPrint }) {
  const connected = connection.connected;
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="printer-connect-title">
      <ModalBackdrop onClose={onClose} />
      <div className={`${modalPanelClassMd} z-10`}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="printer-connect-title" className="text-lg font-bold text-slate-900">
              Bluetooth printer
            </h2>
            <p className="mt-1 text-sm text-slate-500">Scan nearby 80mm XPrinter devices, connect, and check printer properties.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-50">
            Close
          </button>
        </div>

        {!connection.available ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
            This browser cannot use Web Bluetooth. Open the app in Chrome or Edge on a computer or Android phone with Bluetooth.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</dt>
            <dd className={`text-sm font-semibold ${connected ? 'text-emerald-700' : 'text-slate-700'}`}>
              {busy ? 'Connecting…' : connected ? 'Connected' : 'Not connected'}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Printer</dt>
            <dd className="truncate text-sm text-slate-800">{connection.deviceName || '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Paper</dt>
            <dd className="text-sm text-slate-800">80mm thermal</dd>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Chars / line</span>
            <select
              className="rounded-lg border-0 bg-white px-2 py-1.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              value={connection.charsPerLine}
              onChange={(e) => updatePrinterProperties({ charsPerLine: Number(e.target.value) })}
            >
              <option value={48}>48 (standard 80mm)</option>
              <option value={42}>42 (narrow font)</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Feed after print</span>
            <input
              type="number"
              min={0}
              max={8}
              className="w-20 rounded-lg border-0 bg-white px-2 py-1.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              value={connection.feedLines}
              onChange={(e) => updatePrinterProperties({ feedLines: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
              checked={connection.autoCut}
              onChange={(e) => updatePrinterProperties({ autoCut: e.target.checked })}
            />
            <span className="text-sm text-slate-700">Cut paper after each copy</span>
          </label>
        </dl>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {connected ? (
            <>
              <button
                type="button"
                onClick={onTestPrint}
                disabled={testBusy}
                className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-60"
              >
                {testBusy ? 'Printing…' : 'Test print'}
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={busy || !connection.available}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? <LoadingSpinner size="sm" label="Scanning…" /> : 'Scan and connect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PrintConfirmModal({ job, onPrint, onSkip }) {
  const failed = Boolean(job.error);
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="print-confirm-title">
      <ModalBackdrop onClose={onSkip} />
      <div className={`${modalPanelClassMd} z-10`}>
        <h2 id="print-confirm-title" className="text-lg font-bold text-slate-900">
          {failed ? 'Print failed' : `Print ${job.title.toLowerCase()}?`}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Copy {job.copy} of {job.total}. Confirm to send this copy to the 80mm Bluetooth printer.
        </p>
        {failed ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {job.error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {failed ? 'Skip remaining' : job.total > 1 ? 'Skip remaining' : 'Skip'}
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700"
          >
            {failed ? 'Retry this copy' : job.total > 1 ? `Print copy ${job.copy}` : 'Print'}
          </button>
        </div>
      </div>
    </div>
  );
}
