const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3210);
const TOKEN = process.env.ACCESS_TOKEN || '';
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR || path.join(__dirname, 'configs'));
const TRUST_PROXY = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';

if (TRUST_PROXY) {
  app.set('trust proxy', true);
}

const FILE_MAP = {
  mihomo: process.env.MIHOMO_FILE || 'mihomo.yaml',
  stash: process.env.STASH_FILE || 'stash.yaml',
  surge: process.env.SURGE_FILE || 'surge.conf',
};

const CONTENT_TYPES = {
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.conf': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safeResolve(baseDir, relativeFile) {
  const resolved = path.resolve(baseDir, relativeFile);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

function getRequestToken(req) {
  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return String(req.query.token || '');
}

function requireToken(req, res, next) {
  if (!TOKEN) {
    return res.status(500).json({ error: 'ACCESS_TOKEN is not configured' });
  }

  const provided = getRequestToken(req);
  if (!provided) {
    return res.status(401).json({ error: 'missing token' });
  }
  if (provided !== TOKEN) {
    return res.status(403).json({ error: 'invalid token' });
  }
  next();
}

function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function sendConfig(res, profile, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'application/octet-stream';
  const download = ['1', 'true', 'yes'].includes(String(res.req.query.download || '').toLowerCase());

  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('ETag', `W/\"${stat.size}-${Number(stat.mtimeMs)}\"`);
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename=\"${path.basename(filePath)}\"`);
  }

  fs.createReadStream(filePath).pipe(res);
  console.log(`[serve] profile=${profile} ip=${res.req.ip} file=${filePath}`);
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true, configDir: CONFIG_DIR, profiles: Object.keys(FILE_MAP) });
});

app.get(['/config/:profile', '/sub/:profile'], requireToken, (req, res) => {
  const profile = String(req.params.profile || '').toLowerCase();
  const relativeFile = FILE_MAP[profile];

  if (!relativeFile) {
    return res.status(404).json({ error: 'unknown profile' });
  }

  let filePath;
  try {
    filePath = safeResolve(CONFIG_DIR, relativeFile);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const stat = statSafe(filePath);
  if (!stat || !stat.isFile()) {
    return res.status(404).json({ error: 'config file not found' });
  }

  const ifNoneMatch = req.get('if-none-match');
  const currentEtag = `W/\"${stat.size}-${Number(stat.mtimeMs)}\"`;
  if (ifNoneMatch && ifNoneMatch === currentEtag) {
    return res.status(304).end();
  }

  const ifModifiedSince = req.get('if-modified-since');
  if (ifModifiedSince) {
    const since = new Date(ifModifiedSince);
    if (!Number.isNaN(since.getTime()) && stat.mtime <= since) {
      return res.status(304).end();
    }
  }

  sendConfig(res, profile, filePath, stat);
});

app.get('/', (req, res) => {
  res.type('text/plain; charset=utf-8').send([
    'sub-config-server',
    '',
    'Available endpoints:',
    '  GET /healthz',
    '  GET /config/mihomo?token=YOUR_TOKEN',
    '  GET /config/stash?token=YOUR_TOKEN',
    '  GET /config/surge?token=YOUR_TOKEN',
    '  GET /sub/:profile?token=YOUR_TOKEN',
    '',
    'Authorization header is also supported:',
    '  Authorization: Bearer YOUR_TOKEN',
  ].join('\n'));
});

app.listen(PORT, () => {
  console.log(`sub-config-server listening on :${PORT}`);
  console.log(`config dir: ${CONFIG_DIR}`);
  console.log(`profiles: ${Object.entries(FILE_MAP).map(([k, v]) => `${k}=>${v}`).join(', ')}`);
});
