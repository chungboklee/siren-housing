const koreanDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
export const koreaDay = (now = new Date()) => koreanDate.format(now);

export const states = { open: '접수 중', upcoming: '접수 예정', check: '접수 확인 필요', closed: '접수 마감' };
const rank = { open: 0, upcoming: 1, check: 2, closed: 3 };

export function noticeState(opens, closes, now = new Date(), availability) {
  const day = koreaDay(now);
  const beforeStart = opens && (opens.length === 10 ? day < opens : now < new Date(opens));
  const afterEnd = closes && (closes.length === 10 ? day > closes : now >= new Date(closes));
  if (afterEnd || availability === 'closed') return 'closed';
  if (beforeStart) return 'upcoming';
  return availability === 'check' ? 'check' : 'open';
}

export function compareSchedules(firstState, firstCloses, secondState, secondCloses) {
  const first = firstCloses || '9999';
  const second = secondCloses || '9999';
  return rank[firstState] - rank[secondState] || (firstState === 'closed'
    ? second.localeCompare(first)
    : first.localeCompare(second));
}
