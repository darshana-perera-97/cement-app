import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isAdmin } from '../auth';
import { modalPanelClass4xl } from './tableToolbar';
import { loadShopDetailsForPdf, paymentReceiptPdfBlobUrl } from './paymentReceiptPdf';

function DocumentGlyph({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6.75 3A1.75 1.75 0 005 4.75v14.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0019 19.25V9.414a1.75 1.75 0 00-.513-1.238l-4.663-4.663A1.75 1.75 0 0012.586 3H6.75zM13 4.561L17.439 9H13.75A.75.75 0 0113 8.25V4.56zM8.75 12a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zM8.75 15.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" />
    </svg>
  );
}

export default function PaymentReceiptPdfButton({ payment }) {
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const previewUrlRef = useRef(null);

  const closePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewFilename('');
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!previewUrl) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closePreview();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [previewUrl, closePreview]);

  if (!isAdmin() || !payment) return null;

  const handleView = async () => {
    setBusy(true);
    try {
      const shop = await loadShopDetailsForPdf();
      const preview = paymentReceiptPdfBlobUrl(payment, shop);
      if (!preview) return;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = preview.url;
      setPreviewUrl(preview.url);
      setPreviewFilename(preview.filename);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleView}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-100 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <DocumentGlyph className="h-4 w-4" />
        {busy ? 'Generating…' : 'View receipt PDF'}
      </button>
      {previewUrl
        ? createPortal(
            <div
              className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="receipt-preview-title"
            >
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                aria-label="Close"
                onClick={closePreview}
              />
              <div
                className={`${modalPanelClass4xl} flex max-h-[min(96dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-[42rem]`}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
                  <h2 id="receipt-preview-title" className="text-sm font-semibold text-slate-900 sm:text-base">
                    Payment receipt (A5)
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={previewUrl}
                      download={previewFilename || 'receipt.pdf'}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={closePreview}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <iframe
                  title="Payment receipt PDF preview"
                  src={previewUrl}
                  className="min-h-[70vh] w-full flex-1 border-0 bg-slate-100"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
