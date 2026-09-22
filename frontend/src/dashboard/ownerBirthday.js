export const OWNER_BIRTHDAY_WINDOW_DAYS = 3;

function parseYmd(ymd) {
  const raw = String(ymd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map((n) => parseInt(n, 10));
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function dateFromParts(y, m, d) {
  return new Date(y, m - 1, d);
}

/** Next birthday as a local Date, treating Feb 29 as Feb 28 in non-leap years. */
function nextBirthdayDate(birthday, today) {
  let next = dateFromParts(today.y, birthday.m, birthday.d);
  if (birthday.m === 2 && birthday.d === 29 && next.getMonth() !== 1) {
    next = dateFromParts(today.y, 2, 28);
  }
  const todayDate = dateFromParts(today.y, today.m, today.d);
  if (next < todayDate) {
    next = dateFromParts(today.y + 1, birthday.m, birthday.d);
    if (birthday.m === 2 && birthday.d === 29 && next.getMonth() !== 1) {
      next = dateFromParts(today.y + 1, 2, 28);
    }
  }
  return next;
}

export function daysUntilNextBirthday(birthdayYmd, todayYmd) {
  const birthday = parseYmd(birthdayYmd);
  const today = parseYmd(todayYmd);
  if (!birthday || !today) return null;
  const todayDate = dateFromParts(today.y, today.m, today.d);
  const next = nextBirthdayDate(birthday, today);
  return Math.round((next.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000));
}

function turningAgeOnNextBirthday(birthdayYmd, todayYmd) {
  const birthday = parseYmd(birthdayYmd);
  const today = parseYmd(todayYmd);
  if (!birthday || !today) return null;
  const next = nextBirthdayDate(birthday, today);
  const age = next.getFullYear() - birthday.y;
  if (age < 1 || age > 120) return null;
  return age;
}

export function formatBirthdayMonthDay(ymd) {
  const parsed = parseYmd(ymd);
  if (!parsed) return '';
  return dateFromParts(parsed.y, parsed.m, parsed.d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

export function birthdayWhenLabel(daysUntil) {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil} days`;
}

export function collectUpcomingOwnerBirthdays(
  customers,
  todayYmd,
  windowDays = OWNER_BIRTHDAY_WINDOW_DAYS,
) {
  const list = Array.isArray(customers) ? customers : [];
  const out = [];
  for (const c of list) {
    const daysUntil = daysUntilNextBirthday(c?.ownerBirthday, todayYmd);
    if (daysUntil == null || daysUntil < 0 || daysUntil > windowDays) continue;
    const ownerName = String(c.ownerName ?? '').trim();
    const shopName = String(c.name ?? '').trim() || 'Customer';
    out.push({
      id: c.id,
      ownerName: ownerName || 'Shop owner',
      shopName,
      ownerBirthday: c.ownerBirthday,
      daysUntil,
      contactNumber: String(c.contactNumber ?? '').trim(),
      turningAge: turningAgeOnNextBirthday(c.ownerBirthday, todayYmd),
    });
  }
  out.sort(
    (a, b) => a.daysUntil - b.daysUntil || a.ownerName.localeCompare(b.ownerName, undefined, { sensitivity: 'base' }),
  );
  return out;
}
