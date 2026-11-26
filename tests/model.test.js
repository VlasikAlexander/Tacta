import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePasses, blankStore, deleteClient, findOverlap, finishAppointment, incomeFor, markAppointment,
  mondayOf, parseBackup, pence, remaining, shiftDays, shiftMonth,
} from '../web/model.js';

const client = id => ({
  id, name: 'Клиент', phone: '', birthday: null, allergies: '', contraindications: '', preferences: '', notes: '',
});
const visit = (id, extra = {}) => ({
  id, clientId: 'client', start: '2026-10-14T12:00:00.000Z', duration: 60, preparation: 15, service: 'Массаж',
  status: 'planned', billing: 'pass', passId: 'pass', price: 0, payment: null, before: '', notes: '', oils: '', deduct: false,
  ...extra,
});
const pass = {
  id: 'pass', clientId: 'client', service: 'Массаж', duration: 60, date: '2026-10-10',
  price: 25_000, payment: 'bankTransfer', total: 6, cancelled: false,
};

function fixture() {
  const store = blankStore();
  store.clients = [client('client'), client('other')];
  store.passes = [{ ...pass }];
  return store;
}

test('предупреждение учитывает время подготовки и только запланированные записи', () => {
  const store = fixture();
  const booked = visit('booked');
  store.appointments.push(booked);
  const overlapping = visit('next', { start: '2026-10-14T13:14:00.000Z' });
  assert.equal(findOverlap(store, overlapping), booked);
  assert.equal(findOverlap(store, visit('boundary', { start: '2026-10-14T13:15:00.000Z' })), undefined);
  markAppointment(store, booked, 'cancelledByClient');
  assert.equal(findOverlap(store, overlapping), undefined);
});

test('абонемент списывает завершения и выбранные неявки, ограничивая остаток', () => {
  const store = fixture();
  const appointments = Array.from({ length: 8 }, (_, index) => visit('visit-' + index));
  store.appointments.push(...appointments);
  for (const item of appointments.slice(0, 5)) {
    finishAppointment(store, item, { billing: 'pass', passId: pass.id, notes: '', oils: '' });
  }
  markAppointment(store, appointments[5], 'noShow', false);
  assert.equal(remaining(store, pass), 1);
  markAppointment(store, appointments[6], 'noShow', true);
  assert.equal(remaining(store, pass), 0);
  assert.deepEqual(activePasses(store, 'client'), []);
  assert.throws(() => finishAppointment(store, appointments[7], { billing: 'pass', passId: pass.id }), /оставшимися/);
  assert.throws(() => markAppointment(store, appointments[7], 'noShow', true), /нет доступных/);
  assert.equal(appointments[7].status, 'planned');
});

test('доход включает покупку абонемента и только оплаченный разовый сеанс', () => {
  const store = fixture();
  const single = visit('single', { billing: 'undecided', passId: null });
  const included = visit('included');
  const noShow = visit('absent', { billing: 'single', passId: null, price: 8_000 });
  store.appointments.push(single, included, noShow);
  finishAppointment(store, single, { billing: 'single', price: pence('70.13'), payment: 'cash', notes: '', oils: 'Миндаль' });
  finishAppointment(store, included, { billing: 'pass', passId: pass.id, notes: '', oils: '' });
  markAppointment(store, noShow, 'noShow');
  assert.deepEqual(incomeFor(store, '2026-10').map(item => [item.id, item.amount, item.payment]), [
    ['single', 7_013, 'cash'], ['pass', 25_000, 'bankTransfer'],
  ]);
  assert.deepEqual(incomeFor(store, '2026-11'), []);
  assert.equal(single.oils, 'Миндаль');
  assert.equal(single.passId, null);
});

test('копия сохраняет состояние и проверяет версии, данные и связи', () => {
  const store = fixture();
  store.appointments.push(visit('a'));
  assert.deepEqual(parseBackup(JSON.stringify(store)), store);
  assert.throws(() => parseBackup('{broken'), /JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ ...store, version: 2 })), /Версия/);
  store.appointments[0].clientId = 'other';
  assert.throws(() => parseBackup(JSON.stringify(store)), /связи/);
  store.appointments[0].clientId = 'client';
  store.appointments.push(visit('a'));
  assert.throws(() => parseBackup(JSON.stringify(store)), /некорректные/);
});

test('удаление клиента каскадно удаляет его записи и абонементы', () => {
  const store = fixture();
  const item = visit('other-visit', { clientId: 'other', billing: 'single', passId: null });
  store.appointments.push(visit('a'), item);
  deleteClient(store, 'client');
  assert.deepEqual(store.clients, [client('other')]);
  assert.deepEqual(store.appointments, [item]);
  assert.deepEqual(store.passes, []);
});

test('переходы календаря учитывают начало недели, конец месяца и високосный год', () => {
  assert.equal(mondayOf('2026-11-01'), '2026-10-26');
  assert.equal(shiftDays('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-01');
  assert.equal(shiftMonth('2026-01-01', -1), '2025-12-01');
});
