export const statuses = {
  planned: 'Запланирован',
  completed: 'Завершён',
  cancelledByClient: 'Отменён клиентом',
  cancelledByTherapist: 'Отменён массажистом',
  noShow: 'Клиент не пришёл',
};

export const billingKinds = {
  single: 'Разовый массаж',
  pass: 'По абонементу',
  undecided: 'Решить позже',
};

export const payments = { cash: 'Наличные', bankTransfer: 'Банковский перевод' };
export const durations = [30, 45, 60, 90, 120];
export const passSessions = 6;
export const newId = () => crypto.randomUUID();

export function blankStore() {
  return {
    version: 1,
    clients: [],
    appointments: [],
    passes: [],
    services: durations.map(duration => ({
      id: newId(), name: 'Массаж', duration, price: 0, passPrice: 0, active: true,
    })),
  };
}

export function dateKey(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [String(date.getFullYear()).padStart(4, '0'), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

export const dateAt = key => new Date(key + 'T12:00:00');
export const today = () => dateKey();
export const monthOf = key => key.slice(0, 7);

export function shiftDays(key, amount) {
  const date = dateAt(key);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function shiftMonth(key, amount) {
  const date = dateAt(key);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return dateKey(date);
}

export function mondayOf(key) {
  return shiftDays(key, -((dateAt(key).getDay() + 6) % 7));
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP',
});

export const cash = amount => currencyFormatter.format(amount / 100);

export function pence(value) {
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Проверьте сумму оплаты.');
  return amount;
}

export const clientName = (store, id) => store.clients.find(client => client.id === id)?.name ?? 'Клиент удалён';
export const appointmentDay = appointment => dateKey(new Date(appointment.start));

export function findOverlap(store, appointment) {
  const start = Date.parse(appointment.start);
  const end = start + (appointment.duration + appointment.preparation) * 60_000;
  return store.appointments.find(other => {
    if (other.status !== 'planned' || other.id === appointment.id) return false;
    const otherStart = Date.parse(other.start);
    const otherEnd = otherStart + (other.duration + other.preparation) * 60_000;
    return start < otherEnd && end > otherStart;
  });
}

export function usedSessions(store, pass) {
  return store.appointments.filter(appointment => appointment.passId === pass.id
    && (appointment.status === 'completed' || (appointment.status === 'noShow' && appointment.deduct))).length;
}

export const remaining = (store, pass) => Math.max(0, pass.total - usedSessions(store, pass));
export const activePasses = (store, clientId) => store.passes.filter(pass => pass.clientId === clientId
  && !pass.cancelled && remaining(store, pass) > 0);

export function finishAppointment(store, appointment, update) {
  if (appointment.status !== 'planned') throw new Error('Статус записи уже изменился.');
  if (update.billing === 'pass' && !activePasses(store, appointment.clientId).some(pass => pass.id === update.passId)) {
    throw new Error('Выберите абонемент с оставшимися посещениями.');
  }
  Object.assign(appointment, {
    billing: update.billing,
    price: update.billing === 'single' ? update.price : 0,
    payment: update.billing === 'single' ? update.payment : null,
    passId: update.billing === 'pass' ? update.passId : null,
    notes: update.notes,
    oils: update.oils,
    status: 'completed',
  });
}

export function markAppointment(store, appointment, status, deduct = false) {
  if (appointment.status !== 'planned') throw new Error('Статус записи уже изменился.');
  if (deduct && !activePasses(store, appointment.clientId).some(pass => pass.id === appointment.passId)) {
    throw new Error('В абонементе нет доступных посещений.');
  }
  appointment.status = status;
  appointment.deduct = deduct;
}

export function deleteClient(store, id) {
  store.clients = store.clients.filter(client => client.id !== id);
  store.appointments = store.appointments.filter(appointment => appointment.clientId !== id);
  store.passes = store.passes.filter(pass => pass.clientId !== id);
}

export function incomeFor(store, month) {
  const sessions = store.appointments.filter(item => item.status === 'completed' && item.billing === 'single'
    && item.payment).map(item => ({
    id: item.id, clientId: item.clientId, date: appointmentDay(item),
    service: item.service, amount: item.price, payment: item.payment,
  }));
  const passes = store.passes.map(item => ({
    id: item.id, clientId: item.clientId, date: item.date,
    service: `Абонемент · ${item.service} · ${item.duration} мин`, amount: item.price, payment: item.payment,
  }));
  return [...sessions, ...passes].filter(item => monthOf(item.date) === month)
    .sort((left, right) => right.date.localeCompare(left.date));
}

const string = value => typeof value === 'string';
const name = value => string(value) && value.trim() !== '';
const int = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => int(value) && value > 0;
const flag = value => typeof value === 'boolean';
const isoDay = value => string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(dateAt(value)) === value;
const isoTime = value => string(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const oneOf = values => value => string(value) && Object.hasOwn(values, value);
const nullable = check => value => value === null || check(value);

const schema = {
  clients: {
    id: name, name, phone: string, birthday: nullable(isoDay),
    allergies: string, contraindications: string, preferences: string, notes: string,
  },
  services: { id: name, name, duration: positive, price: int, passPrice: int, active: flag },
  passes: {
    id: name, clientId: name, service: name, duration: positive, date: isoDay, price: int,
    payment: oneOf(payments), total: positive, cancelled: flag,
  },
  appointments: {
    id: name, clientId: name, start: isoTime, duration: positive, preparation: int,
    service: name, status: oneOf(statuses), billing: oneOf(billingKinds), price: int,
    payment: nullable(oneOf(payments)), passId: nullable(name), before: string, notes: string, oils: string, deduct: flag,
  },
};

export function parseBackup(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Не удалось прочитать JSON.');
  }
  if (parsed?.version !== 1) throw new Error('Версия резервной копии не поддерживается.');
  const store = { version: 1 };
  for (const [collection, fields] of Object.entries(schema)) {
    const records = parsed[collection];
    if (!Array.isArray(records)) throw new Error('В резервной копии отсутствуют данные.');
    const ids = new Set();
    store[collection] = records.map(record => {
      if (!record || Object.entries(fields).some(([key, check]) => !check(record[key])) || ids.has(record.id)) {
        throw new Error('В резервной копии есть некорректные записи.');
      }
      ids.add(record.id);
      return Object.fromEntries(Object.keys(fields).map(key => [key, record[key]]));
    });
  }
  const clients = new Set(store.clients.map(client => client.id));
  const passOwners = new Map(store.passes.map(pass => [pass.id, pass.clientId]));
  if (store.passes.some(pass => !clients.has(pass.clientId))
    || store.appointments.some(item => !clients.has(item.clientId)
      || (item.billing === 'pass' ? passOwners.get(item.passId) !== item.clientId : item.passId !== null)
      || (item.status === 'completed' && (item.billing === 'undecided'
        || (item.billing === 'single' && item.payment === null))))) {
    throw new Error('В резервной копии нарушены связи между записями.');
  }
  return store;
}
