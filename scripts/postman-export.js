// Exports the Postman Native Git YAML collection (postman/collections/...) as a single
// Postman v2.1 JSON file that can be imported into any workspace (Postman → Import).
//
// Usage: npm run postman:export [-- <collectionDir> <outFile>]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const collectionDir = path.resolve(
  root,
  process.argv[2] || 'postman/collections/Social Inbox Automation API',
);
const outFile = path.resolve(
  root,
  process.argv[3] ||
    'postman-export/social-inbox-automation-api.postman_collection.json',
);

const load = (file) => yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
const lines = (code) => String(code ?? '').split(/\r?\n/);
const relative = (p) => path.relative(root, p).split(path.sep).join('/');

/** Stable ids from the file path, so re-importing updates the collection instead of duplicating it. */
const uuid = (seed) => {
  const h = crypto.createHash('sha1').update(relative(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const convertAuth = (auth) => {
  const a = Array.isArray(auth) ? auth[0] : auth;
  if (!a) return undefined;
  if (a.type === 'noauth') return { type: 'noauth' };
  if (a.type === 'bearer') {
    return {
      type: 'bearer',
      bearer: [
        { key: 'token', value: a.credentials?.token ?? '', type: 'string' },
      ],
    };
  }
  throw new Error(`Unsupported auth type: ${a.type}`);
};

const SCRIPT_EVENTS = { beforeRequest: 'prerequest', afterResponse: 'test' };

const convertEvents = (scripts = []) =>
  scripts.map((s) => {
    const listen = SCRIPT_EVENTS[s.type];
    if (!listen) throw new Error(`Unsupported script type: ${s.type}`);
    return {
      listen,
      script: { type: s.language || 'text/javascript', exec: lines(s.code) },
    };
  });

const convertUrl = (rawUrl, queryParams, pathVariables) => {
  const [base, queryString] = String(rawUrl).split('?');
  const [host, ...pathParts] = base.split('/');

  let query;
  if (queryParams?.length) {
    query = queryParams.map((q) => ({
      key: q.key,
      value: q.value ?? '',
      ...(q.description && { description: q.description }),
      ...(q.disabled && { disabled: true }),
    }));
  } else if (queryString) {
    query = queryString.split('&').map((pair) => {
      const [key, value = ''] = pair.split('=');
      return { key, value };
    });
  }

  const enabled = (query ?? []).filter((q) => !q.disabled);
  const raw =
    base +
    (enabled.length
      ? '?' + enabled.map((q) => `${q.key}=${q.value}`).join('&')
      : '');

  return {
    raw,
    host: [host],
    path: pathParts,
    ...(query && { query }),
    ...(pathVariables && {
      variable: Object.entries(pathVariables).map(([key, value]) => ({
        key,
        value: String(value),
      })),
    }),
  };
};

const convertRequest = (file) => {
  const r = load(file);
  const name = r.name || path.basename(file).replace(/\.request\.yaml$/, '');
  const header = Object.entries(r.headers ?? {}).map(([key, value]) => ({
    key,
    value: String(value),
    type: 'text',
  }));

  let body;
  if (r.body) {
    if (r.body.type !== 'json') {
      throw new Error(`Unsupported body type "${r.body.type}" in ${file}`);
    }
    body = {
      mode: 'raw',
      raw: r.body.content ?? '',
      options: { raw: { language: 'json' } },
    };
  }

  const auth = convertAuth(r.auth);
  const event = convertEvents(r.scripts);

  return {
    order: r.order ?? 0,
    item: {
      id: uuid(file),
      name,
      ...(event.length && { event }),
      request: {
        ...(auth && { auth }),
        method: r.method,
        header,
        ...(body && { body }),
        url: convertUrl(r.url, r.queryParams, r.pathVariables),
        ...(r.description && { description: r.description }),
      },
      response: [],
    },
  };
};

const convertFolder = (dir) => {
  const def = load(path.join(dir, '.resources', 'definition.yaml'));
  const children = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '.resources') {
      children.push(convertFolder(full));
    } else if (entry.isFile() && entry.name.endsWith('.request.yaml')) {
      children.push(convertRequest(full));
    }
  }
  children.sort(
    (a, b) => a.order - b.order || a.item.name.localeCompare(b.item.name),
  );

  const auth = convertAuth(def.auth);
  const event = convertEvents(def.scripts);
  return {
    order: def.order ?? 0,
    def,
    item: {
      id: uuid(dir),
      name: def.name || path.basename(dir),
      ...(def.description && { description: def.description }),
      item: children.map((c) => c.item),
      ...(auth && { auth }),
      ...(event.length && { event }),
    },
  };
};

const { def, item: rootItem } = convertFolder(collectionDir);

const collection = {
  info: {
    _postman_id: uuid(collectionDir),
    name: rootItem.name,
    ...(rootItem.description && { description: rootItem.description }),
    schema:
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: rootItem.item,
  ...(rootItem.auth && { auth: rootItem.auth }),
  ...(rootItem.event && { event: rootItem.event }),
  variable: Object.entries(def.variables ?? {}).map(([key, value]) => ({
    key,
    value: String(value ?? ''),
    type: 'string',
  })),
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(collection, null, 2) + '\n');

const count = (items) =>
  items.reduce((n, i) => n + (i.item ? count(i.item) : 1), 0);
console.log(
  `Wrote ${relative(outFile)}: ${collection.item.length} folders, ` +
    `${count(collection.item)} requests, ${collection.variable.length} variables`,
);
