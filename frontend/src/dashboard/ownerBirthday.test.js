import {
  birthdayWhenLabel,
  collectUpcomingOwnerBirthdays,
  daysUntilNextBirthday,
} from './ownerBirthday';

describe('owner birthday window', () => {
  test('counts today and the next three days, ignoring year', () => {
    expect(daysUntilNextBirthday('1988-09-22', '2026-09-22')).toBe(0);
    expect(daysUntilNextBirthday('1990-09-23', '2026-09-22')).toBe(1);
    expect(daysUntilNextBirthday('1990-09-25', '2026-09-22')).toBe(3);
    expect(daysUntilNextBirthday('1990-09-26', '2026-09-22')).toBe(4);
  });

  test('wraps around the new year', () => {
    expect(daysUntilNextBirthday('1991-01-02', '2026-12-31')).toBe(2);
  });

  test('collects only customers in the 3-day window', () => {
    const rows = collectUpcomingOwnerBirthdays(
      [
        { id: '1', name: 'Today Shop', ownerName: 'Amal', ownerBirthday: '1980-09-22' },
        { id: '2', name: 'Later Shop', ownerName: 'Nimal', ownerBirthday: '1980-09-26' },
        { id: '3', name: 'Soon Shop', ownerName: 'Kamal', ownerBirthday: '1980-09-24' },
        { id: '4', name: 'No birthday', ownerName: 'Sunil' },
      ],
      '2026-09-22',
    );
    expect(rows.map((r) => r.id)).toEqual(['1', '3']);
    expect(birthdayWhenLabel(rows[0].daysUntil)).toBe('Today');
    expect(birthdayWhenLabel(rows[1].daysUntil)).toBe('In 2 days');
    expect(rows[0].turningAge).toBe(46);
  });
});
