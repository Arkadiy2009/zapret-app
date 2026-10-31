// Разбор general*.bat. Аргументы winws берём из самих файлов запрета,
// поэтому новые и изменённые способы подхватываются при обновлении без правки кода.
const fs = require('fs');
const path = require('path');

const natural = s => s.replace(/(\d+)/g, n => n.padStart(8, '0'));

function listBatFiles(coreDir) {
  return fs.readdirSync(coreDir)
    .filter(f => /\.bat$/i.test(f) && !/^service/i.test(f))
    .sort((a, b) => natural(a).localeCompare(natural(b)));
}

function tokenize(text) {
  const out = [];
  let cur = '', has = false, quoted = false;
  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; has = true; }
    else if (!quoted && /\s/.test(ch)) { if (has) out.push(cur); cur = ''; has = false; }
    else { cur += ch; has = true; }
  }
  if (has) out.push(cur);
  return out;
}

function parseBat(text, vars) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /winws\.exe/i.test(l));
  if (start < 0) throw new Error('В файле нет запуска winws.exe');
  const joined = lines.slice(start).map(l => l.replace(/\^\s*$/, '')).join(' ');
  const after = joined.slice(joined.search(/winws\.exe"/i) + 'winws.exe"'.length);
  const expanded = after
    .replace(/%(\w+)%/g, (m, name) => (name in vars ? vars[name] : m))
    .replace(/\^!/g, '!');
  const left = expanded.match(/%\w+%/);
  if (left) throw new Error(`Неизвестная переменная ${left[0]}`);
  return tokenize(expanded);
}

// Значения с путём в binPath службы идут в кавычках, как в service.bat
function toBinPath(exe, args) {
  const quote = a => {
    const m = a.match(/^(--[^=]+=)(.*)$/);
    return m && /[:\\ ]/.test(m[2]) ? `${m[1]}"${m[2]}"` : a;
  };
  return `"${exe}" ${args.map(quote).join(' ')}`;
}

function strategyName(file) {
  const base = file.replace(/\.bat$/i, '');
  const inner = (base.match(/\((.+)\)/) || [])[1];
  if (!inner) return 'Стандартный';
  if (inner === 'EXP') return 'Экспериментальный';
  return inner.replace('FAKE TLS AUTO', 'Авто TLS').replace('SIMPLE FAKE', 'Простой').trim();
}

function strategyTech(args) {
  const set = new Set();
  for (const a of args) {
    const m = a.match(/^--dpi-desync=(.+)$/);
    if (m) m[1].split(',').forEach(x => set.add(x));
  }
  return [...set].join(', ');
}

function loadStrategies(coreDir, vars) {
  return listBatFiles(coreDir).map(file => {
    const args = parseBat(fs.readFileSync(path.join(coreDir, file), 'utf8'), vars);
    return { id: file, file, name: strategyName(file), tech: strategyTech(args), args };
  });
}

function coreVersion(coreDir) {
  const text = fs.readFileSync(path.join(coreDir, 'service.bat'), 'utf8');
  return (text.match(/LOCAL_VERSION=([^"\r\n]+)/) || [])[1] || null;
}

function validateCore(dir) {
  for (const f of ['service.bat', 'bin/winws.exe', 'bin/WinDivert64.sys', 'bin/WinDivert.dll', 'bin/cygwin1.dll', 'lists/list-general.txt', 'lists/list-exclude.txt']) {
    if (!fs.existsSync(path.join(dir, f))) throw new Error(`В архиве нет файла ${f}`);
  }
  const vars = { BIN: 'C:\\b\\', LISTS: 'C:\\l\\', GameFilter: '12', GameFilterTCP: '12', GameFilterUDP: '12' };
  const list = loadStrategies(dir, vars);
  if (!list.length) throw new Error('В архиве нет ни одного способа');
  return list.length;
}

module.exports = { listBatFiles, parseBat, tokenize, toBinPath, strategyName, strategyTech, loadStrategies, coreVersion, validateCore };
