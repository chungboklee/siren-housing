import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compareSchedules, noticeState, states } from '../src/schedule.mjs';
import { applicationChannels, audiences } from '../src/eligibility.mjs';

const title = '사이렌 주거';
const description = '지자체 청년 월세·이사비·보증금 이자·임대주택 공고를 지역별로 찾고 공식 신청 일정을 확인하세요.';
const regions = {
  national: '전국', seoul: '서울', busan: '부산', daegu: '대구', incheon: '인천',
  daejeon: '대전', ulsan: '울산', sejong: '세종', gyeonggi: '경기',
  gangwon: '강원', chungbuk: '충북', chungnam: '충남', jeonbuk: '전북',
  jeonnam: '전남·광주', gyeongbuk: '경북', gyeongnam: '경남', jeju: '제주',
};
const categories = { monthly: '월세·주거비', moving: '이사비·중개보수', interest: '보증금 이자', purchase: '주택구입 이자', rentals: '임대주택' };
const now = new Date();
const publicOrigin = process.env.SIREN_SITE_URL;
const origin = publicOrigin ? httpsUrl(publicOrigin).origin : 'http://127.0.0.1:4173';
const verifiedOrigin = 'https://siren-housing.siren-kr.workers.dev';
const email = process.env.SIREN_EMAIL_SUBSCRIBE_URL;
const notices = JSON.parse(await readFile(new URL('../data/notices.json', import.meta.url), 'utf8'));
const dist = new URL('../dist/', import.meta.url);
const slugs = new Set();
const feedRegions = Object.keys(regions).filter(region => region !== 'national');

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('HTTPS URL required');
  return url;
}

function escape(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, character => entities[character]);
}

function date(value, withYear = true) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const time = value.slice(11, 16);
  return `${withYear ? `${year}년 ` : ''}${month}월 ${day}일${time ? ` ${time}` : ''}`;
}

function dateTime(value, withYear) {
  return `<time datetime="${escape(value)}">${date(value, withYear)}</time>`;
}

function path(notice) {
  return `/notices/${notice.slug}/`;
}

function feedItem(notice) {
  const description = [notice.summary, notice.scheduleUpdate, notice.closes && `공고상 마감 ${date(notice.closes)}`].filter(Boolean).join(' ');
  const revision = notice.scheduleUpdate
    ? '-' + createHash('sha256').update(JSON.stringify([notice.opens, notice.closes, notice.availability])).digest('hex').slice(0, 12)
    : '';
  return `<item><title>${escape(notice.title)}</title><link>${origin}${path(notice)}</link><guid isPermaLink="false">${escape(`${notice.slug}-${notice.updatedOn}${revision}`)}</guid><pubDate>${new Date(notice.updatedOn + 'T00:00:00+09:00').toUTCString()}</pubDate><description>${escape(description)}</description></item>`;
}

function locality(notice) {
  return notice.municipality ? `${notice.region}:${notice.municipality}` : notice.region;
}

function locationLabel(notice) {
  return notice.municipality === '광주' ? '광주' : [regions[notice.region], notice.municipality].filter(Boolean).join(' ');
}

function applicationPeriod({ opens, closes }) {
  if (!closes) return opens ? `${dateTime(opens)}부터 · 마감일은 공식 접수처 확인` : '공식 접수처 확인';
  return opens ? `${dateTime(opens)} ~ ${dateTime(closes)}` : `${dateTime(closes)}까지`;
}

function status(notice) {
  const state = noticeState(notice.opens, notice.closes, now, notice.availability);
  return `<span class="status" data-state="${state}" data-opens="${notice.opens ?? ''}" data-closes="${notice.closes ?? ''}" data-availability="${notice.availability ?? ''}">${states[state]}</span>`;
}

async function emit(relative, contents) {
  const target = new URL(relative, dist);
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

for (const notice of notices) {
  const validDate = value => /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\+09:00)?$/.test(value) && Number.isFinite(Date.parse(value));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(notice.slug) || slugs.has(notice.slug) ||
      !Object.hasOwn(regions, notice.region) || !Object.hasOwn(categories, notice.category) ||
      (notice.municipality !== undefined && (notice.region === 'national' || typeof notice.municipality !== 'string' || !notice.municipality.trim())) ||
      (notice.availability !== undefined && !['check', 'closed'].includes(notice.availability)) ||
      ![notice.verifiedOn, notice.updatedOn].every(validDate) ||
      (notice.opens !== null && !validDate(notice.opens)) ||
      (notice.closes !== null ? !validDate(notice.closes) : !notice.availability) ||
      (notice.opens && notice.closes && notice.opens > notice.closes) || notice.updatedOn > notice.verifiedOn) {
    throw new Error(`Invalid notice: ${notice.slug}`);
  }
  httpsUrl(notice.source);
  if (notice.scheduleSource) httpsUrl(notice.scheduleSource);
  const info = notice.application;
  if (info) {
    if (info.applicationUrl) httpsUrl(info.applicationUrl);
    if (info.detailSource) httpsUrl(info.detailSource);
    if ((info.age && (!Array.isArray(info.age) || info.age.length !== 2 || !info.age.every(Number.isInteger) || info.age[0] > info.age[1])) ||
        (info.channels && !info.channels.every(channel => Object.hasOwn(applicationChannels, channel))) ||
        (info.audiences && !info.audiences.every(group => Object.hasOwn(audiences, group))) ||
        ['steps', 'documents', 'conditions'].some(key => info[key] && (!Array.isArray(info[key]) || !info[key].every(item => typeof item === 'string' && item.trim())))) {
      throw new Error(`Invalid application details: ${notice.slug}`);
    }
  }
  slugs.add(notice.slug);
}
if (email) httpsUrl(email);

function page({ heading, summary, route, body }) {
  const canonical = publicOrigin ? `<link rel="canonical" href="${escape(origin + route)}">` : '<meta name="robots" content="noindex">';
  const verification = origin === verifiedOrigin && route === '/'
    ? `<meta name="google-site-verification" content="aS64T4W4MQjEji0JKbEtHKuX8DraOS70bNURQCgNlQE">
  <meta name="naver-site-verification" content="a7bf08f23b3a75b769bc6d89c729947d8a22dc72">`
    : '';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escape(summary)}">
  <meta name="theme-color" content="#ffffff">
  <title>${escape(heading)}</title>
  ${canonical}
  ${verification}
  <link rel="alternate" type="application/rss+xml" title="${title} RSS" href="/rss.xml">
  <link rel="stylesheet" href="/assets/styles.css">
  <script type="module" src="/assets/filter.mjs"></script>
</head>
<body>
  <a class="skip" href="#main">본문으로 바로가기</a>
  <header class="header"><div class="wrap header-inner">
    <a class="brand" href="/"><span class="signal" aria-hidden="true"></span>${title}</a>
    <a class="nav-subscribe" href="/#subscribe">새 공고 구독</a>
  </div></header>
  ${body}
</body>
</html>`;
}

function noticeRow(notice) {
  const { age, audiences: groups, channels } = notice.application ?? {};
  const keywords = [notice.summary, ...notice.criteria, ...(groups ?? []).map(key => audiences[key]), ...(channels ?? []).map(key => applicationChannels[key])].join(' ');
  return `<article class="notice" data-region="${notice.region}" data-locality="${escape(locality(notice))}" data-category="${notice.category}" data-age="${age?.join(',') ?? ''}" data-audiences="${groups?.join(',') ?? ''}" data-channels="${channels?.join(',') ?? ''}" data-updated="${notice.updatedOn}" data-keywords="${escape(keywords)}">
    <a class="notice-link" href="${path(notice)}" aria-labelledby="${notice.slug}-title">
      <div class="notice-main">
        <p class="notice-category">${escape(locationLabel(notice))} · ${categories[notice.category]}</p>
        <h2 id="${notice.slug}-title">${escape(notice.title)}</h2>
        <p class="benefit">${escape(notice.benefit)}${age ? ` · 만 ${age[0]}~${age[1]}세` : ''}</p>
        <p class="notice-age-unknown" hidden>연령 조건은 공고에서 확인</p>
      </div>
      <div class="notice-schedule">${status(notice)}${notice.closes ? `<span class="deadline"><span class="sr-only">공고상 마감일 </span>${dateTime(notice.closes, false)}</span>` : ''}</div>
      <span class="chevron" aria-hidden="true"></span>
    </a>
  </article>`;
}

function select(label, name, choices, anyLabel, visible = false) {
  const options = Object.entries(choices).map(([value, text]) => `<option value="${escape(value)}">${escape(text)}</option>`).join('');
  return `<div class="field"><label${visible ? '' : ' class="sr-only"'} for="filter-${name}">${label}</label><select id="filter-${name}" name="${name}"><option value="">${anyLabel}</option>${options}</select></div>`;
}

function applicationDetails(notice) {
  const { method, applicationUrl, steps, documents, selection, announcement, contact, conditions, detailSource } = notice.application ?? {};
  const list = (items, tag) => `<${tag} class="criteria">${items.map(item => `<li>${escape(item)}</li>`).join('')}</${tag}>`;
  const detailsLink = applicationUrl ? ` <a href="${escape(applicationUrl)}">공식 접수처 ↗</a>` : '';
  return `
    <section class="application-section" aria-labelledby="how-to-apply">
      <h2 id="how-to-apply">신청 방법과 절차</h2>
      ${method ? `<p>${escape(method)}${detailsLink}</p>` : ''}
      ${steps?.length ? list(steps, 'ol') : ''}
      ${method || steps?.length ? '' : '<p>접수처와 신청 절차는 공식 공고에서 확인하세요.</p>'}
    </section>
    <section class="application-section" aria-labelledby="documents">
      <h2 id="documents">주요 제출 서류</h2>
      ${documents?.length ? list(documents, 'ul') + '<p class="note">전체 서류와 발급 기준은 공식 공고에서 확인하세요.</p>' : '<p>제출 서류와 서식은 공식 공고에서 확인하세요.</p>'}
    </section>
    ${selection || announcement || contact ? `<dl class="application-meta">
      ${selection ? `<div><dt>선정 기준</dt><dd>${escape(selection)}</dd></div>` : ''}
      ${announcement ? `<div><dt>결과 발표</dt><dd>${escape(announcement)}</dd></div>` : ''}
      ${contact ? `<div><dt>문의</dt><dd>${escape(contact)}</dd></div>` : ''}
    </dl>` : ''}
    ${conditions?.length ? `<section class="application-section"><h2>추가로 확인할 조건</h2>${list(conditions, 'ul')}</section>` : ''}
    ${detailSource && detailSource !== applicationUrl ? `<p class="note"><a href="${escape(detailSource)}">공식 신청 안내 및 서류 확인 ↗</a></p>` : ''}`;
}

const regionChoices = {};
for (const [region, label] of Object.entries(regions)) {
  const regionalNotices = notices.filter(notice => notice.region === region);
  regionChoices[region] = label;
  const municipalities = [...new Set(regionalNotices.map(notice => notice.municipality).filter(Boolean))];
  for (const municipality of municipalities.sort((first, second) => first.localeCompare(second, 'ko'))) {
    regionChoices[`${region}:${municipality}`] = `${label} ${municipality}`;
  }
}

const ordered = [...notices].sort((first, second) => compareSchedules(
  noticeState(first.opens, first.closes, now, first.availability), first.closes,
  noticeState(second.opens, second.closes, now, second.availability), second.closes,
));

await rm(dist, { recursive: true, force: true });
await emit('index.html', page({ heading: `청년 주거지원 공고 | ${title}`, summary: description, route: '/', body: `
  <main class="wrap programs" id="main">
    <section id="programs" aria-labelledby="program-title">
      <h1 id="program-title">청년 주거지원</h1>
      <form id="filters" hidden aria-label="공고 필터">
        <div class="search-field"><label class="sr-only" for="notice-search">공고 검색</label><input id="notice-search" name="q" type="search" maxlength="80" placeholder="공고명 또는 지역 검색"></div>
        <div class="filters">${select('지역 및 시·군·구', 'region', regionChoices, '모든 지역')}${select('지원 유형', 'category', categories, '모든 지원')}${select('접수 상태', 'status', states, '접수 상태')}</div>
        <details class="advanced-filters" id="advanced-filters">
          <summary>상세 조건</summary>
          <div class="advanced-fields">
            <div><label for="filter-age">만 나이</label><input id="filter-age" type="number" min="0" max="120" step="1" inputmode="numeric" name="age" placeholder="예: 29"></div>
            ${select('공고에 명시된 대상', 'audience', audiences, '전체', true)}
            ${select('신청 방법', 'channel', applicationChannels, '전체', true)}
            ${select('공고 일정', 'timing', { closing: '7일 내 마감', recent: '최근 14일 등록·변경' }, '전체', true)}
          </div>
          <p class="filter-help">연령이 확인되지 않은 공고도 표시합니다. 대상과 신청 방법은 공고에 명시된 항목으로 검색합니다.</p>
        </details>
        <div class="filter-results"><span id="results" aria-live="polite">${notices.length}건</span><button type="reset">초기화</button></div>
      </form>
      <p class="empty" id="empty-region" hidden>이 지역에 등록된 지자체 공고가 없어요.</p>
      <p class="empty" id="empty" hidden>조건에 맞는 공고가 없어요.</p>
      <div class="notice-list" id="notices">${ordered.map(noticeRow).join('')}</div>
    </section>
    <section class="subscribe" id="subscribe" aria-labelledby="subscribe-title">
      <h2 id="subscribe-title">새 공고 구독</h2>
      <div class="feed-links"><a href="/rss.xml">전체 RSS</a><details><summary>지역별 RSS</summary><div class="regional-feeds">${feedRegions.map(region => `<a href="/rss/${region}.xml">${regions[region]} RSS</a>`).join('')}</div></details>${email ? `<a href="${escape(email)}">이메일</a>` : ''}</div>
    </section>
  </main>` }));

for (const notice of notices) {
  await emit(`.${path(notice)}index.html`, page({ heading: `${notice.title} | ${title}`, summary: notice.summary, route: path(notice), body: `
    <main class="wrap detail" id="main">
      <a class="back" href="/#programs">← 공고 목록</a>
      <article>
        <div class="detail-category"><span>${escape(locationLabel(notice))} · ${categories[notice.category]}</span>${status(notice)}</div>
        <h1>${escape(notice.title)}</h1><p class="lead">${escape(notice.summary)}</p>
        <dl class="facts"><div><dt>지원 내용</dt><dd>${escape(notice.benefit)}</dd></div><div><dt>공고상 신청 기간</dt><dd>${applicationPeriod(notice)}</dd></div></dl>
        ${notice.scheduleUpdate ? `<p class="note">${escape(notice.scheduleUpdate)}</p>` : ''}
        <h2>신청 대상</h2><ul class="criteria">${notice.criteria.map(item => `<li>${escape(item)}</li>`).join('')}</ul>
        <p class="note">${escape(notice.note)}</p>
        <div class="source-links"><a class="action" href="${escape(notice.source)}">공식 공고 보기 <span aria-hidden="true">↗</span></a>${notice.scheduleSource ? `<a href="${escape(notice.scheduleSource)}">공식 접수 일정 확인 ↗</a>` : ''}</div>
        ${applicationDetails(notice)}
      </article>
    </main>` }));
}

for (const [region, file] of [['all', 'rss.xml'], ...feedRegions.map(region => [region, `rss/${region}.xml`])]) {
  const name = region === 'all' ? '전체' : regions[region];
  const items = notices.filter(notice => region === 'all' || notice.region === region || notice.region === 'national')
    .sort((first, second) => second.updatedOn.localeCompare(first.updatedOn))
    .map(feedItem);
  await emit(file, `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${title} · ${name}</title><link>${origin}/</link><atom:link href="${origin}/${file}" rel="self" type="application/rss+xml"/><description>청년 주거지원 공고 및 변경 정보</description><language>ko</language>${items.join('')}</channel></rss>`);
}

await emit('robots.txt', publicOrigin ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
await emit('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url>${notices.map(notice => `<url><loc>${origin}${path(notice)}</loc><lastmod>${notice.updatedOn}</lastmod></url>`).join('')}</urlset>`);
await mkdir(new URL('assets/', dist), { recursive: true });
for (const asset of ['styles.css', 'filter.mjs', 'schedule.mjs', 'eligibility.mjs']) {
  await copyFile(new URL(`../src/${asset}`, import.meta.url), new URL(`assets/${asset}`, dist));
}
console.log(`Built ${notices.length} notices and ${feedRegions.length + 1} RSS feeds.`);
