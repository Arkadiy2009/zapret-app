// Запуск системных команд без окон консоли
const { spawn } = require('child_process');

function run(cmd, args = [], { timeout = 30000, cwd, encoding = 'utf8', verbatim = false } = {}) {
  return new Promise(resolve => {
    let out = '', err = '', done = false;
    const child = spawn(cmd, args, { cwd, windowsHide: true, windowsVerbatimArguments: verbatim });
    const finish = code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err });
    };
    const timer = setTimeout(() => { child.kill(); finish(-1); }, timeout);
    child.stdout.on('data', d => { out += d.toString(encoding); });
    child.stderr.on('data', d => { err += d.toString(encoding); });
    child.on('error', e => { err += e.message; finish(-2); });
    child.on('close', code => finish(code));
  });
}

// Вывод sc и netsh зависит от языка Windows, кодовая страница 437 даёт английский
const cmd437 = (line, opts) => run('cmd.exe', ['/d', '/s', '/c', `"chcp 437 >nul & ${line}"`], { ...opts, verbatim: true });

function ps(script, opts) {
  const body = `[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';${script}`;
  const encoded = Buffer.from(body, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: 60000, ...opts });
}

module.exports = { run, cmd437, ps };
