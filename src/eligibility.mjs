export const audiences = {
  student: '대학생·대학원생',
  jobseeker: '취업준비생',
  worker: '재직자·사업자',
  single: '미혼 청년',
  couple: '청년부부·신혼부부',
  lowIncome: '수급·차상위 등',
};

export const applicationChannels = {
  online: '온라인',
  visit: '방문',
  email: '이메일',
  mail: '우편',
};

export function applicationEligibility(info, age, audience, channel) {
  if (age !== null && info.age && (age < info.age[0] || age > info.age[1])) return false;
  if (audience && !info.audiences?.includes(audience)) return false;
  return !channel || Boolean(info.channels?.includes(channel));
}
