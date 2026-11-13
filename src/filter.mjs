import { compareSchedules, koreaDay, noticeState, states } from './schedule.mjs';
import { applicationEligibility } from './eligibility.mjs';

const compact = value => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');

const now = new Date();
for (const label of document.querySelectorAll('[data-opens][data-closes]')) {
  const state = noticeState(label.dataset.opens, label.dataset.closes, now, label.dataset.availability);
  label.dataset.state = state;
  label.textContent = states[state];
}

const controls = document.querySelector('#filters');
if (controls) {
  const list = document.querySelector('#notices');
  const rows = Array.from(list.children, row => ({
    row, schedule: row.querySelector('[data-state]').dataset,
    age: row.dataset.age ? row.dataset.age.split(',').map(Number) : null,
    audiences: row.dataset.audiences.split(','),
    channels: row.dataset.channels.split(','),
    search: compact(row.querySelector('.notice-main').textContent + row.dataset.keywords),
  }));
  rows.sort(({ schedule: first }, { schedule: second }) => compareSchedules(first.state, first.closes, second.state, second.closes));
  list.append(...rows.map(({ row }) => row));
  const result = document.querySelector('#results');
  const empty = document.querySelector('#empty');
  const emptyRegion = document.querySelector('#empty-region');
  const params = new URLSearchParams(location.search);
  const search = controls.elements.q;
  const ageField = controls.elements.age;
  const advanced = document.querySelector('#advanced-filters');
  const recent = koreaDay(new Date(+now - 13 * 864e5));
  const closing = koreaDay(new Date(+now + 7 * 864e5));
  search.value = (params.get('q') ?? '').slice(0, search.maxLength);
  if (/^\d{1,3}$/.test(params.get('age') ?? '')) ageField.value = params.get('age');

  for (const select of controls.querySelectorAll('select')) {
    const value = params.get(select.name);
    if (Array.from(select.options).some(option => option.value === value)) select.value = value;
  }
  advanced.open = [...advanced.querySelectorAll('input, select')].some(control => control.value);

  const filter = () => {
    const fields = new FormData(controls);
    const { region, category, status, audience, channel, timing, q } = Object.fromEntries(fields);
    const age = ageField.value && ageField.validity.valid ? ageField.valueAsNumber : null;
    const tokens = q.trim().split(/\s+/).map(compact).filter(Boolean);
    const [province, municipality] = region.split(':');
    let count = 0;
    let hasLocalNotices = false;
    for (const entry of rows) {
      const { row, schedule } = entry;
      const { region: rowRegion, locality } = row.dataset;
      const matchesLocality = rowRegion === province && (!municipality || locality === province || locality === region);
      if (matchesLocality) hasLocalNotices = true;
      const matchesRegion = !region || rowRegion === 'national' || matchesLocality;
      const matchesCategory = !category || row.dataset.category === category;
      const matchesStatus = !status || schedule.state === status;
      const matchesTiming = !timing || (timing === 'closing' ? schedule.state === 'open' &&
        schedule.closes && schedule.closes.slice(0, 10) <= closing : row.dataset.updated >= recent);
      row.hidden = !(matchesRegion && matchesCategory && matchesStatus && matchesTiming &&
        tokens.every(token => entry.search.includes(token)) && applicationEligibility(entry, age, audience, channel));
      row.querySelector('.notice-age-unknown').hidden = age === null || Boolean(entry.age);
      if (!row.hidden) count += 1;
    }
    result.textContent = `${count}건`;
    empty.hidden = count > 0;
    emptyRegion.hidden = !region || province === 'national' || hasLocalNotices || count === 0;
    const query = new URLSearchParams();
    for (const [key, value] of fields) if (value.trim() && (key !== 'age' || age !== null)) query.set(key, value.trim());
    history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`);
  };

  controls.hidden = false;
  controls.addEventListener('submit', event => event.preventDefault());
  controls.addEventListener('change', filter);
  controls.addEventListener('input', event => { if (event.target === search || event.target === ageField) filter(); });
  controls.addEventListener('reset', () => requestAnimationFrame(filter));
  filter();
}
