const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODateUTC(value) {
    const match = String(value || '').match(ISO_DATE_PATTERN);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day) {
        return null;
    }
    return date;
}

export function formatISODateUTC(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function countChargeableLateDays(dueDateValue, returnDateValue, options = {}) {
    const dueDate = parseISODateUTC(dueDateValue);
    const returnDate = parseISODateUTC(returnDateValue);
    if (!dueDate || !returnDate || returnDate <= dueDate) return 0;

    const ignoreHolidays = options.ignoreHolidays !== false;
    const holidays = options.holidays instanceof Set
        ? options.holidays
        : new Set(options.holidays || []);
    let count = 0;
    const cursor = new Date(dueDate);

    while (cursor < returnDate) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        if (!ignoreHolidays) {
            count++;
            continue;
        }

        const day = cursor.getUTCDay();
        const dateKey = formatISODateUTC(cursor);
        if (day !== 0 && day !== 6 && !holidays.has(dateKey)) count++;
    }
    return count;
}

export function addLoanDays(startDateValue, durationDays, options = {}) {
    const startDate = parseISODateUTC(startDateValue);
    const duration = Number(durationDays);
    if (!startDate || !Number.isInteger(duration) || duration < 1) return '';

    const ignoreHolidays = options.ignoreHolidays !== false;
    const holidays = options.holidays instanceof Set
        ? options.holidays
        : new Set(options.holidays || []);
    const cursor = new Date(startDate);
    let added = 0;

    while (added < duration) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const day = cursor.getUTCDay();
        const dateKey = formatISODateUTC(cursor);
        if (!ignoreHolidays || (day !== 0 && day !== 6 && !holidays.has(dateKey))) added++;
    }

    return formatISODateUTC(cursor);
}
