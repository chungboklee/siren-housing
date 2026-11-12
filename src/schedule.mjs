const koreanDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

export const states = { open: '접수 중', upcoming: '접수 예정', closed: '접수 마감' };

export function noticeState(opens, closes, now = new Date()) {
  const day = koreanDate.format(now);
  const beforeStart = opens.length === 10 ? day < opens : now < new Date(opens);
  const afterEnd = closes.length === 10 ? day > closes : now >= new Date(closes);
  if (afterEnd) return 'closed';
  return beforeStart ? 'upcoming' : 'open';
}
