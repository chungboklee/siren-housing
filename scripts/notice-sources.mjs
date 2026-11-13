import { load } from 'cheerio';
import { applicationFromLines, channelsFrom } from './application-details.mjs';

export const clean = value => value.replace(/\s+/g, ' ').trim();
const text = element => clean(element.text());
const url = (base, query) => `${base}?${new URLSearchParams(query)}`;
const dateToken = /(?:(20\d{2}|\d{2})\s*[.년/-]\s*)?(\d{1,2})\s*[.월/-]\s*(\d{1,2})(?:\s*[.일])?(?:\s*\([월화수목금토일]\))?(?:\s+(\d{1,2})\s*:\s*(\d{2}))?/g;

export function period(value, fallbackYear) {
  const parts = clean(value).split(/\s*[~～∼–]\s*/);
  if (parts.length !== 2) return;
  const read = (part, defaultYear) => {
    const [match] = [...part.matchAll(dateToken)];
    if (!match) return;
    const [, suppliedYear, month, day, hour, minute] = match;
    const year = suppliedYear ? Number(suppliedYear) + (suppliedYear.length === 2 ? 2000 : 0) : defaultYear;
    const pad = number => String(number).padStart(2, '0');
    const dayString = `${year}-${pad(month)}-${pad(day)}`;
    const date = new Date(dayString);
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== dayString) return;
    if (hour && (Number(hour) > 23 || Number(minute) > 59)) return;
    return dayString + (hour ? `T${pad(hour)}:${minute}:00+09:00` : '');
  };
  const opens = read(parts[0], fallbackYear);
  const closes = opens && read(parts[1], Number(opens.slice(0, 4)));
  if (closes && opens <= closes) return { opens, closes };
}

export function categoryFor(title) {
  if (/(선정 결과|선정결과|선정자|합격|발표|서류제출대상|설명회|정책\s*제안|보도자료|대출\s*연장)/.test(title)) return;
  if (!/(청년|대학생|취업준비생)/.test(title)) return;
  if (/이사비|중개보수|중개수수료/.test(title)) return 'moving';
  if (/월세|주거비/.test(title)) return 'monthly';
  if (/주택구입.*이자/.test(title)) return 'purchase';
  if (/(보증금|전세|전[·ㆍ/]월세).*이자/.test(title)) return 'interest';
  if (/(매입임대|전세임대|임대주택|행복주택|안심주택).*모집/.test(title)) return 'rentals';
}

const explicitStatus = value => /^(접수|신청|모집)\s*(마감|종료|완료)$/.test(value) ? 'closed'
  : /^(접수|신청|모집)\s*중$/.test(value) ? 'open' : undefined;
const asLines = ($, element) => {
  const copy = element.clone();
  copy.find('br').replaceWith('\n');
  return copy.text().split('\n').map(clean).filter(Boolean);
};
const field = (lines, label) => lines.find(line => label.test(line));
const afterLabel = line => line?.replace(/^[^:：]+[:：]\s*/, '');
const yearFrom = title => Number(title.match(/20\d{2}/)?.[0]) || undefined;
const variants = (base, param, terms, query = {}) => terms.map(term => url(base, { ...query, [param]: term }));
const seoul = 'https://youth.seoul.go.kr/infoData/sprtInfo';
const incheon = 'https://youth.incheon.go.kr/youthpolicy';
const chungnam = 'https://youth.chungnam.go.kr/web/main/bbs/cnyouth_notice';
const daejeon = 'https://www.daejeonyouthportal.kr/board/BBSMSTR_000000000239';
const jeju = 'https://www.jpdc.co.kr/open/news/notice.htm';
const lh = 'https://apply.lh.or.kr/lhapply/apply/wt/wrtanc';
const gwangyang = 'https://gwangyang.go.kr/saeol/gosi.es';
const lhRegions = {
  서울: 'seoul', 부산: 'busan', 대구: 'daegu', 인천: 'incheon', 광주: 'jeonnam', 대전: 'daejeon',
  울산: 'ulsan', 세종: 'sejong', 경기: 'gyeonggi', 강원: 'gangwon', 충북: 'chungbuk',
  충남: 'chungnam', 전북: 'jeonbuk', 전남: 'jeonnam', 경북: 'gyeongbuk', 경남: 'gyeongnam', 제주: 'jeju',
};

function schedules(lines, year) {
  const range = field(lines, /^(?:(?:[○ㅇ■□▪•※-]|[가-하]\.)\s*)?(?:신청|접수|모집)\s*(?:기간|접수)\s*[:：]/);
  const closing = field(lines, /^(?:[○ㅇ■□▪•※-]\s*)?(?:조기\s*마감|접수\s*(?:마감|종료)|모집\s*(?:마감|종료))(?:\s*(?:안내|되었습니다|됐습니다|합니다|하였습니다)|\s*[.:：]|$)/);
  return {
    ...period(afterLabel(range) ?? '', year),
    ...(closing && !/가능|예정|경우|이후|시까지|될 수|기한|일시|마감일/.test(closing) ? { status: 'closed' } : {}),
  };
}

function supportDetails(lines) {
  return {
    applicant: afterLabel(field(lines, /^[○ㅇ□-]?\s*지원\s*대상\s*[:：]/)),
    benefit: afterLabel(field(lines, /^[○ㅇ□-]?\s*지원\s*내용\s*[:：]/)),
  };
}

function incheonApplication($, detail) {
  const app = applicationFromLines(detail.find('li').map((_, li) => text($(li))).get());
  const blocks = detail.find('li').filter((_, li) => $(li).children('strong').length);
  const steps = blocks.filter((_, li) => /^추진절차/.test(text($(li).children('strong').first())))
    .find('li').map((_, li) => text($(li)).replace(/^\d+단계\s*/, '')).get();
  const documents = blocks.filter((_, li) => /^(?:추진|제출|구비)서류/.test(text($(li).children('strong').first())))
    .find('li').map((_, li) => text($(li))).get()
    .filter(entry => /\((?:필수|선택)\)$/.test(entry) && entry.length <= 130);
  if (steps.length > 1 && steps.length <= 8 && steps.every(step => step && step.length <= 170)) app.steps = steps;
  if (documents.length && documents.length <= 14) app.documents = documents;
  return app;
}

function jejuApplication(lines) {
  const app = applicationFromLines(lines);
  const start = lines.findIndex(line => /^(?:[가-하]\.|○)\s*신청접수\s*[:：]/.test(line));
  if (start < 0) return app;
  const first = lines.slice(start + 1, start + 4);
  const method = first.find(line => /^1\)\s*(?:현장|방문|온라인|이메일|우편)/.test(line));
  const channels = channelsFrom(method);
  if (channels.length) Object.assign(app, { method: method.replace(/^1\)\s*/, ''), channels });
  const initial = first.find(line => /^2\)\s*본인 확인 서류.*동의서/.test(line));
  if (initial) app.documents = ['본인 확인 서류', '공급 신청서', '개인정보 동의서'];
  const subsequent = lines.slice(start + 1).find(line => /^(?:[가-하]\.|○)\s*서류제출대상자\s*발표/.test(line));
  if (subsequent) app.steps = ['공고에 안내된 방법으로 신청합니다.', '서류 제출 대상 발표를 확인합니다.', '대상자로 선정된 경우 별도 기간에 추가 증빙을 제출합니다.'];
  return app;
}

export const sources = [
  {
    key: 'seoul', region: 'seoul', agency: '서울 청년몽땅정보통', host: 'youth.seoul.go.kr', idParam: 'sprtInfoId',
    lists: variants(`${seoul}/list.do`, 'sw', ['청년월세', '이사비', '임차보증금', '청년매입임대', '청년안심주택'], { key: '2309130006' }),
    list($) {
      return $('a.item-overlay[onclick]').map((_, a) => ({
        id: $(a).attr('onclick').match(/goView\('(\d+)'\)/)?.[1], title: text($(a)),
      })).get();
    },
    empty: $ => /전체\s*0건/.test($('.tab-btn li.active').text()),
    detailUrl: id => url(`${seoul}/view.do`, { key: '2309130006', sprtInfoId: id }),
    detail($) {
      const title = text($('.feed-view .overview .tit strong').first());
      const support = $('.feed-view .overview .info li').filter((_, li) => text($(li).find('em')) === '신청기간').first();
      const lines = $('.feed-view .detail .editor-text p').map((_, p) => text($(p))).get().filter(Boolean);
      const schedule = schedules(lines, yearFrom(title));
      const structured = period(text(support.clone().find('em').remove().end()), yearFrom(title));
      if (structured?.closes.includes('T00:00:00')) structured.closes = structured.closes.slice(0, 10);
      return { title, ...structured, ...schedule, ...supportDetails(lines), application: applicationFromLines(lines),
        eligible: text($('.feed-view .overview .cate')) === '주거' };
    },
  },
  {
    key: 'incheon', region: 'incheon', agency: '인천청년포털', host: 'youth.incheon.go.kr', idParam: 'poly_seq',
    lists: variants(`${incheon}/youthPolicyInfoList.do`, 'keyword', ['월세', '이사비', '임차보증금']),
    list($) {
      return $('.boardList > li').map((_, li) => ({
        id: $(li).find('a[href*="poly_seq="]').attr('href')?.match(/poly_seq=(\d+)/)?.[1],
        title: text($(li).find('.tit')),
      })).get();
    },
    detailUrl: id => url(`${incheon}/youthPolicyInfoDetail.do`, { poly_seq: id }),
    detail($) {
      const title = text($('#con-tit h3').first());
      const detail = $('#detail_con');
      const lines = detail.find('li').map((_, li) => text($(li))).get();
      const applicant = field(lines, /^지원대상\s*[:：]/);
      const branches = detail.find('.btnBox a, a.btn_back').map((_, a) => explicitStatus(text($(a)))).get();
      return { title, ...schedules(lines, yearFrom(title)), status: branches.find(Boolean), applicant: afterLabel(applicant),
        application: incheonApplication($, detail),
        eligible: !detail.text().includes('전국 청년월세 지원사업') && !/청년\s*월세\s*(한시\s*)?(특별\s*)?지원/.test(title) };
    },
  },
  {
    key: 'chungnam', region: 'chungnam', agency: '충남청년포털', host: 'youth.chungnam.go.kr', idPath: /\/cnyouth_notice\/(\d+)/,
    lists: [chungnam, url(chungnam, { cp: '2' }), url(chungnam, { cp: '3' })],
    list($) {
      return $('a[href*="/cnyouth_notice/"]').map((_, a) => ({
        id: $(a).attr('href').match(/\/cnyouth_notice\/(\d+)/)?.[1], title: text($(a)),
      })).get();
    },
    detailUrl: id => `${chungnam}/${id}`,
    detail($) {
      const title = text($('.content_in_wrap h5').first());
      const lines = asLines($, $('.ntc_cont_view'));
      const postedYear = Number(text($('.ntc_board_view .top_info_dt span').first()).slice(0, 4));
      return { title, ...schedules(lines, yearFrom(title) ?? postedYear), ...supportDetails(lines), application: applicationFromLines(lines) };
    },
  },
  {
    key: 'daejeon', region: 'daejeon', agency: '대전청년포털', host: 'www.daejeonyouthportal.kr', idParam: 'searchSeq',
    lists: ['162', '164', '381'].map(searchCategory => url(`${daejeon}/articleList.do`, { commonMenuNo: '8_30_31', searchCategory })),
    list($) {
      return $('a.bd_lst_tit').map((_, a) => ({
        id: $(a).attr('href')?.match(/fn_go_view\((\d+)/)?.[1], title: text($(a)),
      })).get();
    },
    detailUrl: id => url(`${daejeon}/articleView.do`, { commonMenuNo: '8_30_31', searchSeq: id }),
    detail($) {
      const title = text($('h4').filter((_, h) => /청년.*(공고|모집|지원)/.test(text($(h)))).last());
      const lines = $('main p, main li, #contents p, #contents li').map((_, p) => text($(p))).get().filter(line => line && line.length < 250);
      return { title, ...schedules(lines, yearFrom(title)), ...supportDetails(lines), application: applicationFromLines(lines) };
    },
  },
  {
    key: 'jeju', region: 'jeju', agency: '제주특별자치도개발공사', host: 'www.jpdc.co.kr', idParam: 'seq',
    lists: [url(jeju, { qType: 'title', q: '청년' })],
    list($) {
      return $('td a[href*="act=view"][href*="seq="]').map((_, a) => ({
        id: $(a).attr('href').match(/[?&]seq=(\d+)/)?.[1], title: text($(a)),
      })).get();
    },
    detailUrl: id => url(jeju, { act: 'view', qType: 'title', seq: id }),
    detail($) {
      const title = text($('.board-view .title, .board_view .title, p.subject, p.title').first()) || text($('title')).split(' > ').at(-1)?.replace(/\s+제주특별자치도개발공사$/, '');
      const lines = $('p').map((_, p) => text($(p))).get().filter(Boolean);
      const postedYear = Number(lines.find(line => /작성일\s*[:：]\s*20\d{2}/.test(line))?.match(/20\d{2}/)?.[0]);
      return { title, ...schedules(lines, yearFrom(title) || postedYear), application: jejuApplication(lines) };
    },
  },
  {
    key: 'gwangyang', region: 'jeonnam', municipality: '광양시', agency: '광양시청', host: 'gwangyang.go.kr', idParam: 'seq',
    lists: ['1', '2', '3'].map(nPage => url(gwangyang, { act: 'list', mid: 'a10909020000', nPage })),
    empty: $ => $('tbody').text().includes('게시물이 존재하지 않습니다.'),
    list($) {
      return $('a[href*="act=view"][href*="seq="]').map((_, a) => ({
        id: $(a).attr('href')?.match(/[?&]seq=(\d+)/)?.[1], title: text($(a)),
      })).get();
    },
    detailUrl: seq => url(gwangyang, { act: 'view', mid: 'a10909020000', seq }),
    detail($) {
      const title = text($('th.bbs_tit').first());
      const lines = asLines($, $('td.view_content'));
      return { title, ...schedules(lines, yearFrom(title)), ...supportDetails(lines), application: applicationFromLines(lines) };
    },
  },
  {
    key: 'lh', region: 'national', agency: '한국토지주택공사', host: 'apply.lh.or.kr', idParam: 'panId',
    lists: ['17', '26'].flatMap(aisTpCd => ['공고중', '접수마감'].map(panSs => url(`${lh}/selectWrtancList.do`, {
      aisTpCd, srchAisTpCd: aisTpCd, srchUppAisTpCd: '13', uppAisTpaCd: '13', listCo: '50', mi: '1026', panSs,
    }))),
    empty: $ => $('td[colspan="9"]').text().includes('검색하신 결과가 없습니다.'),
    list($) {
      return $('a.wrtancInfoBtn[data-id1]').map((_, a) => {
        const link = $(a);
        const cells = link.closest('tr').children('td');
        const id = link.attr('data-id1');
        const coverage = text(cells.eq(3));
        const region = lhRegions[coverage.slice(0, 2)];
        return {
          id, title: text(link.clone().find('em').remove().end()),
          source: url(`${lh}/selectWrtancInfo.do`, { aisTpCd: link.attr('data-id4'),
            ccrCnntSysDsCd: link.attr('data-id2'), panId: id, uppAisTpCd: link.attr('data-id3') }),
          status: explicitStatus(text(cells.eq(7))),
          region: region && !/외|,|·/.test(coverage) ? region : undefined,
        };
      }).get();
    },
    detail($, html, item) {
      const start = html.match(/var ustAcpStDttm = '([^']+)'/)?.[1];
      const end = html.match(/var ustAcpClsgDttm = '([^']+)'/)?.[1];
      const schedule = start && end ? period(`${start} ~ ${end}`) : undefined;
      return { title: item.title, ...(schedule ?? item.period), status: item.status };
    },
  },
];

export async function fetchPage(address, host) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(address, {
        redirect: 'error', headers: { accept: 'text/html', 'user-agent': 'SirenHousing/1.0 (+https://github.com/chungboklee/siren-housing)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (new URL(response.url).hostname !== host || !response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > 5_000_000) throw new Error('page too large');
      const html = buffer.toString('utf8');
      return { $: load(html), html };
    } catch (error) {
      if (attempt === 1) throw new Error(`request failed: ${error.message}`);
    }
  }
}
