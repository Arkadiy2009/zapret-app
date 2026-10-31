// Рисует значок приложения и трея. Знак: две плиты стены и поток, который идёт сквозь них и складывается в Z.
// Для мелких размеров своя отрисовка: толще штрихи, плиты по сетке пикселей, без свечения и рамки.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const WHITE = '#eff4ff';
const BEAM = ['#1f7dff', '#2ae3ff'];
const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ${body}</svg>`;
const grad = (a, b) => `<linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="68" y1="200" x2="188" y2="56"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

const large = (size, [a, b] = BEAM) => svg(size, `viewBox="0 0 256 256"><defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14264f"/><stop offset="1" stop-color="#060c1d"/></linearGradient>
  ${grad(a, b)}
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
  <clipPath id="box"><rect x="6" y="6" width="244" height="244" rx="56"/></clipPath></defs>
  <rect x="6" y="6" width="244" height="244" rx="56" fill="url(#bg)"/>
  <polygon clip-path="url(#box)" points="164,56 212,56 92,200 44,200" fill="${b}" opacity=".42" filter="url(#glow)"/>
  <rect x="7.5" y="7.5" width="241" height="241" rx="54.5" fill="none" stroke="#9cc0ff" stroke-opacity=".18" stroke-width="3"/>
  <polygon points="64,56 152,56 123.7,90 52,90 52,68" fill="${WHITE}"/>
  <polygon points="192,200 104,200 132.3,166 204,166 204,188" fill="${WHITE}"/>
  <polygon points="164,56 212,56 92,200 44,200" fill="url(#beam)"/>`);

const medium = (size, [a, b] = BEAM) => {
  // Координаты в пикселях: края плит ложатся точно на сетку и не мылятся
  const k = size / 32, x = n => +(n * k).toFixed(2);
  const top = Math.round(6 * k), h = Math.round(5 * k), low = size - top, side = Math.round(6 * k);
  return svg(size, `viewBox="0 0 ${size} ${size}"><defs>
  <linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="${x(8)}" y1="${low}" x2="${x(24)}" y2="${top}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect x="${x(1)}" y="${x(1)}" width="${x(30)}" height="${x(30)}" rx="${x(7)}" fill="#0b1633"/>
  <polygon points="${side},${top} ${x(18.4)},${top} ${x(14.3)},${top + h} ${side},${top + h}" fill="${WHITE}"/>
  <polygon points="${size - side},${low} ${x(13.6)},${low} ${x(17.7)},${low - h} ${size - side},${low - h}" fill="${WHITE}"/>
  <polygon points="${x(20)},${top} ${x(27)},${top} ${x(12)},${low} ${x(5)},${low}" fill="url(#beam)"/>`);
};

const small = (size, [a, b] = BEAM) => svg(size, `viewBox="0 0 16 16" shape-rendering="geometricPrecision"><defs>
  <linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="4" y1="14" x2="12" y2="2"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="16" height="16" rx="3.5" fill="#0b1633"/>
  <rect x="2" y="2" width="7" height="3" fill="${WHITE}"/>
  <rect x="7" y="11" width="7" height="3" fill="${WHITE}"/>
  <polygon points="9.5,2 14.5,2 6.5,14 1.5,14" fill="url(#beam)"/>`);

const pick = size => (size <= 20 ? small : size <= 40 ? medium : large);

// ICO с PNG внутри: Windows берёт точный размер вместо растягивания
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, png], i) => {
    const e = 6 + i * 16;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(x => x[1])]);
}

(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const p = await b.newPage();
  const shot = async (size, colors) => {
    await p.setViewport({ width: size, height: size });
    await p.setContent(`<html style="background:transparent"><body style="margin:0;background:transparent">${pick(size)(size, colors)}</body></html>`);
    return Buffer.from(await p.screenshot({ omitBackground: true }));
  };
  const save = async (name, sizes, colors) => {
    const images = [];
    for (const size of sizes) images.push([size, await shot(size, colors)]);
    fs.writeFileSync(path.join(__dirname, '..', name), ico(images));
  };
  await save('build/icon.ico', [16, 20, 24, 32, 40, 48, 64, 128, 256]);
  await save('src/renderer/img/icon.ico', [16, 20, 24, 32, 40, 48, 64, 128, 256]);
  await save('src/renderer/img/tray-off.ico', [16, 20, 24, 32, 40], ['#ff5a6a', '#ff5a6a']);
  await save('src/renderer/img/tray-on.ico', [16, 20, 24, 32, 40], ['#3fe7b0', '#3fe7b0']);
  await b.close();
})();
