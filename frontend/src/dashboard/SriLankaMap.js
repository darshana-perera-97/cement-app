import { useEffect, useRef, useState } from 'react';
import { isStockUpdateStale, shopLowStockItems } from '../stockUpdateSettings';

export const SRI_LANKA = {
  west: 79.42,
  south: 5.72,
  east: 81.95,
  north: 9.98,
  centerLat: 7.8731,
  centerLng: 80.7718,
};

export function isInSriLanka(lat, lng) {
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return false;
  return y >= SRI_LANKA.south && y <= SRI_LANKA.north && x >= SRI_LANKA.west && x <= SRI_LANKA.east;
}

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

let leafletPromise = null;

function loadLeaflet() {
  if (typeof window !== 'undefined' && window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    const existing = document.querySelector('script[data-leaflet]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L));
      existing.addEventListener('error', () => reject(new Error('Could not load map')));
      return;
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.setAttribute('data-leaflet', '1');
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error('Could not load map'));
    document.body.appendChild(script);
  });
  return leafletPromise;
}

function sriLankaBounds(L) {
  return L.latLngBounds([SRI_LANKA.south, SRI_LANKA.west], [SRI_LANKA.north, SRI_LANKA.east]);
}

function hasMapSize(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
}

function refreshMapSize(map, el) {
  if (!map || (el && !hasMapSize(el))) return false;
  map.invalidateSize({ animate: false });
  return true;
}

function frameSriLanka(map, el) {
  if (!map || !window.L) return;
  if (!refreshMapSize(map, el)) return;
  map.setView([SRI_LANKA.centerLat, SRI_LANKA.centerLng], 8, { animate: false });
  map.fitBounds(sriLankaBounds(window.L), { padding: [28, 28], maxZoom: 8, animate: false });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shopPinColor(selected, stale, lowStock) {
  if (lowStock) return '#ea580c';
  if (stale) return '#dc2626';
  if (selected) return '#4f46e5';
  return '#0f766e';
}

function shopDivIcon(L, shop, selected, stale, lowStock) {
  const color = shopPinColor(selected, stale, lowStock);
  const label = escapeHtml(shop.name || 'Shop');
  return L.divIcon({
    className: 'map-shop-icon',
    iconSize: [148, 44],
    iconAnchor: [74, 44],
    html: `<div class="map-shop-pin">
      <span class="map-shop-pin-label" style="background:${color}">${label}</span>
      <span class="map-shop-pin-arrow" style="border-top-color:${color}"></span>
    </div>`,
  });
}

function userLocationIcon(L) {
  return L.divIcon({
    className: 'map-user-icon',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div style="transform:translate(-50%,-50%);pointer-events:none;">
      <span style="position:relative;display:block;width:18px;height:18px;">
        <span style="position:absolute;inset:0;border-radius:999px;background:#2563eb;opacity:.28;animation:map-user-pulse 1.6s ease-out infinite;"></span>
        <span style="position:absolute;inset:3px;border-radius:999px;background:#2563eb;border:2px solid #fff;box-shadow:0 2px 8px rgba(37,99,235,.45);"></span>
      </span>
    </div>`,
  });
}

function formatUpdatedAt(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shopStockTooltipHtml(shop, stockRow, stale, staleDays, lowItems) {
  const title = escapeHtml(shop.name || 'Shop');
  const updatedAt = formatUpdatedAt(stockRow?.updatedAt);
  const items = updatedAt && Array.isArray(stockRow?.items)
    ? stockRow.items.filter((i) => String(i.label || i.key || '').trim())
    : [];
  const lowNote =
    Array.isArray(lowItems) && lowItems.length > 0
      ? `<div style="margin-top:4px;color:#ea580c;font-weight:600">Low stock: ${escapeHtml(
          lowItems.map((item) => `${item.label} ${item.bags}`).join(', '),
        )}</div>`
      : '';
  const staleNote = stale
    ? `<div style="margin-top:4px;color:#dc2626;font-weight:600">${
        updatedAt ? `Older than ${Number(staleDays) || 7} days` : 'No stock update yet'
      }</div>`
    : '';
  if (!updatedAt || items.length === 0) {
    return `<div style="min-width:8rem"><strong>${title}</strong>${lowNote}${staleNote || '<div style="margin-top:4px;color:#64748b">No stock update yet</div>'}</div>`;
  }
  const rows = items
    .map((item) => {
      const name = escapeHtml(item.label || item.key);
      const bags = Number(item.bags);
      const qty = Number.isFinite(bags) ? bags : 0;
      return `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:2px"><span>${name}</span><span style="font-variant-numeric:tabular-nums;font-weight:600">${qty}</span></div>`;
    })
    .join('');
  return `<div style="min-width:9rem"><strong>${title}</strong><div style="margin-top:4px;color:#64748b">${escapeHtml(updatedAt)}</div>${lowNote}${staleNote}${rows}</div>`;
}

export default function SriLankaMap({
  shops = [],
  selectedId = '',
  placing = false,
  layoutKey = '',
  onSelect,
  onMapClick,
  className = '',
  userLocation = null,
  followUser = false,
  stockByShopId = null,
  showStockHover = false,
  staleDays = 7,
  lowStockAlerts = [],
}) {
  const wrapRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(null);
  const clickRef = useRef(onMapClick);
  const selectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    clickRef.current = onMapClick;
    selectRef.current = onSelect;
  }, [onMapClick, onSelect]);

  useEffect(() => {
    let cancelled = false;
    let observer;
    let framed = false;

    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const bounds = sriLankaBounds(L);
        const map = L.map(containerRef.current, {
          center: [SRI_LANKA.centerLat, SRI_LANKA.centerLng],
          zoom: 8,
          zoomControl: true,
          attributionControl: true,
          maxBounds: bounds.pad(0.12),
          maxBoundsViscosity: 0.9,
          minZoom: 6,
          maxZoom: 16,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
        }).addTo(map);
        map.on('click', (e) => {
          const lat = Number(e.latlng?.lat);
          const lng = Number(e.latlng?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          clickRef.current?.({ lat, lng });
        });
        markersRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setReady(true);
        const tryFrame = () => {
          if (cancelled || framed || !hasMapSize(containerRef.current)) return;
          framed = true;
          frameSriLanka(map, containerRef.current);
        };
        tryFrame();
        window.requestAnimationFrame(tryFrame);
        if (typeof ResizeObserver !== 'undefined' && wrapRef.current) {
          observer = new ResizeObserver(() => {
            if (!refreshMapSize(map, containerRef.current)) return;
            tryFrame();
          });
          observer.observe(wrapRef.current);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      setReady(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const map = mapRef.current;
    if (!map) return undefined;
    const refresh = () => refreshMapSize(map, containerRef.current);
    const t0 = window.requestAnimationFrame(refresh);
    const t1 = window.setTimeout(refresh, 50);
    const t2 = window.setTimeout(refresh, 280);
    return () => {
      window.cancelAnimationFrame(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [className, placing, layoutKey, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const group = markersRef.current;
    if (!map || !group || !window.L) return;
    group.clearLayers();
    shops.forEach((shop) => {
      if (!isInSriLanka(shop.lat, shop.lng)) return;
      const stockRow = stockByShopId?.[shop.id];
      const stale = isStockUpdateStale(stockRow?.updatedAt, staleDays);
      const lowItems = shopLowStockItems(stockRow, lowStockAlerts);
      const lowStock = lowItems.length > 0;
      const marker = window.L.marker([shop.lat, shop.lng], {
        icon: shopDivIcon(window.L, shop, shop.id === selectedId, stale, lowStock),
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: 400,
      });
      marker.on('click', (e) => {
        window.L.DomEvent.stopPropagation(e);
        window.L.DomEvent.preventDefault(e);
        selectRef.current?.(shop);
      });
      if (showStockHover) {
        marker.bindTooltip(shopStockTooltipHtml(shop, stockRow, stale, staleDays, lowItems), {
          direction: 'top',
          offset: [0, -36],
          opacity: 0.96,
          interactive: false,
          className: 'map-shop-stock-tooltip',
        });
      }
      group.addLayer(marker);
    });
    const userLat = Number(userLocation?.lat);
    const userLng = Number(userLocation?.lng);
    if (Number.isFinite(userLat) && Number.isFinite(userLng)) {
      const accuracy = Number(userLocation.accuracy);
      if (Number.isFinite(accuracy) && accuracy > 8) {
        group.addLayer(
          window.L.circle([userLat, userLng], {
            radius: Math.min(accuracy, 250),
            color: '#2563eb',
            weight: 1,
            fillColor: '#3b82f6',
            fillOpacity: 0.12,
            interactive: false,
          }),
        );
      }
      group.addLayer(
        window.L.marker([userLat, userLng], {
          icon: userLocationIcon(window.L),
          keyboard: false,
          zIndexOffset: 800,
        }).bindTooltip('You are here', { direction: 'right', offset: [10, 0] }),
      );
    }
  }, [shops, selectedId, ready, userLocation, stockByShopId, showStockHover, staleDays, lowStockAlerts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followUser || !userLocation) return;
    const lat = Number(userLocation.lat);
    const lng = Number(userLocation.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: true });
  }, [followUser, userLocation?.lat, userLocation?.lng, ready]);

  return (
    <div
      ref={wrapRef}
      className={`absolute inset-0 z-0 bg-slate-200 ${placing ? 'cursor-crosshair' : ''} ${className}`.trim()}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ position: 'absolute', inset: 0, height: '100%', width: '100%' }}
      />
      <style>{`
        @keyframes map-user-pulse {
          0% { transform: scale(1); opacity: .35; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        .map-shop-icon {
          background: transparent !important;
          border: none !important;
        }
        .map-shop-pin {
          display: flex;
          height: 44px;
          width: 148px;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          cursor: pointer;
          pointer-events: auto;
        }
        .map-shop-pin-label {
          max-width: 9rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border-radius: 999px;
          color: #fff;
          padding: 4px 8px;
          font: 600 11px/1.2 system-ui, sans-serif;
          box-shadow: 0 4px 10px rgba(15, 23, 42, 0.25);
          pointer-events: auto;
        }
        .map-shop-pin-arrow {
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid #0f766e;
        }
        .map-shop-stock-tooltip {
          border: 0;
          border-radius: 12px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
          font: 12px/1.35 system-ui, sans-serif;
          padding: 8px 10px;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
