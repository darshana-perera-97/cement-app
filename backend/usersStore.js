const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');

async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeUsers(records) {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const verify = crypto.scryptSync(String(plain), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verify, 'hex'));
  } catch {
    return false;
  }
}

function normalizeUsername(u) {
  return String(u ?? '').trim().toLowerCase();
}

function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

async function findUserByUsername(username) {
  const key = normalizeUsername(username);
  const users = await readUsers();
  return users.find((u) => normalizeUsername(u.username) === key) || null;
}

async function verifyStoredUser(username, password) {
  const u = await findUserByUsername(username);
  if (!u) return false;
  return verifyPassword(password, u.passwordHash);
}

async function createUser({ username, password, createdBy }) {
  const key = normalizeUsername(username);
  if (key.length < 3 || key.length > 32) {
    return { ok: false, error: 'Username must be 3–32 characters' };
  }
  if (!/^[a-z0-9_]+$/.test(key)) {
    return { ok: false, error: 'Username may only contain lowercase letters, numbers, and underscores' };
  }
  if (String(password).length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters' };
  }

  const adminUser = normalizeUsername(process.env.ADMIN_USERNAME || '');
  if (adminUser && key === adminUser) {
    return { ok: false, error: 'Username is reserved for the environment admin' };
  }

  const users = await readUsers();
  if (users.some((u) => normalizeUsername(u.username) === key)) {
    return { ok: false, error: 'Username already exists' };
  }

  const row = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    username: key,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy || 'admin').trim() || 'admin',
  };
  users.push(row);
  await writeUsers(users);
  return { ok: true, user: toPublicUser(row) };
}

async function deleteUserById(id) {
  const sid = String(id ?? '').trim();
  if (!sid) return { ok: false, error: 'Invalid id' };
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === sid);
  if (idx === -1) return { ok: false, error: 'User not found' };
  users.splice(idx, 1);
  await writeUsers(users);
  return { ok: true };
}

module.exports = {
  readUsers,
  writeUsers,
  hashPassword,
  verifyPassword,
  findUserByUsername,
  verifyStoredUser,
  createUser,
  deleteUserById,
  toPublicUser,
  USERS_FILE,
};
