// A date-only deadline is a local calendar day; a timed deadline is an instant.
export function validateDeadline(input) {
  if (input?.due_date === undefined && input?.due_at === undefined) return {};
  const due_date = input.due_date ?? null, due_at = input.due_at ?? null;
  if (due_date !== null && (typeof due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due_date) || !Number.isFinite(Date.parse(due_date)) || new Date(due_date).toISOString().slice(0,10) !== due_date || due_date < '0001-01-01')) invalid();
  if (due_at !== null && (!Number.isSafeInteger(due_at) || due_at < 0 || due_at > 253402300799999)) invalid();
  if (due_date !== null && due_at !== null) invalid();
  return {due_date, due_at};
}
function invalid() { throw Object.assign(new Error('截止日期无效，请选择有效日期或具体时间。'), {code:'INVALID_DEADLINE'}); }
