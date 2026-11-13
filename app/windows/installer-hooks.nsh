!macro NSIS_HOOK_PREINSTALL
  ; Small packages are updates, not first-install distributions. The native
  ; downloader has already verified every file before launching this installer.
  !ifdef KY_PLAY_APP_ONLY_HASH
    ${IfNot} ${FileExists} "$LOCALAPPDATA\${BUNDLEID}\emulators\${KY_PLAY_APP_ONLY_HASH}\data\loader.js"
      MessageBox MB_ICONSTOP "Please install the full version of Ky Play first. / 请先安装拾光完整版。"
      Abort
    ${EndIf}
  !endif
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ; NSIS update mode skips uninstalling. Remove only the shipped emulator tree
  ; so deleted upstream files cannot linger and invalidate future inventories.
  RMDir /r "$INSTDIR\emulatorjs"
  ${If} ${FileExists} "$INSTDIR\emulatorjs\*.*"
    MessageBox MB_ICONSTOP "Please close Ky Play and try again. / 请关闭拾光后重试。"
    Abort
  ${EndIf}
!macroend
