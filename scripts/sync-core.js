// Скачивает запрет из официального релиза Flowseal, сверяет сумму и кладёт в сборку как есть.
// Версия задаётся в package.json (coreVersion). Бинарные файлы в репозитории не хранятся.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { coreVersion } = require('../package.json');
const { coreByTag, prepare } = require('../src/main/update');

// На GitHub Actions у общих адресов низкий лимит запросов без токена
const token = process.env.GITHUB_TOKEN;
const net = (url, opts) => fetch(url, token ? { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } } : opts);

(async () => {
  const to = path.join(__dirname, '..', 'resources', 'core');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-core-'));
  try {
    const { dir } = await prepare(await coreByTag(coreVersion, net), tmp);
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(dir, to, { recursive: true });
    // В zip нет лицензии, а MIT требует приложить её текст
    const license = await fetch(`https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/${coreVersion}/LICENSE.txt`);
    if (!license.ok) throw new Error(`Лицензия не скачалась: ${license.status}`);
    fs.writeFileSync(path.join(to, 'LICENSE.txt'), Buffer.from(await license.arrayBuffer()));
    console.log(`core ${coreVersion}:`, fs.readdirSync(to).length, 'файлов и папок');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e.message); process.exit(1); });
