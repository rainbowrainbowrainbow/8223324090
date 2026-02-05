const KYIV_TZ = 'Europe/Kyiv';

export function toKyivDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', { timeZone: KYIV_TZ });
}

export function toKyivTime(date: Date): string {
  return date.toLocaleTimeString('uk-UA', {
    timeZone: KYIV_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toKyivDateTime(date: Date): string {
  return `${toKyivDate(date)} ${toKyivTime(date)}`;
}

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('uk-UA', {
    timeZone: KYIV_TZ,
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateFull(date: Date): string {
  return date.toLocaleDateString('uk-UA', {
    timeZone: KYIV_TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function differenceInHours(dateA: Date, dateB: Date): number {
  return (dateA.getTime() - dateB.getTime()) / 3_600_000;
}

export function differenceInMinutes(dateA: Date, dateB: Date): number {
  return (dateA.getTime() - dateB.getTime()) / 60_000;
}

export function isExpired(date: Date): boolean {
  return date.getTime() < Date.now();
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
