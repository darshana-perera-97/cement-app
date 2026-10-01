const STORAGE_KEY = 'cs-thermal-printer-props';

export const PRINTER_BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

const DEFAULT_PROPS = {
  charsPerLine: 48,
  autoCut: true,
  feedLines: 3,
  lastDeviceId: '',
  lastDeviceName: '',
};

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

let device = null;
let server = null;
let characteristic = null;
let connecting = false;
let lastError = '';
const listeners = new Set();
let printQueue = Promise.resolve();

let manualDisconnect = false;
let autoReconnectActive = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let watchingDevice = null;
let advertisementAbort = null;
let autoReconnectListenersBound = false;
let gestureCleanup = null;
let connectGeneration = 0;
let reconnectInFlight = null;

const RECONNECT_RETRY_MS = [800, 2000, 4000, 8000, 15000, 30000];

function bluetoothAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
}

function readProps() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROPS };
    const parsed = JSON.parse(raw);
    const chars = Number(parsed.charsPerLine) === 42 ? 42 : 48;
    const feed = Math.max(0, Math.min(8, Number(parsed.feedLines) || DEFAULT_PROPS.feedLines));
    return {
      charsPerLine: chars,
      autoCut: parsed.autoCut !== false,
      feedLines: feed,
      lastDeviceId: String(parsed.lastDeviceId ?? '').trim(),
      lastDeviceName: String(parsed.lastDeviceName ?? '').trim(),
    };
  } catch {
    return { ...DEFAULT_PROPS };
  }
}

function writeProps(next) {
  const merged = { ...readProps(), ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  emit();
  return merged;
}

function emit() {
  const state = getPrinterConnection();
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* ignore */
    }
  });
}

function isLinkUp() {
  return Boolean(characteristic && device?.gatt?.connected);
}

function resetLink() {
  if (device) {
    try {
      device.removeEventListener('gattserverdisconnected', onDisconnected);
    } catch {
      /* ignore */
    }
  }
  device = null;
  server = null;
  characteristic = null;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopAdvertisementWatch() {
  if (advertisementAbort) {
    try {
      advertisementAbort.abort();
    } catch {
      /* ignore */
    }
    advertisementAbort = null;
  }
  watchingDevice = null;
}

function disarmGestureReconnect() {
  if (gestureCleanup) {
    gestureCleanup();
    gestureCleanup = null;
  }
}

function armGestureReconnect() {
  if (typeof window === 'undefined' || gestureCleanup) return;
  const onGesture = () => {
    disarmGestureReconnect();
    if (!autoReconnectActive || manualDisconnect || isLinkUp() || connecting) return;
    reconnectLastPrinter();
  };
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);
  gestureCleanup = () => {
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };
}

function scheduleReconnect() {
  if (!autoReconnectActive || manualDisconnect || isLinkUp() || connecting) return;
  clearReconnectTimer();
  const delay = RECONNECT_RETRY_MS[Math.min(reconnectAttempt, RECONNECT_RETRY_MS.length - 1)];
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectLastPrinter();
  }, delay);
}

function onVisibilityOrFocus() {
  if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') {
    return;
  }
  if (!autoReconnectActive || manualDisconnect || isLinkUp()) return;
  reconnectAttempt = 0;
  reconnectLastPrinter();
}

function onBluetoothAvailability(event) {
  if (event && event.value === false) return;
  if (!autoReconnectActive || manualDisconnect || isLinkUp()) return;
  reconnectAttempt = 0;
  reconnectLastPrinter();
}

function canListPermittedDevices() {
  return bluetoothAvailable() && typeof navigator.bluetooth.getDevices === 'function';
}

function isLastPrinter(btDevice, props = readProps()) {
  if (!btDevice) return false;
  if (props.lastDeviceId && btDevice.id === props.lastDeviceId) return true;
  if (props.lastDeviceName && btDevice.name === props.lastDeviceName) return true;
  return false;
}

function dedupeDevices(list) {
  const out = [];
  const seen = new Set();
  for (const d of list) {
    if (!d) continue;
    const key = d.id || `name:${d.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

async function listPermittedDevices() {
  if (!canListPermittedDevices()) return [];
  try {
    const devices = await navigator.bluetooth.getDevices();
    return Array.isArray(devices) ? devices : [];
  } catch {
    return [];
  }
}

function disconnectProbeExtra(btDevice) {
  if (!btDevice || btDevice === device) return;
  try {
    btDevice.gatt?.disconnect();
  } catch {
    /* ignore */
  }
}

async function probeFirstPrinter(devices, generation) {
  const unique = dedupeDevices(devices);
  if (!unique.length) return null;
  const found = await Promise.all(
    unique.map(async (btDevice) => {
      try {
        if (generation !== connectGeneration || manualDisconnect || isLinkUp()) return null;
        if (!btDevice.gatt) return null;
        const gattServer = btDevice.gatt.connected ? btDevice.gatt : await btDevice.gatt.connect();
        if (generation !== connectGeneration || manualDisconnect) return null;
        const char = await pickWritableCharacteristic(gattServer);
        if (!char) {
          disconnectProbeExtra(btDevice);
          return null;
        }
        return btDevice;
      } catch {
        return null;
      }
    }),
  );
  const hits = found.filter(Boolean);
  const winner = hits[0] || null;
  for (const extra of hits.slice(1)) {
    if (extra !== winner) disconnectProbeExtra(extra);
  }
  return winner;
}

function watchLastPrinter(permitted, props = readProps()) {
  const match =
    (device && isLastPrinter(device, props) ? device : null) ||
    (Array.isArray(permitted) ? permitted.find((d) => isLastPrinter(d, props)) : null) ||
    null;
  if (match && !manualDisconnect && !isLinkUp()) {
    watchRememberedDevice(match);
  }
}

async function findRememberedDevice() {
  const props = readProps();
  if (!props.lastDeviceId && !props.lastDeviceName) return null;
  const devices = await listPermittedDevices();
  return devices.find((d) => isLastPrinter(d, props)) || null;
}

async function requestPrinterChooser() {
  return navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_BLE_SERVICES,
  });
}

async function watchRememberedDevice(btDevice) {
  if (!btDevice || typeof btDevice.watchAdvertisements !== 'function') return;
  if (watchingDevice === btDevice && advertisementAbort) return;
  stopAdvertisementWatch();
  advertisementAbort = new AbortController();
  watchingDevice = btDevice;
  const onAd = () => {
    if (manualDisconnect || isLinkUp() || connecting) return;
    reconnectAttempt = 0;
    reconnectLastPrinter();
  };
  try {
    btDevice.addEventListener('advertisementreceived', onAd);
    await btDevice.watchAdvertisements({ signal: advertisementAbort.signal });
  } catch {
    advertisementAbort = null;
    watchingDevice = null;
  }
}

function onDisconnected() {
  server = null;
  characteristic = null;
  if (!manualDisconnect) {
    lastError = lastError || 'Printer disconnected';
  }
  emit();
  if (!manualDisconnect && autoReconnectActive) {
    reconnectAttempt = 0;
    scheduleReconnect();
    if (device) watchRememberedDevice(device);
    findRememberedDevice()
      .then((match) => {
        if (match && !manualDisconnect && !isLinkUp()) return watchRememberedDevice(match);
        return undefined;
      })
      .catch(() => {});
  }
}

export function getPrinterConnection() {
  const props = readProps();
  return {
    available: bluetoothAvailable(),
    connected: Boolean(characteristic && device?.gatt?.connected),
    connecting,
    deviceName: device?.name || props.lastDeviceName || '',
    deviceId: device?.id || props.lastDeviceId || '',
    remembered: Boolean(props.lastDeviceId || props.lastDeviceName),
    error: lastError,
    charsPerLine: props.charsPerLine,
    autoCut: props.autoCut,
    feedLines: props.feedLines,
  };
}

export function subscribePrinterConnection(fn) {
  listeners.add(fn);
  fn(getPrinterConnection());
  return () => listeners.delete(fn);
}

export function updatePrinterProperties(partial) {
  return writeProps(partial);
}

function isWritable(char) {
  if (!char?.properties) return false;
  return Boolean(char.properties.write || char.properties.writeWithoutResponse);
}

async function pickWritableCharacteristic(gattServer) {
  const services = await gattServer.getPrimaryServices();
  for (const service of services) {
    let chars = [];
    try {
      chars = await service.getCharacteristics();
    } catch {
      continue;
    }
    const writable = chars.find(isWritable);
    if (writable) return writable;
  }
  return null;
}

async function bindDevice(nextDevice) {
  if (device && device !== nextDevice) {
    try {
      device.removeEventListener('gattserverdisconnected', onDisconnected);
      device.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    resetLink();
  } else if (device === nextDevice) {
    try {
      device.removeEventListener('gattserverdisconnected', onDisconnected);
    } catch {
      /* ignore */
    }
  }
  device = nextDevice;
  device.addEventListener('gattserverdisconnected', onDisconnected);
  if (device.gatt?.connected) {
    server = device.gatt;
  } else {
    server = await device.gatt.connect();
  }
  if (manualDisconnect) {
    try {
      device.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    resetLink();
    throw new Error('Printer disconnected');
  }
  characteristic = await pickWritableCharacteristic(server);
  if (!characteristic) {
    throw new Error('Connected, but this device has no writable Bluetooth printer characteristic.');
  }
  writeProps({
    lastDeviceId: device.id || '',
    lastDeviceName: device.name || 'Bluetooth printer',
  });
  lastError = '';
  manualDisconnect = false;
  reconnectAttempt = 0;
  clearReconnectTimer();
  stopAdvertisementWatch();
  disarmGestureReconnect();
}

export async function connectBluetoothPrinter() {
  if (!bluetoothAvailable()) {
    lastError = 'Web Bluetooth is not supported in this browser. Use Chrome or Edge on a device with Bluetooth.';
    emit();
    throw new Error(lastError);
  }
  connecting = true;
  connectGeneration += 1;
  lastError = '';
  emit();
  try {
    const nextDevice = await requestPrinterChooser();
    await bindDevice(nextDevice);
    emit();
    return getPrinterConnection();
  } catch (e) {
    const msg = e?.name === 'NotFoundError' ? 'No printer selected.' : e?.message || 'Could not connect to the printer.';
    lastError = msg;
    emit();
    throw new Error(msg);
  } finally {
    connecting = false;
    emit();
  }
}

export async function reconnectLastPrinter(options = {}) {
  if (options.force) manualDisconnect = false;
  if (!bluetoothAvailable()) return getPrinterConnection();
  if (manualDisconnect) return getPrinterConnection();
  if (isLinkUp()) return getPrinterConnection();
  if (reconnectInFlight) return reconnectInFlight;
  if (connecting) return getPrinterConnection();

  reconnectInFlight = (async () => {
    const generation = ++connectGeneration;
    lastError = '';
    try {
      const props = readProps();
      const permitted = await listPermittedDevices();
      if (generation !== connectGeneration) return getPrinterConnection();
      if (manualDisconnect || isLinkUp()) return getPrinterConnection();

      const lastCandidates = dedupeDevices([
        device?.gatt ? device : null,
        ...permitted.filter((d) => isLastPrinter(d, props)),
      ]);
      const otherCandidates = permitted.filter(
        (d) => !lastCandidates.some((x) => x.id && d.id && x.id === d.id),
      );

      watchLastPrinter(permitted, props);

      if (!lastCandidates.length && !otherCandidates.length) {
        if (options.force) {
          connecting = true;
          emit();
          const picked = await requestPrinterChooser();
          if (generation !== connectGeneration) return getPrinterConnection();
          await bindDevice(picked);
          emit();
          return getPrinterConnection();
        }
        if (autoReconnectActive && !manualDisconnect && !isLinkUp()) {
          scheduleReconnect();
          armGestureReconnect();
        }
        return getPrinterConnection();
      }

      connecting = true;
      emit();

      const lastProbe = probeFirstPrinter(lastCandidates, generation);
      const otherProbe = probeFirstPrinter(otherCandidates, generation);

      let match = await lastProbe;
      if (generation !== connectGeneration) return getPrinterConnection();
      if (match) {
        otherProbe
          .then((extra) => {
            if (extra && extra !== match) disconnectProbeExtra(extra);
          })
          .catch(() => {});
      } else {
        match = await otherProbe;
      }

      if (generation !== connectGeneration) return getPrinterConnection();
      if (!match && options.force) {
        match = await requestPrinterChooser();
      }
      if (generation !== connectGeneration) return getPrinterConnection();
      if (!match) {
        if (options.force) {
          lastError = props.lastDeviceName
            ? `Could not restore ${props.lastDeviceName}. Scan and select it once.`
            : 'No printer selected.';
        }
        if (autoReconnectActive && !manualDisconnect && !isLinkUp()) {
          scheduleReconnect();
          armGestureReconnect();
          watchLastPrinter(permitted, props);
        }
        return getPrinterConnection();
      }
      await bindDevice(match);
      emit();
    } catch (e) {
      if (generation !== connectGeneration) return getPrinterConnection();
      reconnectAttempt += 1;
      if (options.force) {
        lastError =
          e?.name === 'NotFoundError'
            ? 'No printer selected.'
            : e?.message || 'Could not restore the last printer.';
      } else {
        lastError = '';
      }
      findRememberedDevice()
        .then((match) => {
          if (match && !manualDisconnect && !isLinkUp()) return watchRememberedDevice(match);
          return undefined;
        })
        .catch(() => {});
      if (autoReconnectActive && !manualDisconnect && !isLinkUp()) {
        scheduleReconnect();
        armGestureReconnect();
      }
    } finally {
      if (generation === connectGeneration) {
        connecting = false;
      }
      reconnectInFlight = null;
      emit();
    }
    return getPrinterConnection();
  })();
  return reconnectInFlight;
}

export function startPrinterAutoReconnect() {
  autoReconnectActive = true;
  reconnectAttempt = 0;
  if (!autoReconnectListenersBound && typeof window !== 'undefined') {
    autoReconnectListenersBound = true;
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    if (navigator.bluetooth?.addEventListener) {
      navigator.bluetooth.addEventListener('availabilitychanged', onBluetoothAvailability);
    }
  }
  armGestureReconnect();
  return reconnectLastPrinter();
}

/** After login: restore the last printer and race any other permitted Bluetooth printers. */
export function beginLoginPrinterConnect() {
  if (!bluetoothAvailable()) return Promise.resolve(getPrinterConnection());
  manualDisconnect = false;
  reconnectAttempt = 0;
  return startPrinterAutoReconnect();
}

export function stopPrinterAutoReconnect() {
  autoReconnectActive = false;
  clearReconnectTimer();
  stopAdvertisementWatch();
  disarmGestureReconnect();
  if (autoReconnectListenersBound && typeof window !== 'undefined') {
    autoReconnectListenersBound = false;
    document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    window.removeEventListener('focus', onVisibilityOrFocus);
    if (navigator.bluetooth?.removeEventListener) {
      navigator.bluetooth.removeEventListener('availabilitychanged', onBluetoothAvailability);
    }
  }
}

export function disconnectBluetoothPrinter() {
  manualDisconnect = true;
  connectGeneration += 1;
  clearReconnectTimer();
  stopAdvertisementWatch();
  disarmGestureReconnect();
  try {
    device?.gatt?.disconnect();
  } catch {
    /* ignore */
  }
  resetLink();
  lastError = '';
  emit();
}

async function writeChunk(bytes) {
  if (!characteristic) throw new Error('Printer is not connected.');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (characteristic.properties.writeWithoutResponse) {
    await characteristic.writeValueWithoutResponse(buffer);
  } else {
    await characteristic.writeValue(buffer);
  }
}

export async function printRawBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!data.length) return;
  printQueue = printQueue.then(async () => {
    if (!characteristic || !device?.gatt?.connected) {
      throw new Error('Printer is not connected.');
    }
    const chunkSize = 180;
    for (let i = 0; i < data.length; i += chunkSize) {
      await writeChunk(data.subarray(i, i + chunkSize));
      await new Promise((r) => setTimeout(r, 20));
    }
  });
  return printQueue;
}

function pushBytes(out, ...vals) {
  for (const v of vals) {
    if (typeof v === 'number') out.push(v & 0xff);
    else if (v instanceof Uint8Array) {
      for (const b of v) out.push(b);
    }
  }
}

function encodeText(text) {
  const s = String(text ?? '');
  if (encoder) return encoder.encode(s);
  const out = [];
  for (let i = 0; i < s.length; i += 1) out.push(s.charCodeAt(i) & 0xff);
  return Uint8Array.from(out);
}

export function buildEscPosReceipt(lines, options = {}) {
  const width = Number(options.charsPerLine) === 42 ? 42 : 48;
  const autoCut = options.autoCut !== false;
  const feedLines = Math.max(0, Math.min(8, Number(options.feedLines) || 3));
  const out = [];
  pushBytes(out, 0x1b, 0x40);
  pushBytes(out, 0x1b, 0x74, 0x00);
  pushBytes(out, 0x1b, 0x4d, 0x00);

  for (const line of Array.isArray(lines) ? lines : []) {
    const kind = line?.kind || 'text';
    if (kind === 'align') {
      const n = line.value === 'center' ? 1 : line.value === 'right' ? 2 : 0;
      pushBytes(out, 0x1b, 0x61, n);
      continue;
    }
    if (kind === 'rule') {
      const ch = String(line.char || '-').slice(0, 1);
      pushBytes(out, encodeText(ch.repeat(width)), 0x0a);
      continue;
    }
    if (kind === 'blank') {
      pushBytes(out, 0x0a);
      continue;
    }
    if (kind === 'raster' && line.data instanceof Uint8Array) {
      const x = Math.max(1, Math.floor(Number(line.widthBytes) || 0));
      const y = Math.max(1, Math.floor(Number(line.height) || 0));
      pushBytes(out, 0x1b, 0x61, 0x00);
      pushBytes(out, 0x1d, 0x76, 0x30, 0x00, x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff, line.data);
      continue;
    }
    if (kind === 'cols') {
      const rows = formatCols(line.left, line.right, width);
      if (line.bold) pushBytes(out, 0x1b, 0x45, 0x01);
      if (line.invert) pushBytes(out, 0x1d, 0x42, 0x01);
      for (const row of rows) {
        const padded = line.invert && row.length < width ? `${row}${' '.repeat(width - row.length)}` : row;
        pushBytes(out, encodeText(padded), 0x0a);
      }
      if (line.invert) pushBytes(out, 0x1d, 0x42, 0x00);
      if (line.bold) pushBytes(out, 0x1b, 0x45, 0x00);
      continue;
    }
    if (kind === 'cells') {
      const rows = formatCells(line.items, width);
      if (line.bold) pushBytes(out, 0x1b, 0x45, 0x01);
      if (line.invert) pushBytes(out, 0x1d, 0x42, 0x01);
      for (const row of rows) {
        const padded = line.invert && row.length < width ? `${row}${' '.repeat(width - row.length)}` : row;
        pushBytes(out, encodeText(padded), 0x0a);
      }
      if (line.invert) pushBytes(out, 0x1d, 0x42, 0x00);
      if (line.bold) pushBytes(out, 0x1b, 0x45, 0x00);
      continue;
    }
    const text = String(line.text ?? '');
    const scale = line.size != null
      ? Math.max(1, Math.min(8, Math.floor(Number(line.size) || 1)))
      : 1;
    const wide = Boolean(line.double) && line.size == null;
    const tall = Boolean(line.tall) && !wide && line.size == null;
    if (line.size != null && scale > 1) {
      const mag = scale - 1;
      pushBytes(out, 0x1d, 0x21, (mag << 4) | mag);
    } else if (wide) pushBytes(out, 0x1d, 0x21, 0x11);
    else if (tall) pushBytes(out, 0x1d, 0x21, 0x01);
    if (line.bold) pushBytes(out, 0x1b, 0x45, 0x01);
    if (line.invert) pushBytes(out, 0x1d, 0x42, 0x01);
    if (line.lineSpacingDots != null) {
      const dots = Math.max(0, Math.min(255, Math.floor(Number(line.lineSpacingDots) || 0)));
      pushBytes(out, 0x1b, 0x33, dots);
    }
    const charWidth = wide || scale > 1 ? Math.max(8, Math.floor(width / (wide ? 2 : scale))) : width;
    const chunks = wrapText(text, charWidth);
    for (const chunk of chunks) {
      const padded = line.invert && chunk.length < charWidth
        ? `${chunk}${' '.repeat(charWidth - chunk.length)}`
        : chunk;
      pushBytes(out, encodeText(padded), 0x0a);
    }
    if (line.invert) pushBytes(out, 0x1d, 0x42, 0x00);
    if (line.bold) pushBytes(out, 0x1b, 0x45, 0x00);
    if (wide || tall || (line.size != null && scale > 1)) pushBytes(out, 0x1d, 0x21, 0x00);
  }

  if (feedLines > 0) {
    pushBytes(out, 0x1b, 0x32);
    pushBytes(out, 0x1b, 0x64, feedLines);
  }
  if (autoCut) pushBytes(out, 0x1d, 0x56, 0x41, 0x10);
  return Uint8Array.from(out);
}

function wrapText(text, width) {
  const s = String(text ?? '');
  if (!s) return [''];
  const max = Math.max(1, Number(width) || 1);
  const rows = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < Math.floor(max * 0.45)) cut = max;
    rows.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) rows.push(rest);
  return rows.length ? rows : [''];
}

function formatCols(left, right, width) {
  const l = String(left ?? '');
  const r = String(right ?? '');
  const w = Math.max(8, Number(width) || 48);
  if (!r) return wrapText(l, w);
  const maxLeft = Math.max(1, w - r.length - 1);
  if (l.length <= maxLeft) {
    return [`${l}${' '.repeat(w - l.length - r.length)}${r}`];
  }
  const wrapped = wrapText(l, maxLeft);
  return wrapped.map((chunk, i) => {
    if (i !== wrapped.length - 1) return chunk;
    const gap = Math.max(1, w - chunk.length - r.length);
    const line = `${chunk}${' '.repeat(gap)}${r}`;
    return line.length > w ? `${chunk.slice(0, maxLeft)}${' '.repeat(w - maxLeft - r.length)}${r}` : line;
  });
}

function padAlign(text, width, align) {
  const s = String(text ?? '');
  const w = Math.max(1, Number(width) || 1);
  if (s.length >= w) return s.slice(0, w);
  const pad = ' '.repeat(w - s.length);
  return align === 'right' ? `${pad}${s}` : `${s}${pad}`;
}

function formatCells(items, width) {
  const cols = Array.isArray(items) ? items : [];
  const w = Math.max(16, Number(width) || 48);
  if (cols.length === 0) return [''];
  const gaps = Math.max(0, cols.length - 1);
  const parsed = cols.map((col) => ({
    text: String(col?.text ?? ''),
    align: col?.align === 'right' ? 'right' : 'left',
    flex: Boolean(col?.flex),
    width: Math.max(1, Math.floor(Number(col?.width) || 1)),
  }));
  let fixed = 0;
  let flexN = 0;
  for (const col of parsed) {
    if (col.flex) flexN += 1;
    else fixed += col.width;
  }
  const leftover = w - fixed - gaps;
  const flexWidth = flexN > 0 ? Math.max(4, Math.floor(leftover / flexN)) : 0;
  const widths = parsed.map((col) => (col.flex ? flexWidth : col.width));
  const used = widths.reduce((sum, n) => sum + n, 0) + gaps;
  if (used < w) {
    const flexIndex = parsed.findIndex((col) => col.flex);
    if (flexIndex >= 0) widths[flexIndex] += w - used;
  }
  const wrapped = parsed.map((col, i) => wrapText(col.text, widths[i]));
  const rowCount = Math.max(1, ...wrapped.map((rows) => rows.length));
  const lines = [];
  for (let row = 0; row < rowCount; row += 1) {
    const parts = parsed.map((col, i) => padAlign(wrapped[i][row] || '', widths[i], col.align));
    lines.push(parts.join(' '));
  }
  return lines;
}

export async function printEscPosLines(lines) {
  const props = readProps();
  const bytes = buildEscPosReceipt(lines, props);
  await printRawBytes(bytes);
}

function pushCenteredText(lines, text, { bold = false, size = 1, lineSpacingDots = null } = {}) {
  for (const part of String(text ?? '').split('\n')) {
    if (!part.trim()) lines.push({ kind: 'blank' });
    else lines.push({ text: part, bold, size, lineSpacingDots });
  }
}

const TEST_PRINT_DPI = 203;

function paperDotWidth(charsPerLine) {
  return Number(charsPerLine) === 42 ? 384 : 576;
}

function pointsToDots(pt) {
  const n = Number(pt);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.round((n * TEST_PRINT_DPI) / 72));
}

function wrapCanvasLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    const words = para.trim().split(/\s+/);
    let line = '';
    const pushWide = (word) => {
      let chunk = '';
      for (const ch of word) {
        const next = chunk + ch;
        if (ctx.measureText(next).width <= maxWidth) chunk = next;
        else {
          if (chunk) out.push(chunk);
          chunk = ch;
        }
      }
      return chunk;
    };
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width <= maxWidth) {
        line = trial;
        continue;
      }
      if (line) out.push(line);
      line = ctx.measureText(word).width > maxWidth ? pushWide(word) : word;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

function canvasToRasterStrips(canvas, maxRows) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const widthBytes = Math.ceil(width / 8);
  const strips = [];
  for (let y0 = 0; y0 < height; y0 += maxRows) {
    const rows = Math.min(maxRows, height - y0);
    const img = ctx.getImageData(0, y0, width, rows);
    const data = new Uint8Array(widthBytes * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const lum = img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
        if (lum < 180) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    strips.push({ kind: 'raster', widthBytes, height: rows, data });
  }
  return strips;
}

function rasterizeTextBlock(text, { fontPt, lineSpacingPt, bold, paperWidth }) {
  if (typeof document === 'undefined') return [];
  const fontPx = pointsToDots(fontPt);
  const gapPx = Math.max(0, pointsToDots(lineSpacingPt) - 1);
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return [];
  measure.font = `${bold ? 700 : 400} ${fontPx}px Arial, Helvetica, sans-serif`;
  const maxWidth = Math.max(8, paperWidth - 16);
  const wrapped = wrapCanvasLines(measure, text, maxWidth);
  const lineHeight = fontPx + gapPx;
  const canvas = document.createElement('canvas');
  canvas.width = paperWidth;
  canvas.height = Math.max(1, wrapped.length * lineHeight);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.font = measure.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  wrapped.forEach((line, index) => {
    if (line) ctx.fillText(line, paperWidth / 2, index * lineHeight);
  });
  return canvasToRasterStrips(canvas, 256);
}

export async function printTestPage(details) {
  const src = details && typeof details === 'object' ? details : {};
  const shopName = String(src.shopName ?? '').trim();
  const location = String(src.location ?? '').trim();
  const bankDetails = String(src.bankDetails ?? '').trim();
  const fontPt = (value, fallback) => {
    const n = Math.floor(Number(value));
    if (Number.isFinite(n) && n >= 1) return Math.min(200, n);
    const previous = Math.floor(Number(fallback));
    if (Number.isFinite(previous) && previous >= 1) return Math.min(200, previous);
    return 12;
  };
  const paperWidth = paperDotWidth(readProps().charsPerLine);
  const lines = [];
  const pushBlock = (text, size, spacing, bold) => {
    const strips = rasterizeTextBlock(text, {
      fontPt: size,
      lineSpacingPt: spacing,
      bold,
      paperWidth,
    });
    if (strips.length) {
      lines.push(...strips);
      return;
    }
    pushCenteredText(lines, text, { bold, size: Math.max(1, Math.min(8, Math.round(size / 12) || 1)) });
  };
  if (!shopName && !location && !bankDetails) {
    lines.push({ kind: 'align', value: 'center' });
    lines.push({ text: 'No test print details saved.', bold: true });
    lines.push({ kind: 'blank' });
    lines.push({ text: 'Add shop name, location, and bank details in Settings, then print again.' });
  } else {
    if (shopName) pushBlock(shopName, fontPt(src.shopNameFontSize, src.fontSize), src.shopNameLineSpacing, true);
    if (location) pushBlock(location, fontPt(src.locationFontSize, src.fontSize), src.locationLineSpacing, false);
    if (bankDetails) {
      if (lines.length) lines.push({ kind: 'blank' });
      pushBlock(bankDetails, fontPt(src.bankDetailsFontSize, src.fontSize), src.bankDetailsLineSpacing, false);
    }
  }
  await printEscPosLines(lines);
}
