import { compareVersions, createDrive, DriveError, driveScope, fingerprint } from './drive.js';
import { button, h } from './views.js';

export const validClientId = value => typeof value === 'string' && /^[\w-]+\.apps\.googleusercontent\.com$/.test(value);
const delays = { upload: 2400, check: 30_000 };
const messages = {
  unlinked: 'Этот браузер ещё не связан с выбранным Google Drive. Сохраните свои записи или загрузите имеющуюся копию.',
  'other-account': 'Выбран другой аккаунт. Проверьте адрес перед переносом записей.',
  current: 'Локальные записи совпадают с текущей копией на Google Drive.',
  pending: 'Изменения сохранены в браузере. Выгрузка на Google Drive ожидается.',
  missing: 'На выбранном Google Drive нет копий Tacta. Локальные записи доступны.',
  remote: 'На Google Drive есть другая версия. Выберите копию для загрузки.',
  conflict: 'У копий разошлась история. Выберите версию, которую хотите использовать. Другие версии останутся в истории.',
};

const dateLabel = value => new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

export function createDriveSync({ getLocal, commitLocal, confirm, download, notify, setIndicator }) {
  let clientId = '';
  let ready = false;
  let initialized = false;
  let connecting = false;
  let session;
  let graph;
  let selected = '';
  let comparison = '';
  let status = '';
  let busy = false;
  let generation = 0;
  let uploadTimer;
  let expirationTimer;
  let retryTimer;
  const dialogOpen = () => !!document.querySelector('#dialog')?.open;

  function paint() {
    const panel = document.querySelector('#drive-settings');
    const indicator = comparison === 'pending' ? 'Google Drive: ожидает выгрузки'
      : comparison === 'conflict' ? 'Google Drive: есть разные версии' : '';
    setIndicator(indicator);
    if (!panel) return;
    const local = getLocal();
    const account = session?.account.email;
    const headIds = new Set(graph?.heads.map(item => item.id));
    const versions = graph?.history.map((item, index) => {
      const label = dateLabel(item.createdTime) + (headIds.has(item.id)
        ? ' · текущая ветвь' : ' · история') + ' · ' + item.id.slice(0, 6);
      return `<option value="${item.id}"${selected === item.id || (!selected && !index) ? ' selected' : ''}>${h(label)}</option>`;
    }).join('');
    const recoveries = local.recovery.map((entry, index) =>
      `<option value="${index}">${h(dateLabel(entry.date))} · клиентов: ${entry.payload.clients.length}, записей: ${entry.payload.appointments.length}</option>`).join('');
    panel.innerHTML = `<div class="drive-content">
      <p class="muted">Клиенты, записи, абонементы и оплаты сохраняются в скрытой папке приложения на выбранном Google Drive.</p>
      ${account ? `<p>Подключён ${h(account)}</p>` : ''}
      <p class="drive-status" role="status">${h(status || (session ? messages[comparison] : 'Локальное хранение активно.'))}</p>
      ${graph?.heads.length > 1 && comparison !== 'conflict' ? `<p class="muted">${messages.conflict}</p>` : ''}
      <div class="actions">
        ${!session ? button('Подключить Google Drive', 'drive-connect', { style: 'primary', disabled: !ready || connecting }) :
          button('Выбрать другой аккаунт', 'drive-connect', { disabled: busy || connecting })}
        ${session ? button('Отключить', 'drive-disconnect') : ''}
      </div>
      ${session ? `<div class="actions">
        ${button('Сохранить в Drive сейчас', 'drive-save', { style: 'primary', disabled: busy || !graph || (!local.initialized && !!versions) })}
        ${button('Обновить список', 'drive-refresh', { disabled: busy })}
      </div>` : ''}
      ${versions && account ? `<div class="drive-versions">
        <label class="field"><span>Копии на Google Drive</span><select id="drive-version">${versions}</select></label>
        <div class="actions">
          ${button('Загрузить выбранную копию', 'drive-restore', { disabled: busy })}
          ${button('Скачать как JSON', 'drive-download', { disabled: busy })}
        </div>
      </div>` : ''}
      ${recoveries ? `<div class="drive-versions">
        <label class="field"><span>Локальные копии перед заменой</span><select id="drive-recovery">${recoveries}</select></label>
        <div>${button('Скачать локальную копию', 'drive-recover')}</div>
      </div>` : ''}
      ${session ? '<p class="muted">Перед закрытием можно сохранить копию вручную и дождаться статуса сохранения.</p>' : ''}
    </div>`;
  }

  function expire(message = 'Google Drive отключён. Новые записи сохраняются в браузере.') {
    generation++;
    session = null;
    graph = null;
    comparison = '';
    selected = '';
    busy = false;
    connecting = false;
    status = message;
    clearTimeout(uploadTimer);
    clearTimeout(expirationTimer);
    clearTimeout(retryTimer);
    paint();
  }

  async function settingOpened() {
    paint();
    if (initialized) return;
    initialized = true;
    status = 'Проверяем настройки Google Drive…';
    paint();
    try {
      const response = await fetch('./drive-config.json', { cache: 'no-store' });
      const config = await response.json();
      if (!response.ok || !validClientId(config.clientId)) {
        status = 'Google Drive пока не настроен. Записи сохраняются в этом браузере.';
        return;
      }
      clientId = config.clientId;
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
      ready = !!globalThis.google?.accounts?.oauth2?.initTokenClient;
      status = ready ? '' : 'Не удалось запустить вход Google. Обновите страницу, чтобы попробовать ещё раз.';
    } catch {
      status = 'Не удалось подготовить Google Drive. Локальные записи доступны.';
    } finally {
      paint();
    }
  }

  async function acceptToken(token, attempt) {
    if (generation !== attempt) return;
    const scopes = token?.scope?.split(' ') ?? [];
    if (token?.error || !token?.access_token || !scopes.includes(driveScope)) {
      expire('Google не предоставил доступ к папке Tacta. Локальные записи доступны.');
      return;
    }
    try {
      const api = createDrive(token.access_token);
      const account = await api.account();
      if (generation !== attempt) return;
      const interval = Number(token.expires_in) * 1000;
      if (!Number.isFinite(interval) || interval <= 0) throw new DriveError('Google не подтвердил срок доступа. Подключитесь снова.');
      session = { account, api };
      connecting = false;
      expirationTimer = setTimeout(() => expire('Доступ к Google Drive истёк. Подключитесь снова.'), interval);
      await refresh();
    } catch (error) {
      if (generation === attempt && !session) expire(error.message);
      else if (generation === attempt) fail(error);
    }
  }

  function connect() {
    if (!ready || connecting) return;
    expire('Открываем окно Google…');
    const attempt = generation;
    connecting = true;
    try {
      const oauth = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: driveScope,
        include_granted_scopes: false,
        callback: token => { acceptToken(token, attempt); },
        error_callback: failure => {
          if (attempt !== generation) return;
          expire(failure.type === 'popup_failed_to_open'
            ? 'Разрешите всплывающие окна для входа в Google.'
            : 'Подключение Google Drive отменено. Локальные записи доступны.');
        },
      });
      oauth.requestAccessToken({ prompt: 'select_account' });
    } catch {
      expire('Не удалось открыть окно Google. Попробуйте ещё раз.');
    }
    paint();
  }

  function fail(error) {
    if (error.status === 401) expire(error.message);
    else {
      status = error.message || 'Не удалось синхронизировать. Локальные записи доступны.';
      paint();
    }
  }

  async function inspect(current) {
    const device = getLocal();
    if (device.unavailable) throw new DriveError('Локальное хранилище недоступно. Сначала восстановите данные в настройках.');
    const hash = await fingerprint(device.payload);
    const latest = await current.api.list();
    return {
      device, hash, graph: latest,
      comparison: compareVersions(latest, device.binding, hash, current.account.id, clientId),
    };
  }

  function setGraph(snapshot) {
    graph = snapshot.graph;
    comparison = snapshot.comparison;
    if (!graph.byId.has(selected)) selected = graph.heads[0]?.id ?? '';
  }

  async function job(working, task, interactive = false) {
    if (!session || busy) {
      if (interactive) throw new DriveError('Подключитесь к Google Drive или дождитесь окончания синхронизации.');
      return;
    }
    const current = session;
    busy = true;
    status = working;
    paint();
    try {
      await task(current, () => current === session);
    } catch (error) {
      if (current === session) fail(error);
      if (interactive) throw error;
    } finally {
      if (current === session) {
        busy = false;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (document.visibilityState === 'visible' && !dialogOpen()) refresh();
        }, delays.check);
        paint();
      }
    }
  }

  function refresh() {
    return job('Проверяем версии на Google Drive…', async (current, valid) => {
      const snapshot = await inspect(current);
      if (!valid()) return;
      setGraph(snapshot);
      status = '';
      if (comparison === 'pending') changed();
    });
  }

  function binding(current, snapshot, hash) {
    return { clientId, accountId: current.account.id, snapshot, hash };
  }

  const headKey = latest => latest.heads.map(item => item.id).sort().join(',');
  const stale = () => new DriveError('Копии или локальные записи изменились. Обновите список и повторите действие.');

  async function publish(current, snapshot, valid, parents) {
    const { device, graph: latest, hash } = snapshot;
    if (!valid()) return;
    const id = await current.api.write(device.payload, parents, latest);
    if (!valid()) return;
    await commitLocal(device.revision, { binding: binding(current, id, hash) }, valid);
    if (!valid()) return;
    selected = id;
    const next = await inspect(current);
    if (!valid()) return;
    setGraph(next);
    status = comparison === 'current' ? 'Копия сохранена на Google Drive.' : '';
  }

  function save(manual = false) {
    return job('Проверяем данные перед сохранением…', async (current, valid) => {
      const snapshot = await inspect(current);
      if (!valid()) return;
      setGraph(snapshot);
      status = '';
      if (comparison === 'current') {
        if (manual) status = 'На Google Drive уже есть эта версия.';
        return;
      }
      if (comparison === 'pending') {
        status = 'Сохраняем копию на Google Drive…';
        paint();
        await publish(current, snapshot, valid, [snapshot.device.binding.snapshot]);
        return;
      }
      if (!manual) return;
      if (!snapshot.device.initialized && snapshot.graph.heads.length) {
        status = 'На Google Drive уже есть копии. Выберите версию для загрузки.';
        return;
      }
      confirm('Сохранить в Google Drive?', `Локальные клиенты, записи и оплаты будут отправлены в ${current.account.email}. Эта копия станет текущей. Предыдущие копии останутся в истории.`,
        'Сохранить', async () => {
          await job('Сохраняем копию на Google Drive…', async (again, stillValid) => {
            if (again !== current) throw stale();
            const latest = await inspect(again);
            if (!stillValid()) return;
            setGraph(latest);
            if (headKey(latest.graph) !== headKey(snapshot.graph)
              || latest.device.revision !== snapshot.device.revision) throw stale();
            await publish(again, latest, stillValid, latest.graph.heads.map(item => item.id));
          }, true);
        });
    });
  }

  function restore() {
    const id = selected;
    return job('Проверяем выбранную копию…', async (current, valid) => {
      const inspected = await inspect(current);
      if (!valid()) return;
      setGraph(inspected);
      const entry = inspected.graph.byId.get(id);
      if (!entry) throw stale();
      const payload = await current.api.read(entry);
      const hash = await fingerprint(payload);
      if (!valid()) return;
      status = '';
      confirm('Загрузить копию из Google Drive?', `Копия из ${current.account.email} от ${dateLabel(entry.createdTime)} заменит данные в этом браузере. Клиентов: ${payload.clients.length}, записей: ${payload.appointments.length}. Текущие записи при отличии останутся в локальной резервной копии.`,
        'Загрузить', async () => {
          await job('Восстанавливаем данные в этом браузере…', async (again, stillValid) => {
            if (again !== current) throw stale();
            const latest = await inspect(again);
            if (!stillValid()) return;
            setGraph(latest);
            if (headKey(latest.graph) !== headKey(inspected.graph)
              || latest.device.revision !== inspected.device.revision || !latest.graph.byId.has(id)) throw stale();
            await commitLocal(latest.device.revision, {
              payload, binding: binding(again, id, hash), preserve: latest.hash !== hash,
            }, stillValid);
            if (!stillValid()) return;
            selected = id;
            comparison = compareVersions(latest.graph, binding(again, id, hash), hash, again.account.id, clientId);
            status = 'Копия загружена в этот браузер.';
          }, true);
        });
    });
  }

  function downloadDrive() {
    const id = selected;
    return job('Проверяем копию для скачивания…', async (current, valid) => {
      const entry = graph?.byId.get(id);
      if (!entry) throw stale();
      const payload = await current.api.read(entry);
      if (!valid()) return;
      download(payload, 'tacta-drive-' + id.slice(0, 8));
      status = '';
    });
  }

  function changed() {
    clearTimeout(uploadTimer);
    if (!session) return;
    const device = getLocal();
    if (device.binding?.accountId !== session.account.id || device.binding.clientId !== clientId) return;
    uploadTimer = setTimeout(() => {
      if (busy || dialogOpen()) changed();
      else save();
    }, delays.upload);
    if (!busy && comparison !== 'conflict' && comparison !== 'remote') {
      comparison = 'pending';
      status = '';
      paint();
    }
  }

  const actions = {
    'drive-connect': connect,
    'drive-disconnect': () => expire(),
    'drive-refresh': refresh,
    'drive-save': () => save(true),
    'drive-restore': restore,
    'drive-download': downloadDrive,
    'drive-recover': () => {
      const index = document.querySelector('#drive-recovery')?.value;
      const entry = getLocal().recovery[index];
      if (entry) download(entry.payload, 'tacta-local-' + entry.date.slice(0, 10));
      else notify('Локальная копия больше недоступна.');
    },
  };

  document.addEventListener('change', event => {
    if (event.target.id === 'drive-version') selected = event.target.value;
  });
  document.addEventListener('visibilitychange', () => {
    if (session && document.visibilityState === 'visible' && !dialogOpen()) refresh();
  });

  return { actions, changed, paint, settingOpened };
}
