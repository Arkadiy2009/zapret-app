// Подбор способа. Полная проверка повторяет Standard tests из test zapret.ps1,
// глубокая повторяет DPI checkers. Быстрая только отсеивает: подходящим способ
// считается лишь после полной, поэтому качество выбора не падает.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROTOS = ['HTTP', 'TLS1.2', 'TLS1.3'];
const QUICK_PROTOS = ['TLS1.2', 'TLS1.3'];
const QUICK_TIMEOUT = 3;
const SUITE_URL = 'https://hyperion-cs.github.io/dpi-checkers/ru/tcp-16-20/suite.v2.json';

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function checkUrls(engine, urls) {
  const jobs = urls.flatMap(url => PROTOS.map(proto => ({ url, proto })));
  return tally(await pool(jobs, 12, j => engine.probe(j.url, j.proto)));
}

const tally = res => {
  const used = res.filter(r => r !== 'UNSUP');
  return { ok: used.filter(r => r === 'OK').length, total: used.length, ssl: used.filter(r => r === 'SSL').length };
};

// Все адреса идут в одну очередь: группы не ждут друг друга
async function probeGroups(engine, groups, protos = PROTOS, timeoutSec) {
  const jobs = groups.flatMap((g, n) => g.urls.flatMap(url => protos.map(proto => ({ n, url, proto }))));
  const res = await pool(jobs, 12, j => engine.probe(j.url, j.proto, timeoutSec));
  return groups.map((_, n) => tally(res.filter((__, i) => jobs[i].n === n)));
}

async function testStrategy(engine, targets) {
  const counts = await probeGroups(engine, [...targets.list, { urls: targets.base }]);
  const base = counts.pop();
  const out = Object.fromEntries(targets.list.map((t, i) => [t.id, counts[i]]));
  const hosts = [...targets.pings, ...targets.list.flatMap(t => t.urls.slice(0, 1).map(u => new URL(u).hostname))];
  const pings = (await pool(hosts, 8, h => engine.ping(h))).filter(p => p !== null);
  return { targets: out, base, ping: pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null, pingOk: pings.length };
}

async function testDpi(engine, suite, payload) {
  const jobs = suite.flatMap(s => PROTOS.map(proto => ({ host: s.host, proto })));
  const res = await pool(jobs, 12, j => engine.dpiProbe(j.host, j.proto, payload));
  const used = res.filter(r => r !== 'UNSUP');
  return { dpi: { ok: used.filter(r => r === 'OK').length, total: used.length, blocked: used.filter(r => r === 'BLOCKED').length } };
}

// Первый и последний адрес цели: у YouTube и Discord это сайт и самый капризный сервер
async function quickCheck(engine, targets) {
  const groups = targets.list.map(t => ({ urls: [...new Set([t.urls[0], t.urls.at(-1)])] }));
  const counts = await probeGroups(engine, groups, QUICK_PROTOS, QUICK_TIMEOUT);
  return { quick: true, targets: Object.fromEntries(targets.list.map((t, i) => [t.id, counts[i]])) };
}

const quickScore = r => Object.values(r.targets).reduce((sum, t) => sum + t.ok, 0);

const allOk = (r, ids) => ids.every(id => r.targets[id] && r.targets[id].total > 0 && r.targets[id].ok === r.targets[id].total);

// Главное: цели пользователя. Дальше общая связь и пинг, как в анализе test zapret.ps1
function score(r, ids) {
  const main = ids.reduce((sum, id) => {
    const t = r.targets?.[id];
    return sum + (t && t.total ? t.ok / t.total : 0);
  }, 0);
  const base = r.base && r.base.total ? r.base.ok / r.base.total : 0;
  return main * 1000 + base * 10 - (r.ping ?? 999) / 1000;
}

function bestOf(results, ids) {
  let best = null, bestScore = -Infinity;
  for (const [file, r] of Object.entries(results)) {
    if (r.failed) continue;
    const s = score(r, ids);
    if (s > bestScore) { best = file; bestScore = s; }
  }
  return best;
}

// Ошибка сертификата или имени при любом способе: это подмена DNS, а не DPI
function looksLikeDnsHijack(results, ids) {
  const list = Object.values(results).filter(r => !r.failed);
  if (!list.length) return false;
  return ids.filter(id => id === 'yt' || id === 'dc').some(id => list.every(r => {
    const t = r.targets?.[id];
    return t && t.ok < t.total && t.ssl > 0;
  }));
}

async function inWinws(engine, exe, st, fn) {
  await engine.killWinws();
  let exited = false;
  const child = engine.startRaw(exe, st.args, () => { exited = true; });
  if (!await engine.waitWinws() || exited) return { failed: true };
  try {
    return await fn();
  } finally {
    child.kill();
    await engine.killWinws();
  }
}

// Сначала то, что уже работало у этого человека, остальное в обычном порядке
function preferred(strategies, prefer) {
  const rank = st => { const i = prefer.indexOf(st.file); return i < 0 ? prefer.length : i; };
  return [...strategies].sort((a, b) => rank(a) - rank(b));
}

async function fastScan({ engine, strategies, exe, targets, prefer, onStep, isCancelled }) {
  const results = {};
  const ids = targets.list.map(t => t.id);
  const finished = r => !r.failed && !r.quick && allOk(r, ids);
  const pass = async (list, phase, test) => {
    for (let i = 0; i < list.length; i++) {
      if (isCancelled()) return true;
      onStep({ i, total: list.length, file: list[i].file, phase, results });
      results[list[i].file] = await inWinws(engine, exe, list[i], test);
      if (finished(results[list[i].file])) return true;
    }
    return false;
  };
  const queue = preferred(strategies, prefer);
  const found = await pass(queue, 1, async () => {
    const q = await quickCheck(engine, targets);
    return allOk(q, ids) ? testStrategy(engine, targets) : q;
  });
  // Подмена DNS видна уже здесь: полная проверка лишь добавит те же ошибки
  if (found || looksLikeDnsHijack(results, ids)) return results;

  // Идеального нет: выбираем лучшего честно, полной проверкой всех, кто хоть что-то открыл.
  // Если не ответил никто, возможно, медленный интернет, и проверяем всех с обычным таймаутом
  const quick = queue.filter(st => results[st.file].quick);
  const alive = quick.filter(st => quickScore(results[st.file]) > 0);
  const next = (alive.length ? alive : quick).sort((a, b) => quickScore(results[b.file]) - quickScore(results[a.file]));
  await pass(next, 2, () => testStrategy(engine, targets));
  return results;
}

async function run({ engine, strategies, exe, targets, stopOnPerfect, deep, onStep, isCancelled, suite, prefer = [] }) {
  if (stopOnPerfect && !deep && targets.list.length) return fastScan({ engine, strategies, exe, targets, prefer, onStep, isCancelled });
  const results = {};
  let payload = null;
  if (deep) {
    payload = path.join(os.tmpdir(), `zapret-dpi-${process.pid}.bin`);
    fs.writeFileSync(payload, crypto.randomBytes(65536));
  }
  try {
    for (let i = 0; i < strategies.length; i++) {
      if (isCancelled()) break;
      const st = strategies[i];
      onStep({ i, total: strategies.length, file: st.file, phase: 1, results });
      results[st.file] = await inWinws(engine, exe, st, () => (deep ? testDpi(engine, suite, payload) : testStrategy(engine, targets)));
    }
  } finally {
    await engine.killWinws();
    if (payload) fs.rmSync(payload, { force: true });
  }
  return results;
}

module.exports = { run, score, bestOf, allOk, looksLikeDnsHijack, checkUrls, quickCheck, SUITE_URL };
