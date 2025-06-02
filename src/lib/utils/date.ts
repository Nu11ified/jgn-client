import { format, formatDistanceToNow } from 'date-fns';

/**
 * Converts a UTC date string or Date object to a localized date-time string
 * @param date - UTC date string or Date object
 * @param options - Intl.DateTimeFormatOptions
 * @returns Localized date-time string with timezone indicator
 */
export function formatLocalDateTime(date: Date | string, includeSeconds = false) {
  const d = new Date(date);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: true,
    timeZoneName: 'short'
  }).format(d);
}

/**
 * Converts a UTC date string or Date object to a localized date string
 * @param date - UTC date string or Date object
 * @returns Localized date string
 */
export function formatLocalDate(date: Date | string) {
  const d = new Date(date);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(d);
}

/**
 * Formats a duration in minutes to a human-readable string
 * @param minutes - Duration in minutes
 * @returns Formatted duration string (e.g., "2h 30m")
 */
export function formatDuration(minutes: number | null) {
  if (!minutes) return 'Unknown';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${mins}m`;
}

/**
 * Converts a local datetime to UTC ISO string for server submission
 * @param localDateTime - Local datetime string (YYYY-MM-DDTHH:mm)
 * @returns UTC ISO string
 */
export function localToUTC(localDateTime: string) {
  const date = new Date(localDateTime);
  return date.toISOString();
}

/**
 * Converts a UTC datetime to local datetime string for form inputs
 * @param utcDateTime - UTC datetime string or Date object
 * @returns Local datetime string (YYYY-MM-DDTHH:mm)
 */
export function utcToLocal(utcDateTime: string | Date) {
  const date = new Date(utcDateTime);
  return date.toLocaleDateString('en-CA', { // en-CA gives us YYYY-MM-DD format
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(/(\d{4})\/(\d{2})\/(\d{2}), (\d{2}):(\d{2})/, '$1-$2-$3T$4:$5');
}

/**
 * Gets the current local datetime string for form inputs
 * @returns Current local datetime string (YYYY-MM-DDTHH:mm)
 */
export function getCurrentLocalDateTime() {
  return utcToLocal(new Date());
}

/**
 * Formats a relative time (e.g., "2 hours ago")
 * @param date - Date to format
 * @param options - format-distance-to-now options
 */
export function formatRelativeTime(date: Date | string, options?: Parameters<typeof formatDistanceToNow>[1]) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, ...options });
} 