import { audiences, applicationChannels } from '../src/eligibility.mjs';

const channelPatterns = {
  online: /온라인|복지로|정부24|잡아바|홈페이지\s*(?:신청|접수)/,
  visit: /방문|현장\s*(?:또는|접수)|오프라인/,
  email: /이메일|e-?mail/i,
  mail: /우편|등기/,
};

export function channelsFrom(value) {
  return Object.keys(applicationChannels).filter(key => channelPatterns[key].test(value ?? ''));
}

export function audienceFrom(value) {
  if (!value) return [];
  const patterns = {
    student: /대학생|대학원생/,
    jobseeker: /취업\s*준비생|구직\s*청년/,
    worker: /근로자|재직자|사업자|일하는\s*청년/,
    single: /미혼/,
    couple: /(?:청년\s*|신혼)부부/,
    lowIncome: /차상위|기초생활\s*수급|보호대상\s*한부모/,
  };
  return Object.keys(audiences).filter(key => patterns[key].test(value));
}

const informalAge = /예외|제대군인|병역|대학생|취업\s*준비생/;

export function ageFrom(value) {
  if (!value || informalAge.test(value)) return;
  const pairs = [...value.matchAll(/(?:만\s*)?(\d{2})\s*(?:세\s*(?:이상)?\s*)?[~～∼–-]\s*(?:만\s*)?(\d{2})\s*세/g)];
  const min = Number(pairs[0]?.[1]);
  const max = Number(pairs[0]?.[2]);
  if (!pairs.length || pairs.some(pair => Number(pair[1]) !== min || Number(pair[2]) !== max) || min < 15 || max > 65 || min > max) return;
  return [min, max];
}

export function applicationFromLines(lines) {
  const label = /^\s*(?:[○□■ㅇ▪•※📝📞-]+\s*|[가-하]\.\s*)?(.*?)(?:\s*[:：]\s*(.*))?$/u;
  const get = pattern => {
    for (const [index, line] of lines.entries()) {
      const [, name, explicit] = line.match(label) ?? [];
      if (!name || !pattern.test(name.replace(/\s/g, ''))) continue;
      const next = explicit || (lines[index + 1]?.match(label)?.[2] ? '' : lines[index + 1]);
      if (next && next.length <= 230 && !/^(?:공고문|첨부파일|별첨|붙임|자세한|아래|표참조)/.test(next)) return next;
    }
  };
  const method = get(/^(?:신청|접수)방법$/);
  const result = {};
  const channels = channelsFrom(method);
  if (channels.length) Object.assign(result, { method, channels });
  const selection = get(/^(?:선정방법|선정기준|심사기준)$/);
  if (selection) result.selection = selection;
  const announcement = get(/^(?:선정발표|선정결과발표|당첨자발표|결과발표)$/);
  if (announcement && /\d/.test(announcement)) result.announcement = announcement;
  const contact = get(/^(?:문의|문의처|문의사항|사업문의)$/);
  if (contact && /\b0\d{1,2}[- ]\d{3,4}[- ]\d{4}\b/.test(contact)) result.contact = contact;
  return result;
}

// Missing fields on a new snapshot do not erase reviewed or previously captured information.
export function mergeApplication(notice, observed) {
  const info = observed.application ?? {};
  const age = ageFrom(observed.applicant);
  const groups = audienceFrom(observed.applicant);
  const next = { ...notice.application, ...info };
  if (age) next.age = age;
  if (groups.length) next.audiences = groups;
  if (Object.keys(next).length === 0 || JSON.stringify(next) === JSON.stringify(notice.application)) return false;
  notice.application = next;
  return true;
}
