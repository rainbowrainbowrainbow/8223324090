'use strict';

// Operator-run Windows controller. GitHub credentials and the archive signing
// private key stay on the host; guests receive one-job JIT configuration only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { verifyAndExtract, flushFile } = require('./ci-local-evidence.cjs');
const REPOSITORY = 'rainbowrainbowrainbow/8223324090';
const BRANCH = 'codex/ci-local-runner-20261027';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(value, message) { if (!value) throw new Error(message); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function writeJSON(file, value) {
  const temporary = `${file}.tmp`;
  const handle = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(handle, JSON.stringify(value)); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  fs.renameSync(temporary, file);
}
function command(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 ** 2, timeout: 120000 });
  // Do not echo command arguments, stdin or captured API bodies on failure.
  check(result.status === 0 && !result.error, `${path.basename(program)} operation failed`);
  return result.stdout;
}
function api(endpoint, body, method) {
  const args = ['api', `repos/${REPOSITORY}/${endpoint}`];
  if (method) args.push('--method', method);
  if (body) args.push('--input', '-');
  const response = command('gh', args, body ? JSON.stringify(body) : undefined);
  return response.trim() ? JSON.parse(response) : null;
}
function assertRun(run, config) {
  check(run.head_sha === config.sha && run.head_branch === BRANCH && run.event === 'push'
    && run.path === '.github/workflows/ci.yml' && run.repository?.full_name === REPOSITORY, 'GitHub run source identity mismatch');
}
function assertAcceptsJobs(run, config) {
  assertRun(run, config);
  check(run.run_attempt === config.attempt && ['queued', 'in_progress'].includes(run.status)
    && !run.conclusion, 'Workflow no longer accepts this attempt');
}
function assertDiskSpace(stats) {
  check(Number.isFinite(stats.bavail * stats.bsize) && stats.bavail * stats.bsize >= 10 * 1024 ** 3,
    'Less than 10 GiB available for disposable job and verified archives');
}
function assertWindow(config, now = Date.now()) {
  const deadline = Date.parse(config.deadlineUtc);
  check(Number.isFinite(deadline) && now < deadline, 'Authorization window expired');
}
function labelForJob(name) {
  const names = {
    'Fast baseline': 'fast-baseline',
    'Omni browser regression': 'omni-browser',
    'HR Team browser smoke': 'hr-team-browser',
    'My Day browser interactions': 'my-day-browser',
    'Certificate redemption regression': 'certificate-regression',
    'HR and payroll PostgreSQL integration': 'hr-payroll-postgres',
    'My Day PostgreSQL integration': 'my-day-postgres',
    'Checkbox park PostgreSQL mock integration': 'checkbox-park-postgres'
  };
  if (/^Education [a-zA-Z]+ \((chromium|webkit)\)$/.test(name)) return 'education-regressions';
  check(names[name], `Unrecognized CI job name: ${name}`);
  return names[name];
}
function findRegisteredJob(jobs, runnerId, runnerName, status) {
  return jobs.find(job => job.runner_id === runnerId && job.runner_name === runnerName
    && (!status || job.status === status));
}
async function control(config, operation) {
  if (!['stop', 'status'].includes(operation)) assertWindow(config);
  const id = crypto.randomUUID();
  writeJSON(path.join(config.root, 'control', 'request.json'), { id, operation });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const reply = readJSON(path.join(config.root, 'control', 'reply.json'));
      if (reply.id === id) { check(reply.status === 'OK', 'Exact-VM control failed'); return reply; }
    } catch (error) { if (!['ENOENT'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
    await sleep(1000);
  }
  throw new Error('Exact-VM control timed out');
}
function sshArgs(config) {
  check(/^\d{1,3}(\.\d{1,3}){3}$/.test(config.ip), 'Invalid guest IPv4');
  return ['-F', 'none', '-i', path.join(config.root, 'keys', 'operator_ed25519'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${path.join(config.root, 'known_hosts')}`, `cioperator@${config.ip}`];
}
function ssh(config, script, input) { return command('ssh.exe', [...sshArgs(config), script], input); }
async function waitGuest(config) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const status = await control(config, 'status');
    const address = status.addresses.find(value => /^\d{1,3}(\.\d{1,3}){3}$/.test(value) && !value.startsWith('169.254.'));
    if (address) {
      config.ip = address;
      try { if (ssh(config, 'test -f /opt/eventgenix-ci/archive-public.pem && docker info >/dev/null && echo READY').trim() === 'READY') return; } catch { /* boot is still progressing */ }
    }
    await sleep(3000);
  }
  throw new Error('Disposable guest did not become ready');
}
async function collect(config, runnerName, runnerId) {
  const ready = ssh(config, "find /var/lib/eventgenix-ci-evidence -mindepth 2 -maxdepth 2 -name ready -type f -printf '%h\\n'").trim().split(/\r?\n/).filter(Boolean);
  for (const remote of ready) {
    check(/^\/var\/lib\/eventgenix-ci-evidence\/[a-f0-9-]{36}$/.test(remote), 'Invalid evidence request directory');
    const requestId = path.posix.basename(remote);
    const destination = path.join(config.archiveRoot, `${config.run}-${config.attempt}`, requestId);
    const receiptPath = path.join(destination, 'host-receipt.json');
    if (fs.existsSync(receiptPath)) continue;
    const request = JSON.parse(ssh(config, `cat ${remote}/request.json`));
    const m = request.metadata;
    check(m.repository === REPOSITORY && m.sha === config.sha && m.ref === `refs/heads/${BRANCH}`
      && m.run === String(config.run) && m.attempt === String(config.attempt), 'Evidence request source mismatch');
    check(/^[\w.-]{1,249}$/.test(m.artifact) && /^[a-f0-9]{64}$/.test(request.bundleSHA256)
      && /^[a-f0-9]{64}$/.test(request.manifestSHA256), 'Invalid archive request');
    const jobs = api(`actions/runs/${config.run}/jobs?filter=latest&per_page=100`).jobs;
    const job = findRegisteredJob(jobs, runnerId, runnerName, 'in_progress');
    check(job && labelForJob(job.name) === m.job, 'Evidence does not belong to the active GitHub job');
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    const bundle = path.join(destination, 'evidence.jsonl.gz');
    const baseSSH = sshArgs(config);
    const target = baseSSH.pop();
    command('scp.exe', [...baseSSH, `${target}:${remote}/evidence.jsonl.gz`, bundle]);
    const result = await verifyAndExtract(bundle, path.join(destination, 'original-files'), request);
    flushFile(bundle);
    const payload = { metadata: m, githubJobId: job.id, runner: runnerName, bundleSHA256: request.bundleSHA256,
      manifestSHA256: request.manifestSHA256, files: result.files.length, bytes: result.bytes, archivedUtc: new Date().toISOString() };
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), fs.readFileSync(path.join(config.root, 'keys', 'archive-signing-private.pem'))).toString('base64');
    const receipt = { payload, signature };
    writeJSON(receiptPath, receipt);
    assertWindow(config);
    ssh(config, `cat > ${remote}/host-receipt.tmp && mv ${remote}/host-receipt.tmp ${remote}/host-receipt.json`, JSON.stringify(receipt));
    console.log(JSON.stringify({ stage: 'ARCHIVE_VERIFIED', job: job.name, files: result.files.length, bytes: result.bytes }));
  }
}
async function runOne(config, queuedJob) {
  const label = labelForJob(queuedJob.name);
  const runnerName = `EventGenix-CI-${config.run}-${queuedJob.id}`;
  let runnerId, process;
  try {
    assertAcceptsJobs(api(`actions/runs/${config.run}`), config);
    assertDiskSpace(fs.statfsSync(config.archiveRoot));
    await control(config, 'reset');
    await waitGuest(config);
    assertWindow(config);
    assertAcceptsJobs(api(`actions/runs/${config.run}`), config);
    const allowed = { sha: config.sha, ref: `refs/heads/${BRANCH}`, repository: REPOSITORY, workflowRef: `${REPOSITORY}/.github/workflows/ci.yml@refs/heads/${BRANCH}`, run: config.run, attempt: config.attempt };
    ssh(config, 'sudo tee /opt/eventgenix-ci/allowed.json >/dev/null', JSON.stringify(allowed));
    assertWindow(config);
    const registration = api('actions/runners/generate-jitconfig', { name: runnerName, runner_group_id: 1, labels: ['self-hosted', 'linux', 'x64', 'eventgenix-ci', label], work_folder: '_work' }, 'POST');
    runnerId = registration.runner.id;
    writeJSON(path.join(config.root, 'active-runner.json'), { runnerId, runnerName, run: config.run, sha: config.sha });
    assertWindow(config);
    const log = fs.openSync(path.join(config.root, `${runnerName}.log`), 'a', 0o600);
    try {
      process = spawn('ssh.exe', [...sshArgs(config), 'cd /opt/actions-runner && export ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/eventgenix-ci/job-started.sh && export ACTIONS_RUNNER_INPUT_JITCONFIG="$(cat)" && exec ./run.sh'], { stdio: ['pipe', log, log], windowsHide: true });
    } finally { fs.closeSync(log); }
    let done = false, processError;
    process.stdin.on('error', error => { processError = error; });
    process.on('exit', () => { done = true; });
    process.on('error', error => { processError = error; done = true; });
    process.stdin.end(registration.encoded_jit_config);
    console.log(JSON.stringify({ stage: 'JOB_STARTED', label, runner: runnerName }));
    let nextRunCheck = 0;
    while (!done) {
      assertWindow(config);
      if (Date.now() >= nextRunCheck) {
        const current = api(`actions/runs/${config.run}`);
        assertRun(current, config);
        check(current.run_attempt === config.attempt && (!current.conclusion || current.conclusion === 'success'),
          'Workflow cancelled, failed or superseded during execution');
        nextRunCheck = Date.now() + 15000;
      }
      await collect(config, runnerName, runnerId);
      await sleep(3000);
    }
    check(!processError, 'Runner transport failed');
    let job;
    for (let attempt = 0; attempt < 10; attempt++) {
      job = findRegisteredJob(api(`actions/runs/${config.run}/jobs?filter=latest&per_page=100`).jobs, runnerId, runnerName);
      if (job?.status === 'completed') break;
      await sleep(2000);
    }
    check(job?.status === 'completed' && job.conclusion === 'success', 'CI job did not pass; stop before wider execution');
    console.log(JSON.stringify({ stage: 'JOB_PASSED', job: job.name, githubJobId: job.id }));
    return job;
  } catch (error) {
    console.error(`Original job failure: ${error.code || 'ERROR'}: ${error.message}`);
    try {
      writeJSON(path.join(config.root, `${runnerName}-failure.json`), { run: config.run, sha: config.sha,
        message: error.message, code: error.code || null, timestampUtc: new Date().toISOString() });
    } catch { console.error('Failure receipt could not be persisted; cancellation and retirement still required.'); }
    if (runnerId && process) {
      try {
        const active = api(`actions/runs/${config.run}`);
        assertRun(active, config);
        check(active.run_attempt === config.attempt, 'Cancellation attempt identity mismatch');
        if (active.status !== 'completed') api(`actions/runs/${config.run}/force-cancel`, {}, 'POST');
        // Let the connected one-job listener acknowledge cancellation before
        // powering it off; an offline busy registration cannot be deleted.
        const end = Date.now() + 30000;
        while (process.exitCode === null && process.signalCode === null && Date.now() < end) await sleep(1000);
      } catch { console.error('Failed job cancellation requires retirement verification.'); }
    }
    throw error;
  } finally {
    if (process && process.exitCode === null && process.signalCode === null) process.kill();
    try { await control(config, 'stop'); } finally {
      if (runnerId) {
        let retired = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          try { api(`actions/runners/${runnerId}`, null, 'DELETE'); retired = true; break; } catch {
            const remaining = api('actions/runners?per_page=100').runners;
            if (!remaining.some(value => value.id === runnerId)) { retired = true; break; }
          }
          await sleep(2000);
        }
        check(retired, 'Created runner registration cleanup not confirmed');
      }
    }
  }
}
async function main(file) {
  const config = readJSON(file);
  check(config.branch === BRANCH && /^[a-f0-9]{40}$/.test(config.sha) && /^\d+$/.test(String(config.run)), 'Invalid approved source configuration');
  assertWindow(config);
  const run = api(`actions/runs/${config.run}`); assertRun(run, config);
  config.attempt = run.run_attempt;
  fs.mkdirSync(config.archiveRoot, { recursive: true, mode: 0o700 });
  const jobs = api(`actions/runs/${config.run}/jobs?filter=latest&per_page=100`).jobs;
  const pilot = jobs.find(job => job.name === 'Certificate redemption regression');
  check(pilot, 'Disposable PostgreSQL/browser pilot is absent');
  if (pilot.status === 'queued') {
    await runOne(config, pilot);
    writeJSON(path.join(config.root, 'pilot-receipt.json'), { sha: config.sha, run: config.run, attempt: config.attempt, status: 'PILOT_PASSED', completedUtc: new Date().toISOString() });
  } else {
    const proof = readJSON(path.join(config.root, 'pilot-receipt.json'));
    check(pilot.conclusion === 'success' && proof.status === 'PILOT_PASSED' && proof.sha === config.sha
      && proof.run === config.run && proof.attempt === config.attempt, 'Pilot proof does not match this attempt');
  }
  if (config.pilotOnly !== false) return;
  while (true) {
    assertWindow(config);
    const latest = api(`actions/runs/${config.run}`); assertRun(latest, config);
    const all = api(`actions/runs/${config.run}/jobs?filter=latest&per_page=100`).jobs;
    check(!all.some(job => job.status === 'completed' && job.conclusion !== 'success'), 'A required job failed');
    const queued = all.find(job => job.status === 'queued');
    if (!queued) { check(all.length === 23 && all.every(job => job.conclusion === 'success'), 'Required CI job inventory incomplete'); break; }
    assertAcceptsJobs(latest, config);
    await runOne(config, queued);
  }
  console.log(JSON.stringify({ stage: 'ALL_REQUIRED_JOBS_PASSED', run: config.run, sha: config.sha }));
}
module.exports = { assertRun, assertAcceptsJobs, assertDiskSpace, assertWindow, labelForJob, findRegisteredJob };
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
