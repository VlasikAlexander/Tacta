import {
  activePasses, appointmentDay, billingKinds, cash, clientName, deleteClient, durations,
  findOverlap, finishAppointment, markAppointment, newId, passSessions, payments, pence,
  remaining, statuses, today,
} from './model.js';
import {
  button, defaultStart, endTime, facts, formatTime, h, icon, localDate, options,
  serviceLabel, statusBadge,
} from './views.js';

const textField = (name, label, value = '', attrs = '') =>
  `<label class="field"><span>${label}</span><input name="${name}" value="${h(value)}" ${attrs}></label>`;
const area = (name, label, value = '', rows = 3) =>
  `<label class="field"><span>${label}</span><textarea name="${name}" rows="${rows}">${h(value)}</textarea></label>`;
const select = (name, label, choices, value, placeholder = '') =>
  `<label class="field"><span>${label}</span><select name="${name}" required>${options(choices, value, placeholder)}</select></label>`;
const moneyField = (name, label, value = 0) => textField(name, label, (value / 100).toFixed(2),
  'type="number" inputmode="decimal" min="0" step="0.01" required');
const fields = (...items) => `<div class="field-grid">${items.join('')}</div>`;
const formActions = (label = 'Сохранить', style = 'primary') => `<div class="dialog-actions">
  ${button('Отмена', 'close-dialog')}<button type="submit" class="button ${style}">${label}</button></div>`;

function saveRecord(records, id, values) {
  if (!id) {
    const created = { id: newId(), ...values };
    records.push(created);
    return created.id;
  }
  const record = requireRecord(records, id);
  Object.assign(record, values);
  return id;
}

function requireRecord(records, id) {
  const record = records.find(item => item.id === id);
  if (!record) throw new Error('Запись больше недоступна.');
  return record;
}

const serviceOptions = store => store.services.filter(service => service.active)
  .sort((a, b) => a.duration - b.duration || a.name.localeCompare(b.name, 'ru'));

export function createDialogs(element, { getStore, save, navigate, notify }) {
  let submitHandler = null;
  let dialogActions = {};
  let opener;
  let busy = false;

  function show(title, content, { submit, actions = {} } = {}) {
    if (!element.open) opener = document.activeElement;
    submitHandler = submit;
    dialogActions = actions;
    element.innerHTML = `<header class="dialog-header"><h2 id="dialog-title" tabindex="-1">${h(title)}</h2>
      <button class="button icon-button" type="button" data-action="close-dialog" aria-label="Закрыть">${icon('close')}</button></header>
      ${submit ? `<form class="dialog-body">${content}<p class="form-error" role="alert" hidden></p></form>` :
      `<div class="dialog-body">${content}<p class="form-error" role="alert" hidden></p></div>`}`;
    if (!element.open) element.showModal();
    element.querySelector('h2').focus();
  }

  function close() {
    element.close();
    if (opener?.isConnected) opener.focus();
    else document.querySelector('#content h1')?.focus();
  }

  function error(message) {
    const field = element.querySelector('.form-error');
    field.textContent = message;
    field.hidden = false;
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    element.setAttribute('aria-busy', 'true');
    try {
      await action();
    } catch (failure) {
      error(failure.message);
    } finally {
      busy = false;
      element.removeAttribute('aria-busy');
    }
  }

  element.addEventListener('submit', event => {
    event.preventDefault();
    if (submitHandler) {
      const data = new FormData(event.target);
      run(() => submitHandler(data, event.submitter));
    }
  });

  element.addEventListener('click', event => {
    const control = event.target.closest('[data-action]');
    if (!control || busy) return;
    const action = control.dataset.action;
    if (action === 'close-dialog') close();
    else if (Object.hasOwn(dialogActions, action)) run(() => dialogActions[action](control));
  });

  element.addEventListener('cancel', event => {
    event.preventDefault();
    if (!busy) close();
  });

  function confirm(title, message, label, action, style = 'danger') {
    show(title, `<p>${h(message)}</p>${formActions(label, style)}`, { submit: action });
  }

  function clientForm(id, afterSave) {
    const client = getStore().clients.find(item => item.id === id) ?? {};
    show(id ? 'Редактировать клиента' : 'Новый клиент', `
      ${textField('name', 'Имя и фамилия', client.name, 'required autocomplete="off"')}
      ${fields(textField('phone', 'Телефон', client.phone, 'type="tel" autocomplete="off"'),
      textField('birthday', 'Дата рождения', client.birthday ?? '', `type="date" max="${today()}"`))}
      ${fields(area('allergies', 'Аллергии', client.allergies), area('contraindications', 'Противопоказания', client.contraindications))}
      ${area('preferences', 'Предпочтения и особенности', client.preferences)}
      ${area('notes', 'Общие заметки', client.notes)}
      ${formActions()}`, {
      async submit(data) {
        const name = data.get('name').trim();
        if (!name) throw new Error('Введите имя клиента.');
        const saved = await save(store => saveRecord(store.clients, id, {
          name, phone: data.get('phone').trim(), birthday: data.get('birthday') || null,
          allergies: data.get('allergies').trim(), contraindications: data.get('contraindications').trim(),
          preferences: data.get('preferences').trim(), notes: data.get('notes').trim(),
        }));
        notify(id ? 'Карточка обновлена' : 'Клиент добавлен');
        if (afterSave) afterSave(saved);
        else {
          navigate('clients', saved);
          close();
        }
      },
    });
  }

  function serviceForm(id) {
    const service = getStore().services.find(item => item.id === id) ?? {};
    const availableDurations = [...new Set([...durations, service.duration ?? 60])].sort((a, b) => a - b);
    show(id ? 'Редактировать услугу' : 'Новая услуга', `
      ${textField('name', 'Название', service.name ?? 'Массаж', 'required')}
      ${select('duration', 'Длительность', availableDurations.map(value => [value, `${value} мин`]), service.duration ?? 60)}
      ${fields(moneyField('price', 'Разовый массаж, £', service.price), moneyField('passPrice', 'Абонемент 5 + 1, £', service.passPrice))}
      <div>${button('Рассчитать как 5 разовых', 'calculate')}</div>
      <label class="checkbox"><input type="checkbox" name="active" ${service.active !== false ? 'checked' : ''}>Доступна для записи</label>
      ${formActions()}`, {
      actions: {
        calculate() {
          const form = element.querySelector('form');
          form.elements.passPrice.value = (pence(form.elements.price.value) * 5 / 100).toFixed(2);
        },
      },
      async submit(data) {
        const name = data.get('name').trim();
        if (!name) throw new Error('Введите название услуги.');
        await save(store => saveRecord(store.services, id, {
          name, duration: Number(data.get('duration')), price: pence(data.get('price')),
          passPrice: pence(data.get('passPrice')), active: data.has('active'),
        }));
        close();
        notify('Услуга сохранена');
      },
    });
  }

  function needServices() {
    show('Добавьте услугу', '<p>Для записи или абонемента нужна хотя бы одна доступная услуга.</p>' +
      `<div class="dialog-actions">${button('Открыть настройки', 'open-settings', { style: 'primary' })}</div>`, {
      actions: { 'open-settings': () => { close(); navigate('settings'); } },
    });
  }

  function passForm(clientId) {
    const store = getStore();
    const services = serviceOptions(store);
    if (!services.length) return needServices();
    const priceFor = service => service.passPrice || service.price * 5;
    show('Новый абонемент', `<p>5 оплаченных массажей + 1 бесплатно</p>
      ${select('service', 'Услуга', services.map(service => [service.id, serviceLabel(service)]), services[0].id)}
      ${fields(textField('date', 'Дата покупки', today(), 'type="date" required'),
      moneyField('price', 'Полная стоимость, £', priceFor(services[0])))}
      ${select('payment', 'Способ оплаты', Object.entries(payments), 'cash')}${formActions()}`, {
      async submit(data) {
        await save(current => {
          requireRecord(current.clients, clientId);
          const service = requireRecord(serviceOptions(current), data.get('service'));
          current.passes.push({
            id: newId(), clientId, service: service.name, duration: service.duration, date: data.get('date'),
            price: pence(data.get('price')), payment: data.get('payment'), total: passSessions, cancelled: false,
          });
        });
        close();
        notify('Абонемент добавлен');
      },
    });
    const form = element.querySelector('form');
    form.elements.service.addEventListener('change', () => {
      form.elements.price.value = (priceFor(requireRecord(services, form.elements.service.value)) / 100).toFixed(2);
    });
  }

  function billingControls(form, store, client, initialPassId = '') {
    const kindInput = form.elements.billing;
    const passInput = form.elements.pass;
    const priceInput = form.elements.price;
    const paymentInput = form.elements.payment;
    const singleSection = form.querySelector('[data-billing="single"]');
    const passSection = form.querySelector('[data-billing="pass"]');

    function synchronize() {
      const kind = kindInput.value;
      singleSection.hidden = kind !== 'single';
      priceInput.disabled = singleSection.hidden;
      if (paymentInput) paymentInput.disabled = singleSection.hidden;
      passSection.hidden = kind !== 'pass';
      passInput.disabled = passSection.hidden;
      const passes = activePasses(store, client());
      const value = passInput.value || initialPassId;
      const current = passes.some(item => item.id === value) ? value : passes[0]?.id;
      passInput.innerHTML = options(passes.map(pass => [pass.id,
        `${serviceLabel(pass)} · осталось ${remaining(store, pass)}`]), current,
      passes.length ? 'Выберите абонемент' : 'Нет активных абонементов');
    }

    kindInput.addEventListener('change', synchronize);
    form.elements.client?.addEventListener('change', synchronize);
    synchronize();
  }

  function appointmentForm(day, initialClient) {
    const store = getStore();
    if (!store.clients.length) {
      show('Новая запись', '<p>Добавьте клиента, чтобы создать запись на массаж.</p>' +
        `<div class="dialog-actions">${button('Добавить клиента', 'first-client', { style: 'primary', glyph: 'plus' })}</div>`, {
        actions: { 'first-client': () => clientForm(null, id => appointmentForm(day, id)) },
      });
      return;
    }
    const services = serviceOptions(store);
    if (!services.length) return needServices();
    const clients = [...store.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const start = defaultStart(day);
    show('Новая запись', `
      ${select('client', 'Клиент', clients.map(client => [client.id, client.name]), initialClient, 'Выберите клиента')}
      ${fields(textField('date', 'Дата', start.slice(0, 10), 'type="date" required'),
      textField('time', 'Начало', start.slice(11), 'type="time" required'))}
      ${fields(select('service', 'Услуга', services.map(service => [service.id, serviceLabel(service)]), services[0].id),
      select('preparation', 'Подготовка после сеанса', [[0, 'Без перерыва'], [15, '15 минут'], [30, '30 минут']], 0))}
      ${select('billing', 'Расчёт', Object.entries(billingKinds), 'single')}
      <div data-billing="single">${moneyField('price', 'Цена, £', services[0].price)}</div>
      <div data-billing="pass" hidden>${select('pass', 'Абонемент', [], '')}</div>
      ${area('before', 'Заметка перед сеансом')}
      <div class="conflict" hidden><strong>Время пересекается</strong><p>В расписании уже есть запись в это время.</p>
        <button class="button secondary" type="submit" value="override">Всё равно сохранить</button></div>
      ${formActions()}`, {
      async submit(data, trigger) {
        const saved = await save(current => {
          const client = requireRecord(current.clients, data.get('client'));
          const service = requireRecord(serviceOptions(current), data.get('service'));
          const billing = data.get('billing');
          const passId = billing === 'pass' ? data.get('pass') : null;
          if (passId && !activePasses(current, client.id).some(pass => pass.id === passId)) {
            throw new Error('У клиента нет доступных посещений по этому абонементу.');
          }
          const date = new Date(data.get('date') + 'T' + data.get('time'));
          if (!Number.isFinite(date.valueOf())) throw new Error('Проверьте дату и время записи.');
          const item = {
            id: newId(), clientId: client.id, service: service.name, duration: service.duration,
            preparation: Number(data.get('preparation')), start: date.toISOString(), status: 'planned',
            billing, price: billing === 'single' ? pence(data.get('price')) : 0, payment: null, passId,
            before: data.get('before').trim(), notes: '', oils: '', deduct: false,
          };
          if (trigger?.value !== 'override' && findOverlap(current, item)) return false;
          current.appointments.push(item);
          return true;
        });
        if (!saved) {
          const warning = element.querySelector('.conflict');
          warning.hidden = false;
          warning.querySelector('button').focus();
          return;
        }
        close();
        notify('Запись добавлена');
      },
    });
    const form = element.querySelector('form');
    form.elements.service.addEventListener('change', () => {
      form.elements.price.value = (requireRecord(services, form.elements.service.value).price / 100).toFixed(2);
    });
    form.addEventListener('change', () => { form.querySelector('.conflict').hidden = true; });
    billingControls(form, store, () => form.elements.client.value);
  }

  function notesFrom(data) {
    return { notes: data.get('notes').trim(), oils: data.get('oils').trim() };
  }

  function appointmentDetail(id) {
    const store = getStore();
    const item = requireRecord(store.appointments, id);
    const linkedPass = store.passes.find(pass => pass.id === item.passId);
    const inProgress = item.status === 'planned';
    const details = [
      ['Клиент', clientName(store, item.clientId)],
      ['Дата', localDate(appointmentDay(item))],
      ['Время', `${formatTime(item.start)}–${endTime(item)}`],
      ['Услуга', serviceLabel(item)],
      ['Подготовка после сеанса', item.preparation ? `${item.preparation} мин` : ''],
      ['Расчёт', billingKinds[item.billing]],
      ['Сумма', item.billing === 'single' ? cash(item.price) : ''],
      ['Оплата', item.payment ? payments[item.payment] : ''],
      ['Абонемент', linkedPass ? `${serviceLabel(linkedPass)} · осталось ${remaining(store, linkedPass)} из ${linkedPass.total}` : ''],
      ['Перед сеансом', item.before],
    ];
    show('Запись', `<div>${statusBadge(item.status)}</div>${facts(details)}
      ${area('notes', 'Заметка после сеанса', item.notes)}
      ${area('oils', 'Использованные масла', item.oils, 2)}
      ${inProgress ? `<div class="actions">${button('Завершить сеанс', 'complete', { style: 'primary' })}
        ${button('Клиент не пришёл', 'no-show')}${button('Отменить запись', 'cancel-appointment')}</div>` : ''}
      <div class="dialog-actions spread">${button('Удалить запись', 'delete-appointment', { style: 'danger outline' })}
      <button class="button secondary" type="submit">Сохранить заметки</button></div>`, {
      async submit(data) {
        await save(current => Object.assign(requireRecord(current.appointments, id), notesFrom(data)));
        close();
        notify('Заметки сохранены');
      },
      actions: {
        complete: () => completeForm(item, notesFrom(new FormData(element.querySelector('form')))),
        'no-show': () => markForm(item, 'noShow', notesFrom(new FormData(element.querySelector('form')))),
        'cancel-appointment': () => markForm(item, 'cancel', notesFrom(new FormData(element.querySelector('form')))),
        'delete-appointment': () => confirm('Удалить запись?', 'Запись и её заметки будут удалены из журнала и финансов.', 'Удалить', async () => {
          await save(current => {
            requireRecord(current.appointments, id);
            current.appointments = current.appointments.filter(appointment => appointment.id !== id);
          });
          close();
          notify('Запись удалена');
        }),
      },
    });
  }

  function completeForm(item, notes) {
    const store = getStore();
    show('Завершить сеанс', `
      ${select('billing', 'Как рассчитан сеанс', Object.entries(billingKinds).filter(([kind]) => kind !== 'undecided'),
        item.billing === 'pass' ? 'pass' : 'single')}
      <div data-billing="single" class="field-grid">${moneyField('price', 'Сумма, £', item.price)}
      ${select('payment', 'Способ оплаты', Object.entries(payments), 'cash')}</div>
      <div data-billing="pass" hidden>${select('pass', 'Абонемент', [], '')}</div>
      ${area('notes', 'Заметка после сеанса', notes.notes)}${area('oils', 'Использованные масла', notes.oils, 2)}
      ${formActions('Завершить сеанс')}`, {
      async submit(data) {
        await save(current => {
          const appointment = requireRecord(current.appointments, item.id);
          finishAppointment(current, appointment, {
            ...notesFrom(data), billing: data.get('billing'), passId: data.get('pass'),
            price: pence(data.get('price')), payment: data.get('payment'),
          });
        });
        close();
        notify('Сеанс завершён');
      },
    });
    billingControls(element.querySelector('form'), store, () => item.clientId, item.passId);
  }

  function markForm(item, mode, notes) {
    const noShow = mode === 'noShow';
    const hasPass = item.billing === 'pass';
    const choices = noShow
      ? [['noShow', hasPass ? 'Не списывать посещение' : 'Отметить без оплаты'], ...(hasPass ? [['deduct', 'Списать посещение']] : [])]
      : [['cancelledByClient', statuses.cancelledByClient], ['cancelledByTherapist', statuses.cancelledByTherapist]];
    show(noShow ? 'Клиент не пришёл' : 'Отменить запись', `
      ${select('result', noShow ? 'Что сделать' : 'Кто отменил', choices, '', 'Выберите вариант')}${formActions('Подтвердить')}`, {
      async submit(data) {
        const result = data.get('result');
        await save(current => {
          const appointment = requireRecord(current.appointments, item.id);
          markAppointment(current, appointment, noShow ? 'noShow' : result, result === 'deduct');
          Object.assign(appointment, notes);
        });
        close();
        notify(noShow ? 'Неявка отмечена' : 'Запись отменена');
      },
    });
  }

  function clientDeletion(id) {
    const client = requireRecord(getStore().clients, id);
    confirm('Удалить клиента?', `${client.name}: карточка, записи, абонементы и их оплаты будут удалены.`, 'Удалить', async () => {
      await save(store => deleteClient(store, id));
      navigate('clients');
      close();
      notify('Клиент удалён');
    });
  }

  return { appointmentDetail, appointmentForm, clientDeletion, clientForm, confirm, close, passForm, serviceForm };
}
