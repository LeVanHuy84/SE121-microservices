const VN_OFFSET_HOURS = 7;

export function toUtcStartOfDayVN(dateStr?: string) {
  if (!dateStr) return undefined;

  // dateStr = "2025-12-22"
  const [y, m, d] = dateStr.split('-').map(Number);

  // tạo thời điểm 00:00:00 VN
  const utcDate = new Date(Date.UTC(y, m - 1, d, -VN_OFFSET_HOURS, 0, 0, 0));

  return utcDate.getTime(); // UTC timestamp
}

export function toUtcEndOfDayVN(dateStr?: string) {
  if (!dateStr) return undefined;

  const [y, m, d] = dateStr.split('-').map(Number);

  // 23:59:59.999 VN
  const utcDate = new Date(
    Date.UTC(y, m - 1, d, 23 - VN_OFFSET_HOURS, 59, 59, 999)
  );

  return utcDate.getTime(); // UTC timestamp
}
