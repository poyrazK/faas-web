import { spawn } from 'node:child_process';

const scripts = process.argv.slice(2);
if (scripts.length === 0) {
  console.error('Usage: node scripts/run-parallel.mjs <npm-script> [<npm-script>...]');
  process.exit(1);
}

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runScript(script) {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const child = spawn(npmBin, ['run', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => {
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      resolve({ script, code: 1, elapsed, output: Buffer.concat(chunks).toString('utf8') + `\n${error}` });
    });
    child.on('close', (code) => {
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      resolve({
        script,
        code: code ?? 1,
        elapsed,
        output: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });
}

const results = await Promise.all(scripts.map(runScript));
let failed = false;

for (const { script, code, elapsed, output } of results) {
  if (code === 0) {
    console.log(`✓ ${script} (${elapsed}s)`);
    if (output.trim()) process.stdout.write(output);
  } else {
    failed = true;
    console.error(`✗ ${script} (exit ${code}, ${elapsed}s)`);
    if (output.trim()) process.stderr.write(output);
  }
}

process.exit(failed ? 1 : 0);
