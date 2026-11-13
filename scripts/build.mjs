import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { noticeState, states } from '../src/schedule.mjs';

const title = '사이렌 주거';
const description = '청년 월세·이사비·전세임대 공고를 지역별로 비교하고 공식 신청 일정을 확인하세요.';
const regions = { national: '전국', seoul: '서울', busan: '부산' };
const categories = { monthly: '월세 지원', moving: '이사비 지원', rentals: '전세임대' };
const now = new Date();
const publicOrigin = process.env.SIREN_SITE_URL;
const origin = publicOrigin ? httpsUrl(publicOrigin).origin : 'http://127.0.0.1:4173';
const verifiedOrigin = 'https://siren-housing.siren-kr.workers.dev';
const email = process.env.SIREN_EMAIL_SUBSCRIBE_URL;
const notices = JSON.parse(await readFile(new URL('../data/notices.json', import.meta.url), 'utf8'));
const dist = new URL('../dist/', import.meta.url);
const slugs = new Set();

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

function status(notice) {
  const state = noticeState(notice.opens, notice.closes, now);
  return `<span class="status" data-state="${state}" data-opens="${notice.opens}" data-closes="${notice.closes}">${states[state]}</span>`;
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
      ![notice.opens, notice.closes, notice.verifiedOn, notice.updatedOn].every(validDate) ||
      notice.opens > notice.closes || notice.updatedOn > notice.verifiedOn) {
    throw new Error(`Invalid notice: ${notice.slug}`);
  }
  httpsUrl(notice.source);
  if (notice.scheduleSource) httpsUrl(notice.scheduleSource);
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
  return `<article class="notice" data-region="${notice.region}" data-category="${notice.category}">
    <a class="notice-link" href="${path(notice)}" aria-labelledby="${notice.slug}-title">
      <div class="notice-main">
        <p class="notice-category">${regions[notice.region]} · ${categories[notice.category]}</p>
        <h2 id="${notice.slug}-title">${escape(notice.title)}</h2>
        <p class="benefit">${escape(notice.benefit)}</p>
      </div>
      <div class="notice-schedule">${status(notice)}<span class="deadline"><span class="sr-only">신청 마감 </span>${dateTime(notice.closes, false)}</span></div>
      <span class="chevron" aria-hidden="true"></span>
    </a>
  </article>`;
}

function select(label, name, choices, anyLabel) {
  const options = Object.entries(choices).map(([value, text]) => `<option value="${value}">${text}</option>`).join('');
  return `<div class="field"><label class="sr-only" for="filter-${name}">${label}</label><select id="filter-${name}" name="${name}"><option value="">${anyLabel}</option>${options}</select></div>`;
}

const ordered = [...notices].sort((first, second) => {
  const rank = { open: 0, upcoming: 1, closed: 2 };
  const firstState = noticeState(first.opens, first.closes, now);
  const secondState = noticeState(second.opens, second.closes, now);
  return rank[firstState] - rank[secondState] || (firstState === 'closed'
    ? second.closes.localeCompare(first.closes)
    : first.closes.localeCompare(second.closes));
});

await rm(dist, { recursive: true, force: true });
await emit('index.html', page({ heading: `청년 주거지원 공고 | ${title}`, summary: description, route: '/', body: `
  <main class="wrap programs" id="main">
    <section id="programs" aria-labelledby="program-title">
      <h1 id="program-title">청년 주거지원</h1>
      <form class="filters" id="filters" hidden aria-label="공고 필터">${select('지역', 'region', regions, '모든 지역')}${select('지원 유형', 'category', categories, '모든 지원')}${select('접수 상태', 'status', states, '접수 상태')}</form>
      <span class="sr-only" id="results" aria-live="polite">${notices.length}건</span>
      <p class="empty" id="empty" hidden>조건에 맞는 공고가 없어요.</p>
      <div class="notice-list" id="notices">${ordered.map(noticeRow).join('')}</div>
    </section>
    <section class="subscribe" id="subscribe" aria-labelledby="subscribe-title">
      <h2 id="subscribe-title">새 공고 구독</h2>
      <div class="feed-links"><a href="/rss.xml">전체 RSS</a><a href="/rss/seoul.xml">서울 RSS</a><a href="/rss/busan.xml">부산 RSS</a>${email ? `<a href="${escape(email)}">이메일</a>` : ''}</div>
    </section>
  </main>` }));

for (const notice of notices) {
  await emit(`.${path(notice)}index.html`, page({ heading: `${notice.title} | ${title}`, summary: notice.summary, route: path(notice), body: `
    <main class="wrap detail" id="main">
      <a class="back" href="/#programs">← 공고 목록</a>
      <article>
        <div class="detail-category"><span>${regions[notice.region]} · ${categories[notice.category]}</span>${status(notice)}</div>
        <h1>${escape(notice.title)}</h1><p class="lead">${escape(notice.summary)}</p>
        <dl class="facts"><div><dt>지원 내용</dt><dd>${escape(notice.benefit)}</dd></div><div><dt>신청 기간</dt><dd>${dateTime(notice.opens)} ~ ${dateTime(notice.closes)}</dd></div></dl>
        <h2>신청 대상</h2><ul class="criteria">${notice.criteria.map(item => `<li>${escape(item)}</li>`).join('')}</ul>
        <p class="note">${escape(notice.note)}</p>
        <div class="source-links"><a class="action" href="${escape(notice.source)}">공식 공고 보기 <span aria-hidden="true">↗</span></a>${notice.scheduleSource ? `<a href="${escape(notice.scheduleSource)}">공식 접수 일정 확인 ↗</a>` : ''}</div>
      </article>
    </main>` }));
}

for (const [region, file] of [['all', 'rss.xml'], ['seoul', 'rss/seoul.xml'], ['busan', 'rss/busan.xml']]) {
  const name = region === 'all' ? '전체' : regions[region];
  const items = notices.filter(notice => region === 'all' || notice.region === region || notice.region === 'national')
    .sort((first, second) => second.updatedOn.localeCompare(first.updatedOn))
    .map(notice => `<item><title>${escape(notice.title)}</title><link>${origin}${path(notice)}</link><guid isPermaLink="false">${escape(`${notice.slug}-${notice.updatedOn}`)}</guid><pubDate>${new Date(notice.updatedOn + 'T00:00:00+09:00').toUTCString()}</pubDate><description>${escape(`${notice.summary} 공고상 마감 ${date(notice.closes)}`)}</description></item>`);
  await emit(file, `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${title} · ${name}</title><link>${origin}/</link><atom:link href="${origin}/${file}" rel="self" type="application/rss+xml"/><description>청년 주거지원 공고 및 변경 정보</description><language>ko</language>${items.join('')}</channel></rss>`);
}

await emit('robots.txt', publicOrigin ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
await emit('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url>${notices.map(notice => `<url><loc>${origin}${path(notice)}</loc><lastmod>${notice.updatedOn}</lastmod></url>`).join('')}</urlset>`);
await mkdir(new URL('assets/', dist), { recursive: true });
for (const asset of ['styles.css', 'filter.mjs', 'schedule.mjs']) {
  await copyFile(new URL(`../src/${asset}`, import.meta.url), new URL(`assets/${asset}`, dist));
}
console.log(`Built ${notices.length} notices and 3 RSS feeds.`);
