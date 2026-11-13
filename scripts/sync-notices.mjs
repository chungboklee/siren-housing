import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { koreaDay } from '../src/schedule.mjs';
import { categoryFor, clean, fetchPage, period, sources } from './notice-sources.mjs';
import { mergeApplication } from './application-details.mjs';

const noticesFile = new URL('../data/notices.json', import.meta.url);
const daejeonApplication = 'https://daejeonyouthportal.kr/content/CT_000000000059/cntPage.do?category=19&commonMenuNo=438_323_514_521&section=1';
const correction = /(?:정정|연장\s*(?:공고|안내|모집)|조기\s*마감|접수\s*종료)/;
const comparableTitle = title => title.normalize('NFKC')
  .replace(/[[(](?:정정(?:공고)?|연장(?:공고)?|조기\s*마감|공고)[\])]/g, '')
  .replace(/^(?:정정|연장|조기\s*마감)\s*[:：]\s*/, '')
  .replace(/(?:조기\s*마감|접수\s*종료|정정|연장)(?:\s*(?:안내|공고))?$/g, '')
  .replace(/[\s\p{P}\p{S}]/gu, '');

function sourceId(adapter, address) {
  const target = new URL(address);
  if (target.hostname !== adapter.host) return;
  return adapter.idParam ? target.searchParams.get(adapter.idParam) : target.pathname.match(adapter.idPath)?.[1];
}

function preserveTime(next, previous) {
  return next?.length === 10 && previous?.slice(0, 10) === next ? previous : next;
}

export function applySchedule(notice, observed, today, scheduleSource) {
  const next = { ...notice };
  if (observed.opens && observed.closes) {
    next.opens = preserveTime(observed.opens, notice.opens);
    next.closes = preserveTime(observed.closes, notice.closes);
  }
  if (observed.status === 'closed' && (!next.closes || next.closes.slice(0, 10) >= today || next.availability)) {
    next.availability = 'closed';
  }
  if (!observed.status && next.availability === 'closed' && notice.closes && next.closes > notice.closes) {
    next.availability = 'check';
  }
  if (observed.status === 'open') delete next.availability;
  if (next.opens === notice.opens && next.closes === notice.closes && next.availability === notice.availability) return false;
  next.verifiedOn = today;
  next.updatedOn = today;
  if (scheduleSource && scheduleSource !== next.source) next.scheduleSource = scheduleSource;
  next.scheduleUpdate = next.availability === 'closed' ? '공식 출처에서 접수 마감을 확인했습니다.'
    : notice.closes && next.closes > notice.closes ? '공식 공고의 접수 마감일이 연장됐습니다.'
      : observed.status === 'open' && notice.availability === 'closed' ? '공식 출처에서 접수 재개를 확인했습니다.'
        : '공식 공고의 신청 일정이 변경됐습니다.';
  Object.assign(notice, next);
  if (!next.availability) delete notice.availability;
  return true;
}

function makeNotice(adapter, item, observed, today) {
  const title = observed.title || item.title;
  const category = categoryFor(title);
  if (!category || !observed.opens || !observed.closes || observed.eligible === false) return;
  if (observed.closes < today.slice(0, 4) + '-01-01') return;
  if (adapter.key === 'seoul' && />\s*안내$/.test(title) && !/20\d{2}/.test(title)) return;
  if (adapter.key === 'lh' && !item.region && !/전국/.test(title)) return;
  const municipality = adapter.municipality ?? (adapter.region === 'incheon' ? title.match(/^\(([가-힣]+[구군])\)/)?.[1]
    : adapter.region === 'seoul' ? title.match(/^([가-힣]+구)(?:청|1인가구지원센터)/)?.[1] : undefined);
  const benefit = { monthly: '월세·주거비 지원', moving: '이사비·중개보수 지원', interest: '임차보증금 대출이자 지원',
    purchase: '주택구입 대출이자 지원', rentals: '청년 임대주택 공급' };
  const notice = {
    slug: `${adapter.key}-notice-${item.id}`, title, region: item.region ?? adapter.region, ...(municipality ? { municipality } : {}),
    category, agency: adapter.agency, source: item.source, opens: observed.opens, closes: observed.closes,
    ...(observed.status === 'closed' ? { availability: 'closed' } : {}),
    verifiedOn: today, updatedOn: today, benefit: observed.benefit?.slice(0, 220) || benefit[category],
    summary: `${adapter.agency}에서 확인한 청년 주거지원 공고입니다.`,
    criteria: [observed.applicant?.slice(0, 300) || '신청 자격과 제출 서류는 공식 공고에서 확인하세요.'],
    note: '지원 금액, 세부 조건, 접수 방법은 공식 공고를 확인하세요.',
  };
  mergeApplication(notice, observed);
  return notice;
}

export async function sync(notices, { fetch = fetchPage, today = koreaDay(), sourcesToCheck = sources } = {}) {
  let added = 0;
  let updated = 0;
  let checked = 0;
  const failures = [];
  await Promise.all(sourcesToCheck.map(async adapter => {
    const existing = new Map(notices.flatMap(notice => {
      const id = sourceId(adapter, notice.source);
      return id ? [[id, notice]] : [];
    }));
    const related = [...existing.values()];
    const changes = new Map();
    const items = new Map();
    const listed = await Promise.allSettled(adapter.lists.map(async address => {
      const { $ } = await fetch(address, adapter.host);
      const rows = adapter.list($).filter(item => /^\d+$/.test(item.id));
      if (!rows.length && !adapter.empty?.($)) throw new Error('no recognizable listing rows');
      return rows;
    }));
    for (const [index, result] of listed.entries()) {
      if (result.status === 'rejected') {
        failures.push(`${adapter.key} listing ${index + 1}: ${result.reason.message}`);
        continue;
      }
      for (const item of result.value) {
        if (categoryFor(item.title) || correction.test(item.title) || existing.has(item.id)) items.set(item.id, item);
      }
    }
    for (const [id, notice] of existing) {
      if (adapter.key !== 'lh' && (!notice.closes || notice.closes >= `${Number(today.slice(0, 4)) - 1}-01-01`) && !items.has(id)) {
        items.set(id, { id, title: notice.title, source: notice.source });
      }
      const correctionId = notice.scheduleSource && sourceId(adapter, notice.scheduleSource);
      if (correctionId && correctionId !== id && !items.has(correctionId)) {
        items.set(correctionId, { id: correctionId, title: notice.title, source: notice.scheduleSource });
      }
    }
    const corrections = [];
    for (const item of items.values()) {
      const previous = existing.get(item.id);
      item.source ??= adapter.detailUrl(item.id);
      let observed;
      try {
        const { $, html } = await fetch(item.source, adapter.host);
        observed = adapter.detail($, html, item);
        if (!observed.title) throw new Error('notice title missing');
        checked += 1;
      } catch (error) {
        failures.push(`${adapter.key} notice ${item.id}: ${error.message}`);
        continue;
      }
      if (previous) {
        changes.set(previous, { observed, item });
      } else if (correction.test(observed.title) || correction.test(item.title)) {
        corrections.push({ observed, item });
      } else {
        const notice = makeNotice(adapter, item, observed, today);
        if (!notice) continue;
        notices.push(notice);
        related.push(notice);
        added += 1;
      }
    }
    for (const { observed, item } of corrections) {
      const title = comparableTitle(observed.title);
      const matches = related.filter(notice => notice.scheduleSource === item.source ||
        title === comparableTitle(changes.get(notice)?.observed.title ?? notice.title));
      if (matches.length === 1 && (observed.closes || observed.status)) {
        const current = changes.get(matches[0]);
        if (current && current.item.source !== matches[0].source && Number(current.item.id) > Number(item.id)) continue;
        changes.set(matches[0], { observed, item });
      }
    }
    for (const [notice, { observed, item }] of changes) {
      const original = item.id === sourceId(adapter, notice.source);
      const detailsChanged = original && mergeApplication(notice, observed);
      if (notice.scheduleUpdate && notice.scheduleSource && sourceId(adapter, notice.scheduleSource) &&
          sourceId(adapter, notice.scheduleSource) !== sourceId(adapter, notice.source) &&
          original) {
        if (!detailsChanged) continue;
      } else if (applySchedule(notice, observed, today, item.source)) {
        updated += 1;
        continue;
      }
      if (detailsChanged) {
        notice.updatedOn = today;
        notice.verifiedOn = today;
        updated += 1;
      }
    }
  }));

  const daejeon = notices.find(notice => notice.source === daejeonApplication);
  if (daejeon && sourcesToCheck === sources) {
    try {
      const { $, html } = await fetch(daejeonApplication, 'daejeonyouthportal.kr');
      const lines = $('p').map((_, p) => clean($(p).text())).get();
      const label = lines.findIndex(line => /^■\s*신청기간$/.test(line));
      const dates = label >= 0 && period(lines[label + 1] ?? '');
      if (!dates) throw new Error('application period missing');
      const closed = lines.some(line => /^(?:신청|접수|모집)\s*(?:조기\s*)?(?:마감|종료)(?:됐습니다|되었습니다| 안내|\.)?$/.test(line));
      const status = closed ? 'closed' : /var aplyPsbltyYn = "Y"/.test(html) ? 'open' : undefined;
      if (applySchedule(daejeon, { ...dates, status }, today)) updated += 1;
      checked += 1;
    } catch (error) {
      failures.push(`daejeon application: ${error.message}`);
    }
  }
  return { added, updated, checked, failures };
}

async function main() {
  const notices = JSON.parse(await readFile(noticesFile, 'utf8'));
  const originalSlugs = new Set(notices.map(notice => notice.slug));
  const { added, updated, checked, failures } = await sync(notices);
  for (const failure of failures) console.warn(process.env.GITHUB_ACTIONS ? `::warning::${failure}` : failure);
  console.log(`Official pages checked: ${checked}; added: ${added}; updated: ${updated}; failures: ${failures.length}`);
  const write = process.argv.includes('--write');
  if (checked === 0) throw new Error('No official notice pages verified');
  const additions = notices.filter(notice => !originalSlugs.has(notice.slug)).sort((first, second) => first.slug.localeCompare(second.slug));
  if (write && (added || updated)) {
    const ordered = [...notices.filter(notice => originalSlugs.has(notice.slug)), ...additions];
    const json = JSON.stringify(ordered, null, 2).replace(/("criteria": )\[\n((?:      "[^\n]*\n)+)    \]/g,
      (_, prefix, entries) => prefix + '[' + entries.trim().split('\n').map(line => line.trim()).join(' ') + ']');
    await writeFile(noticesFile, json + '\n', 'utf8');
  }
  for (const notice of additions) console.log(`New: ${notice.slug} (${notice.opens} ~ ${notice.closes})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
