# Безопасность

## Как сообщить об уязвимости

Не пишите о ней в открытых обращениях. Откройте вкладку **Security** этого репозитория и нажмите **Report a vulnerability**: сообщение увидит только автор. Ответ обычно приходит в течение недели.

Уязвимость в самом обходе (`winws`, WinDivert, способы и списки) лучше отправить авторам [Flowseal/zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube) или [bol-van/zapret](https://github.com/bol-van/zapret).

## Как проверить установщик

- Скачивайте его только со [страницы релизов](https://github.com/Arkadiy2009/zapret-app/releases). Копии на других сайтах могут быть подделкой.
- Сверьте SHA256 файла с суммой на странице релиза:
  ```powershell
  Get-FileHash .\zapret-setup-1.2.2.exe -Algorithm SHA256
  ```
- Убедитесь, что файл собран на GitHub Actions из этого репозитория:
  ```powershell
  gh attestation verify .\zapret-setup-1.2.2.exe -R Arkadiy2009/zapret-app
  ```

## Как устроена защита

- **Обновления.** Приложение скачивает только файлы из релизов `Arkadiy2009/zapret-app` и `Flowseal/zapret-discord-youtube` и сверяет SHA256 с суммой, которую публикует GitHub. Файл с неверной суммой удаляется и не запускается.
- **Папка данных.** `C:\ProgramData\zapret` закрыта от записи для обычных пользователей, потому что служба работает от имени системы.
- **Electron.** Окно изолировано от системы (`contextIsolation`, `sandbox`, строгая CSP). В сборке выключены режимы, которые позволяют запустить через приложение посторонний код: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, отладка через `--inspect`. Код загружается только из проверенного архива `app.asar`.
- **Сборка.** Установщик собирается на GitHub Actions. Версии используемых actions закреплены по коммитам, а зависимости проверяет Dependabot.

## Сторонние файлы

Файлы запрета (`winws.exe`, `WinDivert64.sys`, `WinDivert.dll`, `cygwin1.dll`) берутся из официального релиза Flowseal без изменений, с проверкой суммы. Мы их не пересобираем и не подписываем.
