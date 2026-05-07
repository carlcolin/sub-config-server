require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3210);
const HOST = String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
const TOKENS = parseTokens(process.env.ACCESS_TOKENS || process.env.ACCESS_TOKEN || '');
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR || path.join(__dirname, 'configs'));
const ROUTES_FILE = path.resolve(process.env.ROUTES_FILE || path.join(__dirname, 'routes.json'));
const TRUST_PROXY = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');

if (TRUST_PROXY) {
  app.set('trust proxy', true);
}

function parseTokens(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function jsonError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function formatProfiles(map) {
  return Object.entries(map).map(([k, v]) => `${k}=>${v}`).join(', ');
}

function loadFileMap() {
  let raw;
  try {
    raw = fs.readFileSync(ROUTES_FILE, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read routes file: ${ROUTES_FILE} (${error.message})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in routes file: ${ROUTES_FILE} (${error.message})`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('routes.json must be an object like {"mihomo":"mihomo.yaml"}');
  }

  const normalized = {};
  for (const [key, value] of Object.entries(parsed)) {
    const profile = String(key || '').trim().toLowerCase();
    const relativeFile = String(value || '').trim();
    if (!profile || !relativeFile) continue;
    normalized[profile] = relativeFile;
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error('routes.json does not contain any valid routes');
  }

  return normalized;
}

function safeResolve(baseDir, relativeFile) {
  const resolved = path.resolve(baseDir, relativeFile);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

function validateStartup() {
  if (TOKENS.size === 0) {
    throw new Error('ACCESS_TOKEN or ACCESS_TOKENS is required');
  }

  const configStat = fs.existsSync(CONFIG_DIR) ? fs.statSync(CONFIG_DIR) : null;
  if (!configStat || !configStat.isDirectory()) {
    throw new Error(`CONFIG_DIR does not exist or is not a directory: ${CONFIG_DIR}`);
  }

  const map = loadFileMap();
  for (const [profile, relativeFile] of Object.entries(map)) {
    const filePath = safeResolve(CONFIG_DIR, relativeFile);
    const stat = statSafe(filePath);
    if (!stat || !stat.isFile()) {
      throw new Error(`Config file for profile '${profile}' not found: ${filePath}`);
    }
  }

  return map;
}

let fileMap = validateStartup();
let lastRoutesError = null;

function getFileMap() {
  return fileMap;
}

function reloadFileMap(reason = 'manual') {
  try {
    const nextMap = loadFileMap();
    for (const [profile, relativeFile] of Object.entries(nextMap)) {
      const filePath = safeResolve(CONFIG_DIR, relativeFile);
      const stat = statSafe(filePath);
      if (!stat || !stat.isFile()) {
        throw new Error(`Config file for profile '${profile}' not found: ${filePath}`);
      }
    }

    fileMap = nextMap;
    lastRoutesError = null;
    console.log(`[routes] reloaded (${reason}): ${formatProfiles(fileMap)}`);
    return true;
  } catch (error) {
    lastRoutesError = error.message;
    console.error(`[routes] reload failed (${reason}): ${error.message}`);
    return false;
  }
}

try {
  fs.watch(ROUTES_FILE, { persistent: false }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      setTimeout(() => reloadFileMap(`fs.watch:${eventType}`), 50);
    }
  });
} catch (error) {
  lastRoutesError = `watch disabled: ${error.message}`;
  console.error(`[routes] watch disabled: ${error.message}`);
}

const CONTENT_TYPES = {
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.conf': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function getRequestToken(req) {
  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return String(req.query.token || '');
}

function getTokenFingerprint(token) {
  if (!token) return 'none';
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function getConfiguredTokenFingerprints() {
  return Array.from(TOKENS).map((token, index) => ({
    index: index + 1,
    fingerprint: getTokenFingerprint(token),
  }));
}

function logAuthFailure(req, status, code, detail = '') {
  const provided = getRequestToken(req);
  const fingerprint = provided ? getTokenFingerprint(provided) : 'none';
  const suffix = detail ? ` detail=${detail}` : '';
  console.warn(`[auth] ${status} code=${code} token=${fingerprint} ip=${req.ip} path=${req.originalUrl}${suffix}`);
}

function requireToken(req, res, next) {
  if (TOKENS.size === 0) {
    logAuthFailure(req, 500, 'TOKEN_NOT_CONFIGURED');
    return jsonError(res, 500, 'TOKEN_NOT_CONFIGURED', 'ACCESS_TOKEN or ACCESS_TOKENS is not configured');
  }

  const provided = getRequestToken(req);
  if (!provided) {
    logAuthFailure(req, 401, 'MISSING_TOKEN');
    return jsonError(res, 401, 'MISSING_TOKEN', 'missing token');
  }
  if (!TOKENS.has(provided)) {
    logAuthFailure(req, 403, 'INVALID_TOKEN');
    return jsonError(res, 403, 'INVALID_TOKEN', 'invalid token');
  }

  req.authTokenFingerprint = getTokenFingerprint(provided);
  next();
}

function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function buildMeta(req, profile, filePath, stat) {
  const download = ['1', 'true', 'yes'].includes(String(req.query.download || '').toLowerCase());
  const etag = `W/\"${stat.size}-${Number(stat.mtimeMs)}\"`;
  return {
    profile,
    filePath,
    download,
    ext: path.extname(filePath).toLowerCase(),
    type: CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    etag,
  };
}

function sendConfig(req, res, meta, stat) {
  res.setHeader('Content-Type', meta.type);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('ETag', meta.etag);
  res.setHeader('Vary', 'Authorization');
  if (meta.download) {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(meta.filePath)}"`);
  }

  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`[serve] ${res.statusCode} profile=${meta.profile} token=${req.authTokenFingerprint || 'none'} download=${meta.download} ip=${req.ip} file=${meta.filePath} bytes=${stat.size} cost=${Date.now() - startedAt}ms`);
  });

  fs.createReadStream(meta.filePath).pipe(res);
}

function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  return `${req.protocol}://${req.get('host') || `127.0.0.1:${PORT}`}`;
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/readyz', (req, res) => {
  res.json({
    ok: !lastRoutesError,
    configDir: CONFIG_DIR,
    routesFile: ROUTES_FILE,
    profiles: Object.keys(getFileMap()),
    routesError: lastRoutesError,
    publicBaseUrl: PUBLIC_BASE_URL || null,
    tokenMode: TOKENS.size > 1 ? 'multiple' : 'single',
  });
});

app.get('/profiles', requireToken, (req, res) => {
  const baseUrl = getBaseUrl(req);
  const profiles = Object.entries(getFileMap()).map(([name, file]) => ({
    name,
    file,
    subUrl: `${baseUrl}/sub/${name}?token=<ACCESS_TOKEN>`,
    configUrl: `${baseUrl}/config/${name}?token=<ACCESS_TOKEN>`,
  }));

  res.json({ profiles, count: profiles.length, tokenMode: TOKENS.size > 1 ? 'multiple' : 'single' });
});

app.get(['/config/:profile', '/sub/:profile'], requireToken, (req, res) => {
  const profile = String(req.params.profile || '').toLowerCase();
  const relativeFile = getFileMap()[profile];

  if (!relativeFile) {
    console.warn(`[request] 404 code=UNKNOWN_PROFILE profile=${profile} token=${req.authTokenFingerprint || 'none'} ip=${req.ip} path=${req.originalUrl}`);
    return jsonError(res, 404, 'UNKNOWN_PROFILE', 'unknown profile');
  }

  let filePath;
  try {
    filePath = safeResolve(CONFIG_DIR, relativeFile);
  } catch (error) {
    return jsonError(res, 400, 'INVALID_FILE_PATH', error.message);
  }

  const stat = statSafe(filePath);
  if (!stat || !stat.isFile()) {
    console.warn(`[request] 404 code=CONFIG_FILE_NOT_FOUND profile=${profile} token=${req.authTokenFingerprint || 'none'} ip=${req.ip} path=${req.originalUrl} file=${filePath}`);
    return jsonError(res, 404, 'CONFIG_FILE_NOT_FOUND', 'config file not found');
  }

  const meta = buildMeta(req, profile, filePath, stat);
  const ifNoneMatch = req.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === meta.etag) {
    return res.status(304).end();
  }

  const ifModifiedSince = req.get('if-modified-since');
  if (ifModifiedSince) {
    const since = new Date(ifModifiedSince);
    if (!Number.isNaN(since.getTime()) && stat.mtime <= since) {
      return res.status(304).end();
    }
  }

  sendConfig(req, res, meta, stat);
});

app.get('/', (req, res) => {
  res.type('text/plain; charset=utf-8').send([
    'sub-config-server',
    '',
    'Available endpoints:',
    '  GET /healthz',
    '  GET /readyz',
    '  GET /profiles?token=***',
    '  GET /config/:profile?token=***',
    '  GET /sub/:profile?token=***',
    '  routes are loaded from routes.json',
    '',
    'Authorization header is also supported:',
    '  Authorization: Bearer ***',
  ].join('\n'));
});

app.listen(PORT, HOST, () => {
  const profiles = Object.entries(getFileMap());
  const baseUrl = PUBLIC_BASE_URL || `http://${HOST}:${PORT}`;

  console.log(`sub-config-server listening on ${HOST}:${PORT}`);
  console.log(`config dir: ${CONFIG_DIR}`);
  console.log(`routes file: ${ROUTES_FILE}`);
  console.log(`public base url: ${PUBLIC_BASE_URL || '(not set)'}`);
  console.log(`token mode: ${TOKENS.size > 1 ? `multiple (${TOKENS.size})` : 'single'}`);
  console.log(`token fingerprints: ${getConfiguredTokenFingerprints().map((item) => `token[${item.index}]=${item.fingerprint}`).join(', ')}`);
  console.log(`profiles: ${formatProfiles(getFileMap())}`);
  console.log('example urls:');
  for (const [profile] of profiles) {
    console.log(`  ${baseUrl}/sub/${profile}?token=<ACCESS_TOKEN>`);
    console.log(`  ${baseUrl}/config/${profile}?token=<ACCESS_TOKEN>`);
  }
  console.log(`  ${baseUrl}/profiles?token=<ACCESS_TOKEN>`);
  console.log(`bearer example: curl -H 'Authorization: Bearer <ACCESS_TOKEN>' ${baseUrl}/config/${profiles[0]?.[0] || 'mihomo'}`);
});
