// Тексты интерфейса. Способы, цели, каталог и результаты приходят из основного процесса.
const DIAG_GROUPS = [
  {
    title: 'Система',
    items: [
      { id: 'bfe',      name: 'Служба базовой фильтрации Windows', fix: 'Без неё обход не запустится. Включите службу Base Filtering Engine.' },
      { id: 'driver',   name: 'Файл драйвера на месте',            fix: 'Файл WinDivert64.sys удалён, чаще всего это делает антивирус. Добавьте папку в исключения и переустановите приложение.' },
      { id: 'tcp',      name: 'Метки времени TCP',                 fix: 'Были выключены. Включили сами.' },
      { id: 'cyrillic', name: 'Папка без кириллицы',               fix: 'В пути есть русские буквы. Это может мешать обходу.' },
      { id: 'onedrive', name: 'Папка не в OneDrive',               fix: 'Файлы лежат в OneDrive. Это может мешать обходу.' },
    ],
  },
  {
    title: 'Программы, которые мешают',
    items: [
      { id: 'adguard',   name: 'AdGuard',                 fix: 'Может ломать Discord. Выйдите из AdGuard и проверьте снова.' },
      { id: 'killer',    name: 'Killer',                  fix: 'Службы Killer конфликтуют с обходом. Отключите их.' },
      { id: 'intel',     name: 'Intel Connectivity',      fix: 'Служба Intel Connectivity Network Service конфликтует с обходом. Отключите её.' },
      { id: 'checkpoint',name: 'Check Point',             fix: 'Check Point конфликтует с обходом. Его нужно удалить.' },
      { id: 'smartbyte', name: 'SmartByte',               fix: 'Удалите SmartByte или отключите его службу.' },
      { id: 'vpn',       name: 'VPN',                     fix: 'Некоторые VPN мешают обходу. Отключите их на время.' },
      { id: 'conflict',  name: 'Другие обходы',           fix: 'Найдены службы GoodbyeDPI, discordfix_zapret, winws1 или winws2.' },
      { id: 'windivert', name: 'Зависший драйвер обхода', fix: 'Драйвер оставался включённым без обхода. Удалили сами.' },
    ],
  },
  {
    title: 'Сеть',
    items: [
      { id: 'proxy', name: 'Системный прокси',   fix: 'Включён прокси. Проверьте его или отключите, если не пользуетесь.' },
      { id: 'dns',   name: 'Безопасный DNS',     fix: 'Выключен. Это нормально, пока сайты открываются.' },
      { id: 'hosts', name: 'Записи YouTube в hosts', fix: 'В файле hosts есть записи YouTube, они могут мешать.' },
    ],
  },
];

const LIST_TABS = [
  { id: 'general', title: 'Обходить сайты',    file: 'list-general-user.txt',   hint: 'Домены. Поддомены учитываются сами.' },
  { id: 'exclude', title: 'Не трогать сайты',  file: 'list-exclude-user.txt',   hint: 'Помогает, если сайт работает без обхода, а с ним ломается.' },
  { id: 'ipadd',   title: 'Обходить IP',       file: 'ipset-all.txt',           hint: 'IP и подсети, например серверы игры. Обновление заменяет этот файл целиком, поэтому мы храним ваши адреса отдельно и возвращаем их обратно.' },
  { id: 'ipskip',  title: 'Не трогать IP',     file: 'ipset-exclude-user.txt',  hint: 'Помогает, если в игре вырос пинг.' },
];
