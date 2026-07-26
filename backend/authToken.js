const crypto = require('crypto');

function getSecret() {
  const s = (process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || 'cs-store-auth-dev').trim();
  return s;
}

/** @param {string} username @param {'admin'|'staff'} role */
function signToken(username, role) {
  const payload = {
    u: String(username).trim(),
    r: role === 'admin' ? 'admin' : 'staff',
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('hex');
  return `${body}.${sig}`;
}

function timingSafeEqualHex(a, b) {
  try {
    const x = Buffer.from(String(a), 'hex');
    const y = Buffer.from(String(b), 'hex');
    if (x.length !== y.length) return false;
    return crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

function verifyToken(token) {
  try {
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('hex');
    if (!timingSafeEqualHex(sig, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.u || (payload.r !== 'admin' && payload.r !== 'staff')) return null;
    if (payload.exp < Date.now()) return null;
    return { username: payload.u, role: payload.r };
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1].trim() : '';
}

/** @returns {{ username: string, role: string } | null} */
function getAuthFromRequest(req) {
  return verifyToken(getBearerToken(req));
}

function requireAdmin(req, res) {
  const auth = getAuthFromRequest(req);
  if (!auth || auth.role !== 'admin') {
    res.status(403).json({ error: 'Only the admin can manage users' });
    return null;
  }
  return auth;
}

module.exports = {
  signToken,
  verifyToken,
  getAuthFromRequest,
  requireAdmin,
};
