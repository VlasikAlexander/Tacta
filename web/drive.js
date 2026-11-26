import { parseBackup } from './model.js';

export const driveScope = 'https://www.googleapis.com/auth/drive.appdata';
const driveOrigin = 'https://www.googleapis.com';
const filePattern = /^tacta-v1-([a-f0-9]{64})\.json$/;
const snapshotId = /^[a-f0-9]{64}$/;

export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function parentIds(value) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !snapshotId.test(id))
    || new Set(value).size !== value.length) throw new DriveError('У копии на Google Drive повреждена история.');
  return [...value].sort();
}

export function makeGraph(files) {
  const byId = new Map();
  const referenced = new Set();
  for (const file of files) {
    const match = filePattern.exec(file.name);
    if (!match) continue;
    let parents;
    try {
      parents = parentIds(JSON.parse(file.description));
    } catch {
      throw new DriveError('Не удалось проверить историю копий на Google Drive.');
    }
    const id = match[1];
    const existing = byId.get(id);
    if (parents.includes(id) || (existing && JSON.stringify(existing.parents) !== JSON.stringify(parents))) {
      throw new DriveError('Не удалось проверить историю копий на Google Drive.');
    }
    parents.forEach(parent => referenced.add(parent));
    if (!existing) byId.set(id, { ...file, id, fileId: file.id, parents });
  }

  // Validate all branches, including cycles that would otherwise disappear from the head list.
  const children = new Map();
  const queue = [];
  const incoming = new Map();
  for (const item of byId.values()) {
    incoming.set(item.id, item.parents.length);
    if (!item.parents.length) queue.push(item.id);
    for (const parent of item.parents) {
      if (!byId.has(parent)) throw new DriveError('История копий загрузилась не полностью. Обновите список позже.');
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(item.id);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    for (const child of children.get(queue[index]) ?? []) {
      const count = incoming.get(child) - 1;
      incoming.set(child, count);
      if (count === 0) queue.push(child);
    }
  }
  if (queue.length !== byId.size) throw new DriveError('Не удалось проверить историю копий на Google Drive.');

  const history = [...byId.values()].sort((a, b) => b.createdTime.localeCompare(a.createdTime) || a.id.localeCompare(b.id));
  return { byId, history, heads: history.filter(item => !referenced.has(item.id)) };
}

export function compareVersions(graph, binding, localHash, accountId, clientId) {
  if (!binding || binding.clientId !== clientId) return 'unlinked';
  if (binding.accountId !== accountId) return 'other-account';
  if (graph.heads.length > 1) return 'conflict';
  if (!graph.heads.length) return 'missing';
  if (graph.heads[0].id === binding.snapshot) return binding.hash === localHash ? 'current' : 'pending';
  return binding.hash === localHash ? 'remote' : 'conflict';
}

export function createDrive(token, fetcher = fetch) {
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetcher(driveOrigin + path, {
        ...options,
        headers: { ...options.headers, Authorization: 'Bearer ' + token },
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new DriveError('Не удалось связаться с Google Drive. Локальные записи доступны.');
    }
    if (!response.ok) {
      const message = response.status === 401
        ? 'Доступ к Google Drive истёк. Подключитесь снова.'
        : 'Google Drive отклонил запрос. Проверьте доступ, подключение и свободное место.';
      throw new DriveError(message, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new DriveError('Ответ Google Drive не удалось прочитать.');
    }
  }

  async function account() {
    const { user } = await request('/drive/v3/about?fields=user(permissionId,emailAddress)');
    if (typeof user?.permissionId !== 'string' || typeof user.emailAddress !== 'string'
      || !user.permissionId || !user.emailAddress) throw new DriveError('Не удалось определить аккаунт Google Drive.');
    return { id: user.permissionId, email: user.emailAddress };
  }

  async function list() {
    const files = [];
    const seen = new Set();
    let pageToken;
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder', q: "name contains 'tacta-v1-'",
        fields: 'nextPageToken,incompleteSearch,files(id,name,description,createdTime)', pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await request('/drive/v3/files?' + params);
      if (page.incompleteSearch || !Array.isArray(page.files) || seen.has(page.nextPageToken)) {
        throw new DriveError('Google Drive вернул неполный список копий. Попробуйте позже.');
      }
      for (const file of page.files) {
        if (typeof file.id !== 'string' || typeof file.name !== 'string' || !Number.isFinite(Date.parse(file.createdTime))) {
          throw new DriveError('Google Drive вернул неполные сведения о копии.');
        }
        files.push(file);
      }
      pageToken = page.nextPageToken;
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return makeGraph(files);
  }

  async function read(entry) {
    const copy = await request('/drive/v3/files/' + encodeURIComponent(entry.fileId) + '?alt=media');
    const parents = parentIds(copy?.parents);
    if (copy.version !== 1 || JSON.stringify(parents) !== JSON.stringify(entry.parents)
      || await fingerprint({ version: 1, parents, payload: copy.payload }) !== entry.id) {
      throw new DriveError('Копия на Google Drive не прошла проверку целостности.');
    }
    return parseBackup(JSON.stringify(copy.payload));
  }

  async function write(payload, parents, graph) {
    const normalized = parentIds(parents);
    const copy = { version: 1, parents: normalized, payload: parseBackup(JSON.stringify(payload)) };
    const id = await fingerprint(copy);
    if (graph.byId.has(id)) {
      await read(graph.byId.get(id));
      return id;
    }
    const boundary = 'tacta-' + crypto.randomUUID();
    const metadata = {
      name: 'tacta-v1-' + id + '.json', description: JSON.stringify(normalized),
      mimeType: 'application/json', parents: ['appDataFolder'],
    };
    const body = ['--' + boundary, 'Content-Type: application/json; charset=UTF-8', '',
      JSON.stringify(metadata), '--' + boundary, 'Content-Type: application/json; charset=UTF-8', '',
      JSON.stringify(copy), '--' + boundary + '--', ''].join('\r\n');
    const file = await request('/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', body, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    });
    if (typeof file?.id !== 'string') throw new DriveError('Не удалось подтвердить сохранение на Google Drive.');
    return id;
  }

  return { account, list, read, write };
}
