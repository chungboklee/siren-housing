import { compareSchedules, noticeState, states } from './schedule.mjs';

const now = new Date();
for (const label of document.querySelectorAll('[data-opens][data-closes]')) {
  const state = noticeState(label.dataset.opens, label.dataset.closes, now, label.dataset.availability);
  label.dataset.state = state;
  label.textContent = states[state];
}

const controls = document.querySelector('#filters');
if (controls) {
  const list = document.querySelector('#notices');
  const rows = Array.from(list.children, row => ({ row, schedule: row.querySelector('[data-state]').dataset }));
  rows.sort(({ schedule: first }, { schedule: second }) => compareSchedules(first.state, first.closes, second.state, second.closes));
  list.append(...rows.map(({ row }) => row));
  const result = document.querySelector('#results');
  const empty = document.querySelector('#empty');
  const emptyRegion = document.querySelector('#empty-region');
  const params = new URLSearchParams(location.search);

  for (const select of controls.querySelectorAll('select')) {
    const value = params.get(select.name);
    if (Array.from(select.options).some(option => option.value === value)) select.value = value;
  }

  const filter = () => {
    const fields = new FormData(controls);
    const { region, category, status } = Object.fromEntries(fields);
    const [province, municipality] = region.split(':');
    let count = 0;
    let hasLocalNotices = false;
    for (const { row, schedule } of rows) {
      const { region: rowRegion, locality } = row.dataset;
      const matchesLocality = rowRegion === province && (!municipality || locality === province || locality === region);
      if (matchesLocality) hasLocalNotices = true;
      const matchesRegion = !region || rowRegion === 'national' || matchesLocality;
      const matchesCategory = !category || row.dataset.category === category;
      const matchesStatus = !status || schedule.state === status;
      row.hidden = !(matchesRegion && matchesCategory && matchesStatus);
      if (!row.hidden) count += 1;
    }
    result.textContent = `${count}건`;
    empty.hidden = count > 0;
    emptyRegion.hidden = !region || province === 'national' || hasLocalNotices || count === 0;
    const query = new URLSearchParams();
    for (const [key, value] of fields) if (value) query.set(key, value);
    history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`);
  };

  controls.hidden = false;
  controls.addEventListener('submit', event => event.preventDefault());
  controls.addEventListener('change', filter);
  filter();
}
