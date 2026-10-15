Unicode true
!include "MUI2.nsh"
Name "Cline Orchestrator"
OutFile "${OUTPUT_EXE}"
InstallDir "$LOCALAPPDATA\Programs\ClineOrchestrator"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  IfFileExists "$INSTDIR\*.*" 0 +2
    Abort "Installation target already contains files. Refusing to overwrite."
  IfFileExists "$INSTDIR\launcher\ClineOrchestrator.exe" 0 +2
    Abort "Cline Orchestrator is already installed."
FunctionEnd

Section "Cline Orchestrator (current user)" SecMain
  SetShellVarContext current
  IfFileExists "$INSTDIR\*.*" 0 +2
    Abort "Installation target is not empty. Refusing to overwrite."
  SetOutPath "$INSTDIR"
  File /r "${BUNDLE_DIR}\*.*"
  CreateDirectory "$SMPROGRAMS\Cline Orchestrator"
  CreateShortCut "$SMPROGRAMS\Cline Orchestrator\Open Cline Orchestrator.lnk" "$INSTDIR\launcher\ClineOrchestrator.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Cline Orchestrator\Open Cline Orchestrator.lnk"
  RMDir "$SMPROGRAMS\Cline Orchestrator"
  !include "${UNINSTALL_INCLUDE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
