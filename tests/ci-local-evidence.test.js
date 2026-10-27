'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBundle, verifyAndExtract, collectFiles, safePath, verifyAcknowledgement, flushFile } = require('../scripts/ci-local-evidence.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eventgenix-evidence-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'output', 'ci-example'), { recursive: true });
  await fs.writeFile(path.join(root, 'output', 'ci-example', 'proof.json'), '{"actualApp":true}\n');
  await fs.writeFile(path.join(root, 'output', 'ci-example', 'screenshot.png'), crypto.randomBytes(150000));
  await fs.writeFile(path.join(root, 'output', 'ci-example', '.hidden'), 'excluded as with upload-artifact');
  return root;
}
const metadata = { repository: 'rainbowrainbowrainbow/8223324090', sha: 'a'.repeat(40), ref: 'refs/heads/codex/example', run: '42', attempt: '1', job: 'education-regressions', artifact: 'education-example-chromium' };

test('round-trips original JSON and binary bytes with independent file/manifest verification', async t => {
  const root = await fixture(t);
  const bundle = path.join(root, 'evidence.gz');
  const expected = await createBundle(root, ['output/ci-*'], metadata, bundle);
  assert.equal(expected.files.length, 2);
  const destination = path.join(root, 'private-archive');
  const result = await verifyAndExtract(bundle, destination, expected);
  assert.equal(result.files.length, 2);
  for (const file of expected.files) {
    assert.deepEqual(await fs.readFile(path.join(destination, file.path)), await fs.readFile(path.join(root, file.path)));
  }
  await assert.rejects(fs.stat(path.join(destination, 'output', 'ci-example', '.hidden')), { code: 'ENOENT' });
});

test('required missing evidence fails; explicit existing warn/ignore policies remain visible', async t => {
  const root = await fixture(t);
  await assert.rejects(collectFiles(root, ['output/missing'], 'error'), /Required evidence/);
  assert.deepEqual(await collectFiles(root, ['output/missing'], 'warn'), []);
  assert.deepEqual(await collectFiles(root, ['output/missing'], 'ignore'), []);
  await assert.rejects(collectFiles(root, ['output/**/private']), /wildcard/);
});

test('flushes completed binary evidence on Windows without changing its bytes', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'output', 'ci-example', 'screenshot.png');
  const before = await fs.readFile(file);
  assert.doesNotThrow(() => flushFile(file));
  assert.deepEqual(await fs.readFile(file), before);
});

test('corrupted bundle, manifest or source identity cannot produce a verified archive', async t => {
  const root = await fixture(t);
  const bundle = path.join(root, 'evidence.gz');
  const expected = await createBundle(root, ['output/ci-example'], metadata, bundle);
  await assert.rejects(verifyAndExtract(bundle, path.join(root, 'wrong-source'), { ...expected, metadata: { ...metadata, sha: 'b'.repeat(40) } }), /identity mismatch/);
  await assert.rejects(verifyAndExtract(bundle, path.join(root, 'wrong-manifest'), { ...expected, manifestSHA256: '0'.repeat(64) }), /Manifest integrity/);
  await fs.appendFile(bundle, 'corruption');
  await assert.rejects(verifyAndExtract(bundle, path.join(root, 'corrupt'), expected), /Bundle SHA-256/);
});

test('rejects traversal, Windows ADS/device paths and evidence symlinks', async t => {
  for (const value of ['../private', '/absolute', 'output/../../secret', 'output\\secret', 'output/file:stream', 'output/NUL.txt', 'output/file.']) {
    assert.throws(() => safePath(value), /Unsafe/);
  }
  const root = await fixture(t);
  try {
    await fs.symlink(path.join(root, 'output', 'ci-example'), path.join(root, 'output', 'linked'), 'junction');
  } catch (error) { if (error.code === 'EPERM') { t.skip('Host cannot create test symlink'); return; } throw error; }
  await assert.rejects(collectFiles(root, ['output/linked']), /symlinks/);
});

test('invalid gzip integrity fails even when the transport digest matches the supplied bytes', async t => {
  const root = await fixture(t);
  const bundle = path.join(root, 'evidence.gz');
  const expected = await createBundle(root, ['output/ci-example'], metadata, bundle);
  const broken = await fs.readFile(bundle);
  broken[broken.length - 1] ^= 1;
  await fs.writeFile(bundle, broken);
  const forgedTransport = { ...expected, bundleSHA256: crypto.createHash('sha256').update(broken).digest('hex') };
  await assert.rejects(verifyAndExtract(bundle, path.join(root, 'bad-gzip'), forgedTransport));
});

test('only a host-signed receipt for the exact run, SHA and bundle is accepted', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const expected = { metadata, bundleSHA256: 'b'.repeat(64), manifestSHA256: 'c'.repeat(64) };
  const payload = { ...expected, archivedUtc: '2026-10-27T18:00:00Z' };
  const receipt = { payload, signature: crypto.sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64') };
  assert.equal(verifyAcknowledgement(receipt, expected, publicKey), payload);
  assert.throws(() => verifyAcknowledgement({ ...receipt, payload: { ...payload, archivedUtc: 'forged' } }, expected, publicKey), /signature/);
  assert.throws(() => verifyAcknowledgement(receipt, { ...expected, metadata: { ...metadata, attempt: '2' } }, publicKey), /identity/);
});
