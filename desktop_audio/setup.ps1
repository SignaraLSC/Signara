$ErrorActionPreference = 'Stop'
$audioRoot = $PSScriptRoot
$audioPython = Join-Path $audioRoot 'venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $audioPython)) {
    py -3.11 -m venv (Join-Path $audioRoot 'venv')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno de audio con Python 3.11.' }
}
& $audioPython -m pip install -r (Join-Path $audioRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias de audio.' }
& $audioPython (Join-Path $audioRoot 'worker.py') --prepare
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el reconocimiento de voz local.' }
Write-Host 'Audio local listo. Abre Signara nativa y pulsa play en el avatar flotante.'
