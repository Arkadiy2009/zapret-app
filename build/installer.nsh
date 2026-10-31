; Удаление приложения убирает службу и данные. При обновлении приложения ничего не трогаем.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'sc stop zapret'
    nsExec::Exec 'taskkill /IM winws.exe /F'
    nsExec::Exec 'sc delete zapret'
    nsExec::Exec 'sc stop WinDivert'
    nsExec::Exec 'sc delete WinDivert'
    nsExec::Exec 'sc stop WinDivert14'
    nsExec::Exec 'sc delete WinDivert14'
    Sleep 1000
    SetShellVarContext all
    nsExec::Exec `powershell -NoProfile -Command "Remove-MpPreference -ExclusionPath '$APPDATA\zapret'"`
    RMDir /r "$APPDATA\zapret"
  ${endIf}
!macroend
