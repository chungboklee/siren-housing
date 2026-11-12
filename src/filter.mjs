import { noticeState, states } from './schedule.mjs';

const now = new Date();
for (const label of document.querySelectorAll('[data-opens][data-closes]')) {
  const state = noticeState(label.dataset.opens, label.dataset.closes, now);
  label.dataset.state = state;
  label.textContent = states[state];
}

const controls = document.querySelector('#filters');
if (controls) {
  const rows = Array.from(document.querySelectorAll('#notices article'));
  const result = document.querySelector('#results');
  const empty = document.querySelector('#empty');
  const params = new URLSearchParams(location.search);

  for (const select of controls.querySelectorAll('select')) {
    const value = params.get(select.name);
    if (Array.from(select.options).some(option => option.value === value)) select.value = value;
  }

  const filter = () => {
    const { region, category, status } = Object.fromEntries(new FormData(controls));
    let count = 0;
    for (const row of rows) {
      const matchesRegion = !region || row.dataset.region === region || row.dataset.region === 'national';
      const matchesCategory = !category || row.dataset.category === category;
      const matchesStatus = !status || row.querySelector('[data-state]').dataset.state === status;
      row.hidden = !(matchesRegion && matchesCategory && matchesStatus);
      if (!row.hidden) count += 1;
    }
    result.textContent = `${count}건`;
    empty.hidden = count > 0;
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(controls)) if (value) query.set(key, value);
    history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`);
  };

  controls.hidden = false;
  controls.addEventListener('submit', event => event.preventDefault());
  controls.addEventListener('change', filter);
  filter();
}
