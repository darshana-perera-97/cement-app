/** Licensed banks in Sri Lanka with LankaPay 4-digit bank codes (sorted by name). */
export const SRI_LANKA_BANKS = [
  { name: 'Amana Bank PLC', code: '7463' },
  { name: 'Axis Bank', code: '7472' },
  { name: 'Bank of Ceylon', code: '7010' },
  { name: 'Bank of China Limited', code: '7490' },
  { name: 'Cargills Bank Limited', code: '7481' },
  { name: 'Citibank N.A.', code: '7047' },
  { name: 'Commercial Bank of Ceylon PLC', code: '7056' },
  { name: 'Deutsche Bank AG', code: '7205' },
  { name: 'DFCC Bank PLC', code: '7119' },
  { name: 'Habib Bank Ltd', code: '7074' },
  { name: 'Hatton National Bank PLC', code: '7135' },
  { name: 'HDFC Bank', code: '7737' },
  { name: 'Hongkong & Shanghai Banking Corporation Ltd (HSBC)', code: '7092' },
  { name: 'ICICI Bank Ltd', code: '7384' },
  { name: 'Indian Bank', code: '7108' },
  { name: 'Indian Overseas Bank', code: '7117' },
  { name: 'MCB Bank Ltd', code: '7269' },
  { name: 'National Development Bank PLC', code: '7214' },
  { name: 'National Savings Bank', code: '7038' },
  { name: 'Nations Trust Bank PLC', code: '7162' },
  { name: 'Pan Asia Banking Corporation PLC', code: '7311' },
  { name: "People's Bank", code: '7083' },
  { name: 'Public Bank Berhad', code: '7296' },
  { name: 'Regional Development Bank', code: '7755' },
  { name: 'Sanasa Development Bank', code: '7728' },
  { name: 'Sampath Bank PLC', code: '7278' },
  { name: 'Seylan Bank PLC', code: '7187' },
  { name: 'Standard Chartered Bank', code: '7077' },
  { name: 'State Bank of India', code: '7144' },
  { name: 'State Mortgage & Investment Bank', code: '7764' },
  { name: 'Union Bank of Colombo PLC', code: '7250' },
];

export function bankCodeForName(name) {
  const n = String(name ?? '').trim();
  if (!n) return '';
  const hit = SRI_LANKA_BANKS.find((b) => b.name === n);
  return hit?.code ?? '';
}
