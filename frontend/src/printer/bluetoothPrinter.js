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

function onDisconnected() {
  server = null;
  characteristic = null;
  lastError = lastError || 'Printer disconnected';
  emit();
}

export function getPrinterConnection() {
  const props = readProps();
  return {
    available: bluetoothAvailable(),
    connected: Boolean(characteristic && device?.gatt?.connected),
    connecting,
    deviceName: device?.name || props.lastDeviceName || '',
    deviceId: device?.id || props.lastDeviceId || '',
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
  device = nextDevice;
  device.addEventListener('gattserverdisconnected', onDisconnected);
  server = await device.gatt.connect();
  characteristic = await pickWritableCharacteristic(server);
  if (!characteristic) {
    throw new Error('Connected, but this device has no writable Bluetooth printer characteristic.');
  }
  writeProps({
    lastDeviceId: device.id || '',
    lastDeviceName: device.name || 'Bluetooth printer',
  });
  lastError = '';
}

export async function connectBluetoothPrinter() {
  if (!bluetoothAvailable()) {
    lastError = 'Web Bluetooth is not supported in this browser. Use Chrome or Edge on a device with Bluetooth.';
    emit();
    throw new Error(lastError);
  }
  connecting = true;
  lastError = '';
  emit();
  try {
    const nextDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_BLE_SERVICES,
    });
    if (device && device !== nextDevice) {
      try {
        device.gatt?.disconnect();
      } catch {
        /* ignore */
      }
      resetLink();
    }
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

export async function reconnectLastPrinter() {
  if (!bluetoothAvailable() || typeof navigator.bluetooth.getDevices !== 'function') return getPrinterConnection();
  if (characteristic && device?.gatt?.connected) return getPrinterConnection();
  const props = readProps();
  if (!props.lastDeviceId && !props.lastDeviceName) return getPrinterConnection();
  connecting = true;
  emit();
  try {
    const devices = await navigator.bluetooth.getDevices();
    const match =
      devices.find((d) => props.lastDeviceId && d.id === props.lastDeviceId) ||
      devices.find((d) => props.lastDeviceName && d.name === props.lastDeviceName) ||
      devices[0];
    if (!match) return getPrinterConnection();
    await bindDevice(match);
    emit();
  } catch (e) {
    lastError = e?.message || 'Could not restore the last printer.';
    emit();
  } finally {
    connecting = false;
    emit();
  }
  return getPrinterConnection();
}

export function disconnectBluetoothPrinter() {
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
    if (kind === 'cols') {
      const left = String(line.left ?? '');
      const right = String(line.right ?? '');
      const gap = Math.max(1, width - left.length - right.length);
      pushBytes(out, encodeText(`${left}${' '.repeat(gap)}${right}`), 0x0a);
      continue;
    }
    const text = String(line.text ?? '');
    if (line.double) pushBytes(out, 0x1d, 0x21, 0x11);
    if (line.bold) pushBytes(out, 0x1b, 0x45, 0x01);
    const chunks = wrapText(text, line.double ? Math.floor(width / 2) : width);
    for (const chunk of chunks) {
      pushBytes(out, encodeText(chunk), 0x0a);
    }
    if (line.bold) pushBytes(out, 0x1b, 0x45, 0x00);
    if (line.double) pushBytes(out, 0x1d, 0x21, 0x00);
  }

  if (feedLines > 0) pushBytes(out, 0x1b, 0x64, feedLines);
  if (autoCut) pushBytes(out, 0x1d, 0x56, 0x41, 0x10);
  return Uint8Array.from(out);
}

function wrapText(text, width) {
  const s = String(text ?? '');
  if (!s) return [''];
  const rows = [];
  let rest = s;
  while (rest.length > width) {
    rows.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  rows.push(rest);
  return rows;
}

export async function printEscPosLines(lines) {
  const props = readProps();
  const bytes = buildEscPosReceipt(lines, props);
  await printRawBytes(bytes);
}

export async function printTestPage() {
  await printEscPosLines([
    { kind: 'align', value: 'center' },
    { text: 'XPrinter 80mm', bold: true, double: true },
    { text: 'Bluetooth test print', bold: true },
    { kind: 'rule' },
    { kind: 'align', value: 'left' },
    { text: 'If you can read this, the printer is connected and ready.' },
    { kind: 'blank' },
    { kind: 'cols', left: 'Width', right: '80mm' },
    { kind: 'cols', left: 'Chars / line', right: String(readProps().charsPerLine) },
  ]);
}
