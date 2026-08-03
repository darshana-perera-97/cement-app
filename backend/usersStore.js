const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const {
  MANAGER_ACCESS_KEYS,
  normalizeManagerAccessInput,
  getEffectiveManagerAccess,
} = require('./managerAccess');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');

const STAFF_ROLES = ['Admin', 'Manager', 'Driver', 'Collector'];

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

function normalizeNic(nic) {
  return String(nic ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, '');
}

function normalizeCustomerId(customerId) {
  return String(customerId ?? '').trim();
}

function customerIdKey(customerId) {
  const raw = normalizeCustomerId(customerId);
  return raw ? raw.toLowerCase() : '';
}

function normalizeStaffRole(role) {
  const raw = String(role ?? '').trim();
  const found = STAFF_ROLES.find((r) => r.toLowerCase() === raw.toLowerCase());
  return found || '';
}

function toPublicUser(row) {
  const role = row.role || '';
  return {
    id: row.id,
    username: row.username,
    name: row.name || '',
    contact: row.contact || '',
    nic: row.nic || '',
    driverLicense: row.driverLicense || '',
    customerId: row.customerId || '',
    role,
    access: String(role).trim() === 'Manager' ? getEffectiveManagerAccess(row.access) : [],
    password: row.password != null ? String(row.password) : '',
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

async function findUserByUsername(username) {
  const key = normalizeUsername(username);
  const nicKey = normalizeNic(username);
  if (!key && !nicKey) return null;
  const users = await readUsers();
  return (
    users.find((u) => {
      if (key && normalizeUsername(u.username) === key) return true;
      if (nicKey && normalizeNic(u.nic) === nicKey) return true;
      return false;
    }) || null
  );
}

async function verifyStoredUser(username, password) {
  const u = await findUserByUsername(username);
  if (!u) return false;
  return verifyPassword(password, u.passwordHash);
}

async function createUser({ name, contact, nic, driverLicense, customerId, role, password, createdBy, access }) {
  const displayName = String(name ?? '').trim();
  const contactNumber = String(contact ?? '').trim();
  const nicKey = normalizeNic(nic);
  const license = String(driverLicense ?? '').trim();
  const custId = normalizeCustomerId(customerId);
  const custKey = customerIdKey(custId);
  const staffRole = normalizeStaffRole(role);

  if (displayName.length < 2) {
    return { ok: false, error: 'Name must be at least 2 characters' };
  }
  if (!contactNumber) {
    return { ok: false, error: 'Contact number is required' };
  }
  if (!nicKey || nicKey.length < 5) {
    return { ok: false, error: 'NIC is required' };
  }
  if (!staffRole) {
    return { ok: false, error: 'Role must be Admin, Manager, Driver, or Collector' };
  }
  if (staffRole === 'Driver' && !license) {
    return { ok: false, error: 'Driver license is required for Driver role' };
  }
  const managerAccess =
    staffRole === 'Manager' ? normalizeManagerAccessInput(access) : [];
  if (staffRole === 'Manager' && managerAccess.length === 0) {
    return { ok: false, error: 'Select at least one section for manager access' };
  }
  if (String(password).length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters' };
  }

  const adminUser = normalizeUsername(process.env.ADMIN_USERNAME || '');
  if (adminUser && nicKey === adminUser) {
    return { ok: false, error: 'NIC is reserved for the environment admin' };
  }

  const users = await readUsers();
  if (users.some((u) => normalizeNic(u.nic) === nicKey || normalizeUsername(u.username) === nicKey)) {
    return { ok: false, error: 'A user with this NIC already exists' };
  }
  if (custKey && users.some((u) => customerIdKey(u.customerId) === custKey)) {
    return { ok: false, error: 'A user with this customer ID already exists' };
  }

  const plainPassword = String(password);
  const row = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    username: nicKey,
    name: displayName,
    contact: contactNumber,
    nic: nicKey,
    customerId: custId,
    driverLicense: staffRole === 'Driver' ? license : '',
    role: staffRole,
    access: staffRole === 'Manager' ? managerAccess : [],
    password: plainPassword,
    passwordHash: hashPassword(plainPassword),
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy || 'admin').trim() || 'admin',
  };
  users.push(row);
  await writeUsers(users);
  return { ok: true, user: toPublicUser(row) };
}

async function updateUser(id, { name, contact, nic, driverLicense, customerId, role, password, access }) {
  const sid = String(id ?? '').trim();
  if (!sid) return { ok: false, error: 'Invalid id' };

  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === sid);
  if (idx === -1) return { ok: false, error: 'User not found' };

  const current = users[idx];
  const displayName = name !== undefined ? String(name ?? '').trim() : current.name || '';
  const contactNumber = contact !== undefined ? String(contact ?? '').trim() : current.contact || '';
  const nicKey = nic !== undefined ? normalizeNic(nic) : normalizeNic(current.nic || current.username);
  const staffRole = role !== undefined ? normalizeStaffRole(role) : normalizeStaffRole(current.role);
  const license =
    driverLicense !== undefined
      ? String(driverLicense ?? '').trim()
      : String(current.driverLicense || '').trim();
  const custId =
    customerId !== undefined ? normalizeCustomerId(customerId) : normalizeCustomerId(current.customerId);
  const custKey = customerIdKey(custId);

  if (displayName.length < 2) {
    return { ok: false, error: 'Name must be at least 2 characters' };
  }
  if (!contactNumber) {
    return { ok: false, error: 'Contact number is required' };
  }
  if (!nicKey || nicKey.length < 5) {
    return { ok: false, error: 'NIC is required' };
  }
  if (!staffRole) {
    return { ok: false, error: 'Role must be Admin, Manager, Driver, or Collector' };
  }
  if (staffRole === 'Driver' && !license) {
    return { ok: false, error: 'Driver license is required for Driver role' };
  }

  let managerAccess = [];
  if (staffRole === 'Manager') {
    if (access !== undefined) {
      managerAccess = normalizeManagerAccessInput(access);
    } else if (normalizeStaffRole(current.role) === 'Manager') {
      managerAccess = getEffectiveManagerAccess(current.access);
    } else {
      managerAccess = [...MANAGER_ACCESS_KEYS];
    }
    if (managerAccess.length === 0) {
      return { ok: false, error: 'Select at least one section for manager access' };
    }
  }

  const adminUser = normalizeUsername(process.env.ADMIN_USERNAME || '');
  if (adminUser && nicKey === adminUser) {
    return { ok: false, error: 'NIC is reserved for the environment admin' };
  }

  const nicTaken = users.some(
    (u, i) =>
      i !== idx && (normalizeNic(u.nic) === nicKey || normalizeUsername(u.username) === nicKey),
  );
  if (nicTaken) {
    return { ok: false, error: 'A user with this NIC already exists' };
  }

  const customerIdTaken = users.some(
    (u, i) => i !== idx && custKey && customerIdKey(u.customerId) === custKey,
  );
  if (customerIdTaken) {
    return { ok: false, error: 'A user with this customer ID already exists' };
  }

  const next = {
    ...current,
    username: nicKey,
    name: displayName,
    contact: contactNumber,
    nic: nicKey,
    customerId: custId,
    driverLicense: staffRole === 'Driver' ? license : '',
    role: staffRole,
    access: staffRole === 'Manager' ? managerAccess : [],
    updatedAt: new Date().toISOString(),
  };

  const newPassword = password !== undefined ? String(password ?? '').trim() : '';
  if (newPassword) {
    if (newPassword.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters' };
    }
    next.password = newPassword;
    next.passwordHash = hashPassword(newPassword);
  }

  users[idx] = next;
  await writeUsers(users);
  return { ok: true, user: toPublicUser(next) };
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
  updateUser,
  deleteUserById,
  toPublicUser,
  STAFF_ROLES,
  USERS_FILE,
};
