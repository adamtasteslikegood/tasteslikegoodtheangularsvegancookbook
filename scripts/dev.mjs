import { spawn } from 'node:child_process';

const angular = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
  stdio: 'inherit',
  env: process.env,
});
const express = spawn(process.execPath, ['server/dist/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: '8080' },
});

const children = [angular, express];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (stopping) return;
    process.exitCode = code ?? (signal ? 1 : 0);
    stop();
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
