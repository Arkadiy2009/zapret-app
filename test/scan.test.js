// Быстрый подбор должен выбирать то же, что полный, только за меньшее число запросов
const test = require('node:test');
const assert = require('node:assert');
const scan = require('../src/main/scan');

const strategies = Array.from({ length: 22 }, (_, i) => ({ file: `s${i}.bat`, args: [`s${i}`] }));
const targets = {
  list: [
    { id: 'yt', urls: ['https://yt/1', 'https://yt/2', 'https://yt/3', 'https://yt/4'] },
    { id: 'dc', urls: ['https://dc/1', 'https://dc/2', 'https://dc/3', 'https://dc/4'] },
  ],
  base: ['https://base/1', 'https://base/2', 'https://base/3', 'https://base/4'],
  pings: ['1.1.1.1'],
};

// answer(способ, адрес, протокол) решает, что вернёт проверка
function engineWith(answer) {
  let current = null;
  const e = {
    probes: 0, starts: [],
    killWinws: async () => { current = null; },
    startRaw: (exe, args) => { current = args[0]; e.starts.push(current); return { kill() {} }; },
    waitWinws: async () => true,
    probe: async (url, proto) => { e.probes++; return answer(current, url, proto); },
    ping: async () => 20,
  };
  return e;
}

const go = (engine, extra = {}) => scan.run({ engine, strategies, exe: 'w', targets, stopOnPerfect: true, onStep: () => {}, isCancelled: () => false, ...extra });
const full = engine => go(engine, { stopOnPerfect: false });

test('нашёлся идеальный способ: заблокированные не проходят полную проверку', async () => {
  const good = 's15';
  const answer = (s, url) => (s === good || url.includes('base') ? 'OK' : 'ERROR');
  const fast = engineWith(answer), old = engineWith(answer);
  const res = await go(fast);
  const all = await full(old);
  assert.strictEqual(scan.bestOf(res, ['yt', 'dc']), `${good}.bat`);
  assert.strictEqual(scan.bestOf(all, ['yt', 'dc']), `${good}.bat`);
  assert.ok(!res[`${good}.bat`].quick, 'победитель обязан пройти полную проверку');
  assert.ok(fast.probes * 4 < old.probes, `${fast.probes} против ${old.probes}`);
});

test('способ, который уже работал, проверяется первым и подбор заканчивается на нём', async () => {
  const e = engineWith(s => (s === 's9' ? 'OK' : 'ERROR'));
  const res = await go(e, { prefer: ['s9.bat'] });
  assert.deepStrictEqual(e.starts, ['s9']);
  assert.deepStrictEqual(Object.keys(res), ['s9.bat']);
});

test('быстрая проверка прошла, полная нет: подбор идёт дальше', async () => {
  const e = engineWith((s, url) => (s === 's0' && url === 'https://yt/2' ? 'ERROR' : s === 's0' || s === 's5' ? 'OK' : 'ERROR'));
  const res = await go(e);
  assert.ok(!scan.allOk(res['s0.bat'], ['yt', 'dc']));
  assert.strictEqual(scan.bestOf(res, ['yt', 'dc']), 's5.bat');
});

test('идеального нет: выбор совпадает с полным перебором', async () => {
  const answer = (s, url, proto) => {
    const n = +s.slice(1);
    if (n % 7 === 3 && url.startsWith('https://yt')) return proto === 'HTTP' ? 'ERROR' : 'OK';
    if (n === 10 && url.startsWith('https://dc')) return 'OK';
    return url.includes('base') ? 'OK' : 'ERROR';
  };
  const res = await go(engineWith(answer));
  const all = await full(engineWith(answer));
  assert.strictEqual(scan.bestOf(res, ['yt', 'dc']), scan.bestOf(all, ['yt', 'dc']));
});

test('никто не ответил: всех проверяем полностью с обычным таймаутом', async () => {
  const e = engineWith(() => 'ERROR');
  const res = await go(e);
  assert.strictEqual(Object.keys(res).length, 22);
  assert.ok(Object.values(res).every(r => !r.quick));
});

test('подмена DNS определяется без второго круга', async () => {
  const e = engineWith((s, url) => (url.includes('yt') ? 'SSL' : 'OK'));
  const res = await go(e);
  assert.ok(scan.looksLikeDnsHijack(res, ['yt', 'dc']));
  assert.strictEqual(e.starts.length, 22);
});

test('способ, который не запустился, не ломает подбор', async () => {
  const e = engineWith(s => (s === 's2' ? 'OK' : 'ERROR'));
  e.waitWinws = async () => e.starts.length !== 1;
  const res = await go(e);
  assert.ok(res['s0.bat'].failed);
  assert.strictEqual(scan.bestOf(res, ['yt', 'dc']), 's2.bat');
});

test('отмена останавливает оба круга', async () => {
  let left = 3;
  const e = engineWith(() => 'ERROR');
  const res = await go(e, { isCancelled: () => left-- <= 0 });
  assert.strictEqual(e.starts.length, 3);
  assert.strictEqual(Object.keys(res).length, 3);
});
