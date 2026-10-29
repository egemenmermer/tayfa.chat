; Windows installer hooks (electron-builder `nsis.include`).
; `build.protocols` only reaches macOS Info.plist, so the installer registers the invitation link
; scheme itself; the app registers it again at launch (registerInviteProtocol) to repair it.
; Keep the command identical to Electron's setAsDefaultProtocolClient: "<exe>" "%1".

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\rooms" "" "URL:Tayfa invitation links"
  WriteRegStr SHELL_CONTEXT "Software\Classes\rooms" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\rooms\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\rooms\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first; the new installer writes the same keys right after.
  ${ifNot} ${isUpdated}
    DeleteRegKey SHELL_CONTEXT "Software\Classes\rooms"
    ; A per-machine install still leaves the per-user key the app wrote at launch: remove it only
    ; when it points at this install.
    ReadRegStr $0 HKCU "Software\Classes\rooms\shell\open\command" ""
    StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 +2
      DeleteRegKey HKCU "Software\Classes\rooms"
  ${endIf}
!macroend
