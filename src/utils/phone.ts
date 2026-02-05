const UA_PHONE_REGEX = /^\+380\d{9}$/;

export function normalizePhone(phone: string): string {
  let clean = phone.replace(/\D/g, '');

  if (clean.startsWith('380')) {
    clean = '+' + clean;
  } else if (clean.startsWith('80')) {
    clean = '+3' + clean;
  } else if (clean.startsWith('0')) {
    clean = '+380' + clean.slice(1);
  } else if (!clean.startsWith('+')) {
    clean = '+' + clean;
  }

  return clean;
}

export function isValidUAPhone(phone: string): boolean {
  return UA_PHONE_REGEX.test(phone);
}

export function formatPhone(phone: string): string {
  const match = phone.match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (!match) return phone;
  return `+380 (${match[1]}) ${match[2]}-${match[3]}-${match[4]}`;
}
