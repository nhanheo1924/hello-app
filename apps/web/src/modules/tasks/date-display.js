function isISODateValue(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeValue(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeHourFormat(hourFormat) {
  return String(hourFormat || '') === '12' ? '12' : '24';
}

export function formatDisplayDate(dateISO) {
  if (!isISODateValue(dateISO)) {
    return '';
  }

  const [year, month, day] = String(dateISO).split('-');
  return `${day}/${month}/${year}`;
}

export function formatDisplayTime(timeValue, hourFormat = '24') {
  if (!isTimeValue(timeValue)) {
    return '';
  }

  const normalizedHourFormat = normalizeHourFormat(hourFormat);
  if (normalizedHourFormat === '24') {
    return String(timeValue);
  }

  const [rawHours, minutes] = String(timeValue).split(':').map(Number);
  const suffix = rawHours >= 12 ? 'PM' : 'AM';
  const hours = rawHours % 12 === 0 ? 12 : rawHours % 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function formatDisplayDateTime(dateISO, timeValue, hourFormat = '24') {
  const dateText = formatDisplayDate(dateISO);
  const timeText = formatDisplayTime(timeValue, hourFormat);

  if (dateText && timeText) {
    return `${dateText}, ${timeText}`;
  }
  return dateText || timeText;
}

export function formatDisplayDateRange(startDate, endDate) {
  const startText = formatDisplayDate(startDate);
  const endText = formatDisplayDate(endDate);

  if (startText && endText && startText !== endText) {
    return `${startText} -> ${endText}`;
  }

  return startText || endText;
}

export function formatDisplayDateTimeRange(
  {
    startDate,
    startTime,
    endDate,
    endTime,
  },
  hourFormat = '24',
) {
  const normalizedHourFormat = normalizeHourFormat(hourFormat);
  const resolvedStartDate = isISODateValue(startDate) ? startDate : '';
  const resolvedEndDate = isISODateValue(endDate)
    ? endDate
    : resolvedStartDate;
  const startDateText = formatDisplayDate(resolvedStartDate);
  const endDateText = formatDisplayDate(resolvedEndDate);
  const startTimeText = formatDisplayTime(startTime, normalizedHourFormat);
  const endTimeText = formatDisplayTime(endTime, normalizedHourFormat);

  if (startDateText && endDateText && startTimeText && endTimeText) {
    if (resolvedStartDate && resolvedStartDate === resolvedEndDate) {
      return `${startDateText}, ${startTimeText} - ${endTimeText}`;
    }
    return `${startDateText}, ${startTimeText} -> ${endDateText}, ${endTimeText}`;
  }

  return (
    formatDisplayDateTime(resolvedStartDate, startTime, normalizedHourFormat) ||
    formatDisplayDateTime(resolvedEndDate, endTime, normalizedHourFormat) ||
    startDateText ||
    endDateText ||
    startTimeText ||
    endTimeText
  );
}

export function formatDueLabel(
  {
    date,
    time,
  },
  hourFormat = '24',
) {
  const value = formatDisplayDateTime(date, time, hourFormat);
  if (!value) {
    return '';
  }
  return `Due ${value}`;
}
