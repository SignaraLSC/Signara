$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$phraseFixtureDir = Join-Path $PSScriptRoot 'cache/phrase-regression'
New-Item -ItemType Directory -Path $phraseFixtureDir -Force | Out-Null
$phraseSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $phraseSynth.SelectVoice('Microsoft Helena Desktop')
    $cases = @(
        @{ name = 'sed-normal'; text = 'Tengo sed.'; rate = 0 },
        @{ name = 'sed-rapido'; text = 'Tengo sed.'; rate = 3 },
        @{ name = 'sed-frase'; text = 'Tengo sed, por favor necesito agua.'; rate = 2 },
        @{ name = 'sed-continua'; text = 'Hola, como estas, tengo sed, gracias.'; rate = 2 },
        @{ name = 'ser'; text = 'Tengo que ser responsable.'; rate = 2 },
        @{ name = 'seis'; text = 'Tengo seis libros.'; rate = 2 },
        @{ name = 'celos'; text = 'Tengo celos.'; rate = 2 },
        @{ name = 'hambre'; text = 'Tengo hambre.'; rate = 2 },
        @{ name = 'sueno'; text = 'Tengo sue&#241;o.'; rate = 2 },
        @{ name = 'nombre'; text = 'Me llamo Alanis.'; rate = 2 }
    )
    foreach ($case in $cases) {
        $target = Join-Path $phraseFixtureDir ($case.name + '.wav')
        if (Test-Path -LiteralPath $target) { continue }
        $phraseSynth.Rate = $case.rate
        $phraseSynth.SetOutputToWaveFile($target)
        $phraseSynth.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-ES"><break time="300ms"/>' + $case.text + '<break time="1000ms"/></speak>')
        $phraseSynth.SetOutputToNull()
        Write-Output $case.name
    }
} finally { $phraseSynth.Dispose() }
