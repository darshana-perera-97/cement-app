const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const nodemailer = require('nodemailer');
const { ZipArchive } = require('archiver');
const { readShopData } = require('./shopDataStore');
const {
  parseEmailList,
  readBackupSettings,
  writeBackupSettings,
} = require('./backupSettingsStore');
const { appendBackupHistory, readBackupHistory, latestBackupHistory } = require('./backupHistoryStore');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SHOP_NAME = () => String(process.env.SHOP_NAME || 'CS Store').trim() || 'CS Store';

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const port = parseInt(String(process.env.SMTP_PORT || '587'), 10);
  const secureRaw = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureRaw === 'true' || secureRaw === '1' || port === 465;
  const from = String(process.env.SMTP_FROM || user).trim();
  const fromName = String(process.env.SMTP_FROM_NAME || process.env.SHOP_NAME || 'Backup').trim();
  return {
    host,
    user,
    pass,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    from,
    fromName,
  };
}

function isSmtpConfigured(config = getSmtpConfig()) {
  return Boolean(config.host && config.user && config.pass);
}

function slugShopName(name) {
  return (
    String(name || '')
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shop'
  );
}

function formatStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function todayYmdLocal(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentTimeHHMM(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function resolveShopName(explicit) {
  const given = String(explicit || '').trim();
  if (given) return given;
  try {
    const shopData = await readShopData();
    return String(shopData.shopName || '').trim() || SHOP_NAME();
  } catch {
    return SHOP_NAME();
  }
}

async function listJsonFiles(dir = DATA_DIR, prefix = '') {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }

  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(full, rel)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(rel);
    }
  }
  return files.sort();
}

function writeZipArchive(files, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const rel of files) {
      archive.file(path.join(DATA_DIR, rel), { name: rel });
    }
    archive.finalize();
  });
}

async function recordBackup(entry) {
  try {
    return await appendBackupHistory(entry);
  } catch (err) {
    console.error('backup history', err);
    return null;
  }
}

async function sendDataBackupEmail({ to, shopName, trigger = 'manual' } = {}) {
  const parsed = parseEmailList(to);
  const emails = parsed.emails;
  const triggerKind = trigger === 'scheduled' ? 'scheduled' : 'manual';

  if (parsed.invalid.length > 0 && emails.length === 0) {
    const error = `Invalid email address${parsed.invalid.length === 1 ? '' : 'es'}: ${parsed.invalid.join(', ')}`;
    await recordBackup({ trigger: triggerKind, emails: parsed.invalid, status: 'failed', error });
    return { ok: false, error };
  }
  if (emails.length === 0) {
    const error = 'Enter at least one valid email address';
    await recordBackup({ trigger: triggerKind, emails: [], status: 'failed', error });
    return { ok: false, error };
  }

  const smtp = getSmtpConfig();
  if (!isSmtpConfigured(smtp)) {
    const error = 'SMTP is not configured in backend/.env (SMTP_HOST, SMTP_USER, SMTP_PASS)';
    await recordBackup({ trigger: triggerKind, emails, status: 'failed', error });
    return { ok: false, error };
  }

  const files = await listJsonFiles();
  if (files.length === 0) {
    const error = 'No JSON files found in backend/data';
    await recordBackup({ trigger: triggerKind, emails, status: 'failed', error });
    return { ok: false, error };
  }

  const resolvedShopName = await resolveShopName(shopName);
  const stamp = formatStamp();
  const filename = `${slugShopName(resolvedShopName)}-${stamp}.zip`;
  const tmpPath = path.join(os.tmpdir(), filename);

  try {
    await writeZipArchive(files, tmpPath);
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    await transporter.sendMail({
      from: smtp.from ? `"${smtp.fromName}" <${smtp.from}>` : undefined,
      to: emails.join(', '),
      subject: `Data backup — ${resolvedShopName || smtp.fromName} — ${stamp}`,
      text: [
        `Attached is a backup of ${files.length} JSON file${files.length === 1 ? '' : 's'} from the data folder.`,
        '',
        `Archive: ${filename}`,
      ].join('\n'),
      attachments: [
        {
          filename,
          path: tmpPath,
        },
      ],
    });

    await recordBackup({
      trigger: triggerKind,
      emails,
      status: 'sent',
      filename,
      fileCount: files.length,
    });
    return { ok: true, filename, fileCount: files.length, to: emails, emails };
  } catch (err) {
    const error = err.message || 'Failed to send backup email';
    await recordBackup({
      trigger: triggerKind,
      emails,
      status: 'failed',
      filename,
      fileCount: files.length,
      error,
    });
    return { ok: false, error };
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
}

let tickInProgress = false;

async function runBackupSchedulerTick() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    const settings = await readBackupSettings();
    if (!settings.scheduleEnabled || settings.emails.length === 0) return;

    const now = new Date();
    if (currentTimeHHMM(now) !== settings.scheduleTime) return;

    const today = todayYmdLocal(now);
    if (settings.lastRunYmd === today) return;

    await writeBackupSettings({ lastRunYmd: today });
    const result = await sendDataBackupEmail({
      to: settings.emails,
      trigger: 'scheduled',
    });
    if (!result.ok) {
      console.error('scheduled backup', result.error);
    }
  } catch (err) {
    console.error('backup scheduler tick', err);
  } finally {
    tickInProgress = false;
  }
}

function startBackupScheduler() {
  runBackupSchedulerTick().catch((err) => console.error('backup scheduler initial tick', err));
  setInterval(() => {
    runBackupSchedulerTick().catch((err) => console.error('backup scheduler tick', err));
  }, 60 * 1000);
}

module.exports = {
  DATA_DIR,
  getSmtpConfig,
  isSmtpConfigured,
  listJsonFiles,
  sendDataBackupEmail,
  runBackupSchedulerTick,
  startBackupScheduler,
  readBackupHistory,
  latestBackupHistory,
};
