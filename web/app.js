import { blankStore, parseBackup, shiftDays, shiftMonth, today } from './model.js';
import { createDialogs } from './dialogs.js';
import { clientResults, h, icon, journalResults, routes, views } from './views.js';

const locationScope = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '');
const storageKey = 'tacta.v1:' + locationScope;
const workspace = document.querySelector('#workspace');
const notice = document.querySelector('#notification');
const navigation = document.querySelector('#navigation');
const settingsNavigation = document.querySelector('#settings-navigation');
const state = {
  page: 'today', clientId: '', day: today(), mode: 'day', financeMonth: today(),
  clientSearch: '', journalSearch: '', journalStatus: '',
};
let store;
let storageProblem = '';
let noticeTimer;

function notify(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4000);
}

function readStore() {
  const data = localStorage.getItem(storageKey);
  return data === null ? null : parseBackup(data);
}

function refreshStore() {
  try {
    store = readStore() ?? store ?? blankStore();
    storageProblem = '';
  } catch {
    store ??= blankStore();
    storageProblem = 'Не удалось прочитать данные браузера. Проверьте доступ к хранилищу или восстановите резервную копию в настройках.';
  }
}

function updateStore(change, { replacement = false } = {}) {
  const update = () => {
    let candidate;
    try {
      candidate = replacement ? blankStore() : (readStore() ?? structuredClone(store));
    } catch {
      throw new Error('Браузер не предоставил доступ к данным. Проверьте настройки хранилища.');
    }
    const before = JSON.stringify(candidate);
    const result = change(candidate);
    const after = JSON.stringify(candidate);
    if (before !== after || replacement) {
      parseBackup(after);
      try {
        localStorage.setItem(storageKey, after);
      } catch {
        throw new Error('Браузер не смог сохранить изменения. Проверьте свободное место и доступ к хранилищу.');
      }
    }
    store = candidate;
    storageProblem = '';
    if (before !== after || replacement) render();
    return result;
  };
  return navigator.locks ? navigator.locks.request(storageKey, update) : Promise.resolve().then(update);
}

function navLink(page, active) {
  const [title, glyph] = routes[page];
  return `<a href="#${page}"${active ? ' class="active" aria-current="page"' : ''}>${icon(glyph)}<span>${title}</span></a>`;
}

function setRoute() {
  const [section, id] = location.hash.slice(1).split('/');
  state.page = Object.hasOwn(routes, section) ? section : 'today';
  state.clientId = '';
  if (state.page === 'clients' && id) {
    try {
      state.clientId = decodeURIComponent(id);
    } catch {
      // A malformed link opens the client list.
    }
  }
}

function render() {
  const route = state.page;
  const page = route === 'clients' && state.clientId ? 'client' : route;
  navigation.innerHTML = Object.keys(routes).filter(key => key !== 'settings').map(key => navLink(key, key === route)).join('');
  settingsNavigation.innerHTML = navLink('settings', route === 'settings');
  workspace.innerHTML = (storageProblem ? `<p class="storage-problem" role="alert">${h(storageProblem)}</p>` : '') + views[page](store, state);
  workspace.querySelector('h1')?.setAttribute('tabindex', '-1');
  document.title = `${routes[route][0]} · Tacta`;
}

function navigate(page, clientId = '') {
  const hash = '#' + page + (clientId ? '/' + encodeURIComponent(clientId) : '');
  if (location.hash === hash) return;
  history.pushState(null, '', hash);
  routeChanged();
}

function routeChanged() {
  if (location.hash === '#content') return;
  if (document.querySelector('#dialog').open) dialogs.close();
  setRoute();
  render();
  workspace.querySelector('h1')?.focus();
  window.scrollTo(0, 0);
}

function exportBackup() {
  if (storageProblem) throw new Error('Сначала восстановите доступ к данным.');
  const data = readStore() ?? store;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tacta-backup-${today()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Резервная копия скачивается');
}

async function chooseBackup(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const backup = parseBackup(await file.text());
    dialogs.confirm('Восстановить из копии?',
      'Копия заменит клиентов, записи, абонементы и услуги в этом браузере.', 'Восстановить', async () => {
        await updateStore(current => Object.assign(current, backup), { replacement: true });
        dialogs.close();
        notify('Данные восстановлены из копии');
      }, 'primary');
  } catch (failure) {
    notify(failure.message);
  }
}

const dialogs = createDialogs(document.querySelector('#dialog'), {
  getStore: () => store, save: updateStore, navigate, notify,
});

const actions = {
  'new-client': () => dialogs.clientForm(),
  'edit-client': id => dialogs.clientForm(id),
  client: id => navigate('clients', id),
  'delete-client': id => dialogs.clientDeletion(id),
  'new-pass': id => dialogs.passForm(id),
  'new-appointment': id => dialogs.appointmentForm(state.page === 'calendar' ? state.day : today(), id),
  appointment: id => dialogs.appointmentDetail(id),
  'new-service': () => dialogs.serviceForm(),
  'edit-service': id => dialogs.serviceForm(id),
  'calendar-mode': mode => { state.mode = mode; render(); },
  'calendar-today': () => { state.day = today(); render(); },
  'select-day': day => { state.day = day; render(); },
  'calendar-shift': delta => {
    state.day = state.mode === 'month' ? shiftMonth(state.day, Number(delta))
      : shiftDays(state.day, Number(delta) * (state.mode === 'week' ? 7 : 1));
    render();
  },
  'finance-shift': delta => { state.financeMonth = shiftMonth(state.financeMonth, Number(delta)); render(); },
  'choose-import': () => document.querySelector('#import-file').click(),
  export: exportBackup,
};

workspace.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || !Object.hasOwn(actions, control.dataset.action)) return;
  try {
    const { action, id } = control.dataset;
    const hadFocus = control === document.activeElement;
    actions[action](id);
    if (hadFocus && !control.isConnected) {
      const next = Array.from(workspace.querySelectorAll('[data-action]'))
        .find(item => item.dataset.action === action && item.dataset.id === id);
      (next ?? workspace.querySelector('h1'))?.focus();
    }
  } catch (failure) {
    notify(failure.message);
  }
});

workspace.addEventListener('input', event => {
  const { field } = event.target.dataset;
  if (field === 'client-search') {
    state.clientSearch = event.target.value;
    document.querySelector('#results').innerHTML = clientResults(store, state.clientSearch);
  } else if (field === 'journal-search') {
    state.journalSearch = event.target.value;
    document.querySelector('#results').innerHTML = journalResults(store, state);
  }
});

workspace.addEventListener('change', event => {
  const { field } = event.target.dataset;
  if (event.target.id === 'import-file') chooseBackup(event.target);
  else if (field === 'journal-status') {
    state.journalStatus = event.target.value;
    document.querySelector('#results').innerHTML = journalResults(store, state);
  } else if (field === 'calendar-day' && event.target.value) {
    state.day = event.target.value;
    render();
    workspace.querySelector('[data-field="calendar-day"]').focus();
  }
});

window.addEventListener('hashchange', routeChanged);
window.addEventListener('storage', event => {
  if (event.key !== null && event.key !== storageKey) return;
  store = null;
  refreshStore();
  render();
});
refreshStore();
setRoute();
render();
