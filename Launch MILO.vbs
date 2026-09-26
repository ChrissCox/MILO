Option Explicit
Dim shell, files, root, executable
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
executable = files.BuildPath(root, "node_modules\electron\dist\electron.exe")
If Not files.FileExists(executable) Then
  MsgBox "MILO's desktop runtime is missing. README.md in this folder explains how to set it up.", vbInformation, "MILO"
  WScript.Quit 1
End If
shell.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"
shell.CurrentDirectory = root
shell.Run Chr(34) & executable & Chr(34) & " " & Chr(34) & root & Chr(34), 1, False
