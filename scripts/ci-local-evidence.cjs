'use strict';

// Lossless evidence transport. The host verifies every original byte before
// acknowledging the archive; a successful test alone is not an archive receipt.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const readline = require('node:readline');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const MAX_BYTES = 4 * 1024 ** 3;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
function check(condition, message) { if (!condition) throw new Error(message); }
function safePath(value) {
  check(typeof value === 'string' && value.length > 0 && value.length < 500, 'Invalid evidence path');
  check(!value.includes('\\') && !value.includes(':') && !path.posix.isAbsolute(value), 'Unsafe evidence path');
  check(value.split('/').every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f]/.test(part)
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)), 'Unsafe evidence path');
  return value;
}
async function collectFiles(root, patterns, missing = 'error') {
  check(['error', 'warn', 'ignore'].includes(missing), 'Invalid missing-file policy');
  const result = new Map();
  async function walk(relative) {
    safePath(relative);
    const absolute = path.join(root, relative);
    const stat = await fs.promises.lstat(absolute);
    check(!stat.isSymbolicLink(), 'Evidence symlinks are forbidden');
    if (stat.isDirectory()) {
      for (const entry of (await fs.promises.readdir(absolute)).sort()) {
        // Match upload-artifact's default exclusion of hidden files.
        if (!entry.startsWith('.')) await walk(`${relative}/${entry}`);
      }
    } else {
      check(stat.isFile(), 'Evidence must contain only regular files');
      const key = relative.toLowerCase();
      check(!result.has(key) || result.get(key).path === relative, 'Case-colliding evidence paths');
      result.set(key, { path: relative, size: stat.size });
    }
  }
  for (const pattern of patterns) {
    const wildcard = pattern.endsWith('*');
    const base = wildcard ? path.posix.dirname(pattern) : pattern;
    safePath(base);
    check(!base.includes('*') && !base.includes('?'), 'Only a final prefix wildcard is supported');
    try {
      if (wildcard) {
        const prefix = path.posix.basename(pattern).slice(0, -1);
        for (const entry of (await fs.promises.readdir(path.join(root, base))).sort()) {
          if (entry.startsWith(prefix) && !entry.startsWith('.')) await walk(`${base}/${entry}`);
        }
      } else await walk(pattern);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const files = [...result.values()].sort((a, b) => a.path.localeCompare(b.path));
  check(files.length || missing !== 'error', 'Required evidence files are missing');
  check(files.reduce((sum, file) => sum + file.size, 0) <= MAX_BYTES, 'Evidence exceeds 4 GiB safety limit');
  return files;
}
async function createBundle(root, patterns, metadata, output, missing = 'error') {
  const files = await collectFiles(root, patterns, missing);
  const manifest = [];
  async function* records() {
    yield `${json({ type: 'header', version: 1, metadata, emptyPolicy: missing })}\n`;
    for (const file of files) {
      yield `${json({ type: 'file', ...file })}\n`;
      const digest = crypto.createHash('sha256');
      let bytes = 0;
      for await (const chunk of fs.createReadStream(path.join(root, file.path), { highWaterMark: 65536 })) {
        bytes += chunk.length; digest.update(chunk);
        check(bytes <= file.size, 'Evidence changed while archiving');
        yield `${json({ type: 'data', value: chunk.toString('base64') })}\n`;
      }
      check(bytes === file.size, 'Evidence changed while archiving');
      const item = { ...file, sha256: digest.digest('hex') };
      manifest.push(item);
      yield `${json({ type: 'endFile', ...item })}\n`;
    }
    yield `${json({ type: 'end', count: files.length, manifestSHA256: hash(json(manifest)) })}\n`;
  }
  await pipeline(Readable.from(records()), zlib.createGzip({ level: 1 }), fs.createWriteStream(output, { flags: 'wx', mode: 0o600 }));
  const bundleSHA256 = await fileHash(output);
  return { metadata, bundleSHA256, manifestSHA256: hash(json(manifest)), files: manifest, bytes: manifest.reduce((n, item) => n + item.size, 0) };
}
async function fileHash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function verifyAndExtract(bundle, destination, expected) {
  check(await fileHash(bundle) === expected.bundleSHA256, 'Bundle SHA-256 mismatch');
  await fs.promises.mkdir(destination, { recursive: false, mode: 0o700 });
  const input = fs.createReadStream(bundle);
  const decoder = zlib.createGunzip();
  const lines = readline.createInterface({ input: decoder, crlfDelay: Infinity });
  let streamError;
  input.on('error', error => decoder.destroy(error));
  decoder.on('error', error => { streamError = error; lines.close(); });
  input.pipe(decoder);
  let header, current, handle, ended = false, total = 0;
  const files = [], seen = new Set();
  try {
    for await (const line of lines) {
      check(line.length < 100000, 'Oversized evidence record');
      check(!ended, 'Trailing evidence records');
      const record = JSON.parse(line);
      if (!header) {
        check(record.type === 'header' && record.version === 1, 'Invalid evidence header');
        check(json(record.metadata) === json(expected.metadata), 'Evidence identity mismatch');
        header = record; continue;
      }
      if (record.type === 'file') {
        check(!current, 'Nested evidence file');
        safePath(record.path);
        check(!seen.has(record.path.toLowerCase()), 'Duplicate evidence path');
        seen.add(record.path.toLowerCase());
        check(Number.isSafeInteger(record.size) && record.size >= 0 && record.size <= MAX_BYTES, 'Invalid evidence size');
        const target = path.join(destination, record.path);
        await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        handle = await fs.promises.open(target, 'wx', 0o600);
        current = { path: record.path, size: record.size, bytes: 0, digest: crypto.createHash('sha256') };
      } else if (record.type === 'data') {
        check(current && typeof record.value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.value), 'Invalid evidence data');
        const bytes = Buffer.from(record.value, 'base64');
        current.bytes += bytes.length; total += bytes.length;
        check(current.bytes <= current.size && total <= MAX_BYTES, 'Evidence size overflow');
        current.digest.update(bytes); await handle.writeFile(bytes);
      } else if (record.type === 'endFile') {
        check(current && current.bytes === current.size, 'Truncated evidence file');
        const item = { path: current.path, size: current.size, sha256: current.digest.digest('hex') };
        check(json(item) === json({ path: record.path, size: record.size, sha256: record.sha256 }), 'File integrity mismatch');
        await handle.sync(); await handle.close(); handle = null; current = null; files.push(item);
      } else if (record.type === 'end') {
        check(!current && record.count === files.length, 'Incomplete evidence bundle');
        check(record.manifestSHA256 === hash(json(files)) && record.manifestSHA256 === expected.manifestSHA256, 'Manifest integrity mismatch');
        check(files.length || ['warn', 'ignore'].includes(header.emptyPolicy), 'Missing required evidence');
        ended = true;
      } else throw new Error('Unknown evidence record');
    }
    if (streamError) throw streamError;
    check(header && ended && !current, 'Truncated evidence bundle');
    await fs.promises.writeFile(path.join(destination, 'verified-manifest.json'), json({ ...expected, files, bytes: total }), { flag: 'wx', mode: 0o600 });
    return { files, bytes: total };
  } finally { if (handle) await handle.close(); lines.close(); input.destroy(); decoder.destroy(); }
}
function verifyAcknowledgement(receipt, expected, publicKey) {
  check(receipt && receipt.payload && typeof receipt.signature === 'string', 'Missing signed archive receipt');
  check(crypto.verify(null, Buffer.from(json(receipt.payload)), publicKey, Buffer.from(receipt.signature, 'base64')), 'Invalid host archive signature');
  check(json(receipt.payload.metadata) === json(expected.metadata)
    && receipt.payload.bundleSHA256 === expected.bundleSHA256
    && receipt.payload.manifestSHA256 === expected.manifestSHA256, 'Archive receipt identity mismatch');
  return receipt.payload;
}
async function preserve() {
  check(process.env.RUNNER_ENVIRONMENT === 'self-hosted' && process.env.GITHUB_EVENT_NAME === 'push', 'Local evidence is trusted-push only');
  const metadata = { repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB, artifact: process.env.EVIDENCE_NAME };
  check(metadata.repository === 'rainbowrainbowrainbow/8223324090' && /^[a-f0-9]{40}$/.test(metadata.sha || ''), 'Invalid repository/SHA');
  check(Object.values(metadata).every(value => typeof value === 'string' && value.length > 0 && value.length < 250), 'Incomplete evidence identity');
  check(/^[\w.-]+$/.test(metadata.artifact), 'Invalid artifact name');
  const spool = '/var/lib/eventgenix-ci-evidence';
  const request = path.join(spool, crypto.randomUUID());
  await fs.promises.mkdir(request, { mode: 0o700 });
  const result = await createBundle(process.cwd(), process.env.EVIDENCE_PATHS.split(/\r?\n/).map(value => value.trim()).filter(Boolean), metadata, path.join(request, 'evidence.jsonl.gz'), process.env.EVIDENCE_MISSING || 'warn');
  if (!result.files.length && process.env.EVIDENCE_MISSING !== 'ignore') console.log('::warning::No files matched the configured evidence paths.');
  await fs.promises.writeFile(path.join(request, 'request.json'), json(result), { flag: 'wx', mode: 0o600 });
  await fs.promises.writeFile(path.join(request, 'ready'), '', { flag: 'wx' });
  const publicKey = await fs.promises.readFile('/opt/eventgenix-ci/archive-public.pem');
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    try {
      const receipt = JSON.parse(await fs.promises.readFile(path.join(request, 'host-receipt.json'), 'utf8'));
      verifyAcknowledgement(receipt, result, publicKey);
      console.log(`Verified private host archive: ${metadata.artifact}; ${result.files.length} original files; ${result.bytes} bytes.`);
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Independent host archival receipt timed out');
}
module.exports = { safePath, collectFiles, createBundle, verifyAndExtract, verifyAcknowledgement, fileHash };
if (require.main === module) preserve().catch(error => { console.error(error.message); process.exitCode = 1; });
