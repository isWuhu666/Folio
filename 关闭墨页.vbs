Option Explicit
Dim shell, files, root, python, command, argument
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
python = files.BuildPath(root, ".venv\Scripts\pythonw.exe")
If Not files.FileExists(python) Then WScript.Quit 0
shell.CurrentDirectory = root
command = """" & python & """ """ & files.BuildPath(root, "desktop.py") & """ --stop"
For Each argument In WScript.Arguments
    command = command & " """ & Replace(argument, """", "") & """"
Next
shell.Run command, 0, False
