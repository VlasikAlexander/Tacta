import {
  activePasses, appointmentDay, billingKinds, cash, clientName, dateAt, incomeFor,
  mondayOf, monthOf, payments, remaining, shiftDays, statuses, today, usedSessions,
} from './model.js';

const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2"/>',
  people: '<path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m3-6a4 4 0 0 1 3 4v2"/><circle cx="9" cy="7" r="3"/><path d="M17 4a3 3 0 0 1 0 6"/>',
  journal: '<rect x="6" y="3" width="14" height="18" rx="2"/><path d="M6 8H3m3 4H3m3 4H3m7-8h6m-6 4h6"/>',
  finance: '<path d="M4 19V5m0 14h16M8 15v-3m5 3V8m5 7v-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m10 2-.7 3-2 .9-2.8-1.4-2 3.5 2.3 2.1v3.8L2.5 16l2 3.5 2.8-1.4 2 .9.7 3h4l.7-3 2-.9 2.8 1.4 2-3.5-2.3-2.1v-3.8L21.5 8l-2-3.5-2.8 1.4-2-.9L14 2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  ticket: '<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM14 8v1m0 3v1m0 3v1"/>',
  pound: '<path d="M17 19H7c3-2 3-4 2-8-1-4 1-6 4-6 2 0 3 1 4 2M7 13h8"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.5m11 0h.5"/>',
  transfer: '<path d="M3 8h16l-3-3m5 11H5l3 3"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6m-6 4h6"/>',
};

export const icon = name => `<svg aria-hidden="true" class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
export const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export const routes = {
  today: ['Сегодня', 'sun'],
  calendar: ['Календарь', 'calendar'],
  clients: ['Клиенты', 'people'],
  journal: ['Журнал', 'journal'],
  finance: ['Финансы', 'finance'],
  settings: ['Настройки', 'settings'],
};

export const viewModes = { day: 'День', week: 'Неделя', month: 'Месяц' };
export const localDate = (key, options = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Intl.DateTimeFormat('ru-RU', options).format(dateAt(key));
export const formatTime = date => new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit', minute: '2-digit',
}).format(new Date(date));
export const serviceLabel = service => `${service.name ?? service.service} · ${service.duration} мин`;

export function button(label, action, { id = '', glyph = '', style = 'secondary', disabled = false } = {}) {
  return `<button type="button" class="button ${style}" data-action="${action}"${id ? ` data-id="${h(id)}"` : ''}${disabled ? ' disabled' : ''}>${glyph ? icon(glyph) : ''}${h(label)}</button>`;
}

export const section = (title, content, action = '') => `<section class="panel">
  <header class="panel-header"><h2>${h(title)}</h2>${action}</header>${content}</section>`;
export const muted = text => `<p class="muted">${h(text)}</p>`;

function heading(title, description, action = '') {
  return `<header class="page-heading"><div><h1>${h(title)}</h1>
    ${description ? `<p>${h(description)}</p>` : ''}</div>${action}</header>`;
}

export function empty(glyph, title, detail, action = '') {
  return `<div class="empty"><span class="empty-icon">${icon(glyph)}</span><h3>${h(title)}</h3>
    <p>${h(detail)}</p>${action}</div>`;
}

export const statusBadge = status => `<span class="badge ${status}"><i></i>${statuses[status]}</span>`;

function metric(value, label, glyph, theme = '') {
  return `<div class="metric ${theme}"><span class="metric-icon">${icon(glyph)}</span>
    <div><strong>${h(value)}</strong><span>${h(label)}</span></div></div>`;
}

export function itemsForDay(store, day) {
  return store.appointments.filter(item => appointmentDay(item) === day)
    .sort((left, right) => left.start.localeCompare(right.start));
}

export function appointmentRows(store, appointments) {
  return `<div class="rows">${appointments.map(item => `<button class="record" type="button"
    data-action="appointment" data-id="${h(item.id)}"><span class="time">${formatTime(item.start)}</span>
    <span class="record-text"><strong>${h(clientName(store, item.clientId))}</strong>
    <small>${h(serviceLabel(item))} · ${billingKinds[item.billing]}</small></span>
    ${statusBadge(item.status)}${icon('right')}</button>`).join('')}</div>`;
}

const newAppointment = () => button('Новая запись', 'new-appointment', { style: 'primary', glyph: 'plus' });
const newClient = () => button('Новый клиент', 'new-client', { style: 'primary', glyph: 'plus' });

function todayView(store) {
  const key = today();
  const items = itemsForDay(store, key);
  const completed = items.filter(item => item.status === 'completed').length;
  return `${heading('Сегодня', localDate(key, { weekday: 'long', day: 'numeric', month: 'long' }), newAppointment())}
    <div class="metrics">
      ${metric(items.length, 'Записей сегодня', 'calendar')}
      ${metric(completed, 'Завершено', 'check', 'sage')}
    </div>
    ${section('Расписание на сегодня', items.length ? appointmentRows(store, items) : empty(
      'calendar', 'Сегодня свободно', 'Добавьте запись, когда появится клиент.',
      button('Добавить запись', 'new-appointment', { glyph: 'plus' }),
    ), '<a class="text-link" href="#calendar">Открыть календарь</a>')}`;
}

function timeline(state, store) {
  const month = monthOf(state.day);
  const firstOfMonth = month + '-01';
  const monthView = state.mode === 'month';
  const starts = mondayOf(monthView ? firstOfMonth : state.day);
  const monthDate = dateAt(firstOfMonth);
  const monthLength = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const leadingDays = (monthDate.getDay() + 6) % 7;
  const count = monthView ? Math.ceil((leadingDays + monthLength) / 7) * 7 : 7;
  const days = new Map();
  for (const item of store.appointments) {
    const key = appointmentDay(item);
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  const labels = Array.from({ length: 7 }, (_, index) => localDate(shiftDays(starts, index), { weekday: 'short' }));
  const cells = Array.from({ length: count }, (_, index) => {
    const key = shiftDays(starts, index);
    const selected = key === state.day;
    const current = key === today();
    const dayCount = days.get(key) ?? 0;
    const dayLabel = localDate(key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `<button class="day-cell${selected ? ' selected' : ''}${monthView && monthOf(key) !== month ? ' outside' : ''}"
      type="button" data-action="select-day" data-id="${key}" aria-pressed="${selected}"${current ? ' aria-current="date"' : ''}
      aria-label="${h(dayLabel)}${dayCount ? `, записей: ${dayCount}` : ''}"><strong>${Number(key.slice(-2))}</strong>
      ${dayCount ? `<span class="day-count" aria-hidden="true">${dayCount}</span>` : ''}</button>`;
  });
  return `<div class="day-grid">${labels.map(label => `<span class="weekday">${h(label)}</span>`).join('')}${cells.join('')}</div>`;
}

function pager(title, action) {
  return `<div class="pager"><button class="button icon-button" type="button" data-action="${action}" data-id="-1" aria-label="Назад">${icon('left')}</button>
    <strong>${h(title)}</strong><button class="button icon-button" type="button" data-action="${action}" data-id="1" aria-label="Вперёд">${icon('right')}</button></div>`;
}

function calendarView(store, state) {
  const items = itemsForDay(store, state.day);
  const period = localDate(state.day, state.mode === 'day'
    ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' });
  return `${heading('Календарь', '', newAppointment())}
    <section class="panel calendar-panel">
      <div class="calendar-tools"><div class="segments" aria-label="Вид календаря">${Object.entries(viewModes)
        .map(([mode, title]) => `<button type="button" data-action="calendar-mode" data-id="${mode}" aria-pressed="${mode === state.mode}">${title}</button>`).join('')}</div>
        ${button('Сегодня', 'calendar-today')}</div>
      <div class="calendar-controls">${pager(period, 'calendar-shift')}${state.mode === 'day'
        ? `<input class="day-input" aria-label="Выбрать дату" data-field="calendar-day" type="date" value="${state.day}">` : ''}</div>
      ${state.mode === 'day' ? '' : timeline(state, store)}
    </section>
    ${section(localDate(state.day, { weekday: 'long', day: 'numeric', month: 'long' }),
    items.length ? appointmentRows(store, items) : empty('calendar', 'Нет записей', 'На выбранный день ничего не запланировано.'))}`;
}

const searchInput = (field, value, placeholder) => `<label class="search">${icon('search')}
  <input type="search" data-field="${field}" value="${h(value)}" aria-label="${placeholder}" placeholder="${placeholder}"></label>`;
const normalize = value => value.trim().toLocaleLowerCase('ru');
const matches = (query, ...values) => values.some(value => normalize(value).includes(normalize(query)));

export function clientResults(store, query) {
  const items = store.clients.filter(client => matches(query, client.name, client.phone))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  if (!items.length) return empty('people', query.trim() ? 'Клиенты не найдены' : 'Добавьте первого клиента',
    query.trim() ? 'Проверьте имя или номер телефона.' : 'Здесь появятся контакты, заметки и абонементы.');
  return `<div class="rows">${items.map(client => {
    const pass = activePasses(store, client.id)[0];
    return `<button class="record" type="button" data-action="client" data-id="${h(client.id)}">
      <span class="avatar">${h(client.name.trim().slice(0, 1).toLocaleUpperCase('ru'))}</span>
      <span class="record-text"><strong>${h(client.name)}</strong>${client.phone ? `<small>${h(client.phone)}</small>` : ''}</span>
      ${pass ? `<span class="badge completed">${icon('ticket')} Осталось ${remaining(store, pass)} из ${pass.total}</span>` : ''}${icon('right')}</button>`;
  }).join('')}</div>`;
}

function clientsView(store, state) {
  return `${heading('Клиенты', 'Контакты, история сеансов и абонементы', newClient())}
    <div class="filters">${searchInput('client-search', state.clientSearch, 'Имя или телефон')}</div>
    <section class="panel" id="results" aria-label="Клиенты">${clientResults(store, state.clientSearch)}</section>`;
}

export const facts = pairs => `<dl class="facts">${pairs.filter(([, value]) => value).map(([label, value]) =>
  `<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>`;

function clientView(store, state) {
  const client = store.clients.find(item => item.id === state.clientId);
  if (!client) return clientsView(store, state);
  const passes = store.passes.filter(item => item.clientId === client.id).sort((a, b) => b.date.localeCompare(a.date));
  const items = store.appointments.filter(item => item.clientId === client.id).sort((a, b) => b.start.localeCompare(a.start));
  const oils = items.filter(item => item.oils.trim());
  const important = client.allergies || client.contraindications;
  return `<a href="#clients" class="back-link">${icon('left')} Все клиенты</a>
    ${heading(client.name, client.phone, `<div class="actions">
      ${button('Редактировать', 'edit-client', { id: client.id })}
      ${button('Новая запись', 'new-appointment', { id: client.id, glyph: 'plus', style: 'primary' })}
    </div>`)}
    ${client.birthday ? section('Контакты', facts([['Дата рождения', localDate(client.birthday)]])) : ''}
    ${important ? section('Важно', facts([['Аллергии', client.allergies], ['Противопоказания', client.contraindications]])) : ''}
    ${client.preferences || client.notes ? section('Заметки', facts([
      ['Предпочтения', client.preferences], ['Общие заметки', client.notes],
    ])) : ''}
    ${section('Абонементы', passes.length ? `<div class="pass-list">${passes.map(pass => {
      const available = remaining(store, pass);
      return `<article class="pass"><div><strong>${h(serviceLabel(pass))}</strong>
        <span class="badge ${available && !pass.cancelled ? 'completed' : 'inactive'}">${available && !pass.cancelled ? 'Активен' : 'Завершён'}</span></div>
        <progress max="${pass.total}" value="${Math.min(pass.total, usedSessions(store, pass))}" aria-label="Использованные посещения"></progress>
        <small>Использовано ${usedSessions(store, pass)} из ${pass.total} · осталось ${available}</small>
        <small>${localDate(pass.date)} · ${cash(pass.price)} · ${payments[pass.payment]}</small></article>`;
    }).join('')}</div>` : muted('Абонементов пока нет'),
    button('Добавить абонемент', 'new-pass', { id: client.id, glyph: 'plus' }))}
    ${oils.length ? section('Использованные масла', facts(oils.map(item => [localDate(appointmentDay(item)), item.oils]))) : ''}
    ${section('История сеансов', items.length ? appointmentRows(store, items.slice(0, 20)) : muted('Сеансов пока нет'))}
    <div>${button('Удалить клиента', 'delete-client', { id: client.id, style: 'danger outline' })}</div>`;
}

export function journalResults(store, state) {
  const items = store.appointments.filter(item => (!state.journalStatus || item.status === state.journalStatus)
    && matches(state.journalSearch, clientName(store, item.clientId), item.service))
    .sort((a, b) => b.start.localeCompare(a.start));
  if (!items.length) return empty('journal', 'Записи не найдены', 'Здесь появится история сеансов.');
  const groups = new Map();
  for (const item of items) {
    const day = appointmentDay(item);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }
  return Array.from(groups, ([day, list]) => section(localDate(day), appointmentRows(store, list))).join('');
}

export function options(choices, current, placeholder = '') {
  return `${placeholder ? `<option value="">${h(placeholder)}</option>` : ''}${choices.map(([value, label]) =>
    `<option value="${h(value)}"${String(value) === String(current) ? ' selected' : ''}>${h(label)}</option>`).join('')}`;
}

function journalView(store, state) {
  return `${heading('Журнал', 'История записей и сеансов')}
    <div class="filters">${searchInput('journal-search', state.journalSearch, 'Клиент или услуга')}
      <select data-field="journal-status" aria-label="Статус записи">
        ${options([['', 'Все статусы'], ...Object.entries(statuses)], state.journalStatus)}</select></div>
    <div class="result-stack" id="results">${journalResults(store, state)}</div>`;
}

function financeView(store, state) {
  const items = incomeFor(store, monthOf(state.financeMonth));
  const cashTotal = items.filter(item => item.payment === 'cash').reduce((sum, item) => sum + item.amount, 0);
  const transferTotal = items.filter(item => item.payment === 'bankTransfer').reduce((sum, item) => sum + item.amount, 0);
  return `${heading('Финансы', 'Оплаты сеансов и абонементов')}
    <div class="panel finance-period">${pager(localDate(state.financeMonth, { month: 'long', year: 'numeric' }), 'finance-shift')}</div>
    <div class="metrics">
      ${metric(cash(cashTotal + transferTotal), 'За месяц', 'pound')}
      ${metric(cash(cashTotal), 'Наличные', 'cash', 'sage')}
      ${metric(cash(transferTotal), 'Переводы', 'transfer', 'blue')}
    </div>
    ${section('Операции', items.length ? `<div class="rows">${items.map(item => `<div class="record transaction">
      <span class="record-text"><strong>${h(clientName(store, item.clientId))}</strong>
      <small>${h(item.service)} · ${localDate(item.date)}</small></span>
      <span class="record-text amount"><strong>${cash(item.amount)}</strong><small>${payments[item.payment]}</small></span></div>`).join('')}</div>` :
      empty('finance', 'Нет оплат', 'В этом месяце пока нет операций.'))}`;
}

function settingsView(store) {
  const services = [...store.services].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.duration - b.duration);
  return `${heading('Настройки', 'Услуги, цены и данные практики')}
    ${section('Виды массажа и цены', services.length ? `<div class="rows">${services.map(service => `<button class="record"
      type="button" data-action="edit-service" data-id="${h(service.id)}">
      <span class="record-text"><strong>${h(serviceLabel(service))}</strong>
      <small>${service.active ? 'Доступна для записи' : 'Скрыта'}</small></span>
      <span class="record-text amount"><strong>${cash(service.price)}</strong><small>5 + 1 · ${cash(service.passPrice || service.price * 5)}</small></span>
      ${icon('right')}</button>`).join('')}</div>` : muted('Добавьте первую услугу'),
      button('Добавить услугу', 'new-service', { glyph: 'plus', style: 'primary' }))}
    ${section('Google Drive', '<div id="drive-settings"></div>')}
    ${section('Данные', `<p class="muted">Данные хранятся в этом браузере. Скачайте копию, чтобы восстановить их или перенести на другое устройство. Файл содержит клиентские данные.</p>
      <div class="actions panel-actions">${button('Скачать копию', 'export', { glyph: 'file' })}
      ${button('Восстановить из копии', 'choose-import')}</div><input id="import-file" type="file" accept=".json,application/json" hidden>`)}`;
}

export const views = {
  today: todayView, calendar: calendarView, clients: clientsView, client: clientView,
  journal: journalView, finance: financeView, settings: settingsView,
};

export function defaultStart(day) {
  const now = new Date();
  return day + 'T' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

export function endTime(item) {
  return formatTime(Date.parse(item.start) + item.duration * 60_000);
}
