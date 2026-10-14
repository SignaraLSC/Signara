$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$audioTestDir = Join-Path $PSScriptRoot 'cache'
New-Item -ItemType Directory -Path $audioTestDir -Force | Out-Null
$audioTestSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $audioTestSynth.SelectVoice('Microsoft Helena Desktop')
    $audioTestSynth.SetOutputToWaveFile((Join-Path $audioTestDir 'smoke.wav'))
    # Entidades ASCII: Windows PowerShell 5 interpreta scripts UTF-8 sin BOM
    # como ANSI; no dejar que corrompa los acentos de la frase de prueba.
    $audioTestSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-ES"><break time="300ms"/>Hola, c&#243;mo est&#225;s. Tengo sed. Gracias.<break time="1000ms"/></speak>')
} finally {
    $audioTestSynth.Dispose()
}
