# Widget de escritorio Signara (MVP Windows)

El widget reutiliza el avatar VRM, las animaciones de `sign_ai/animations`,
SignPlan y la ventana contextual. Tauri abre tres ventanas:

- `main`: la aplicación Signara normal.
- `overlay`: avatar transparente, sin marco y siempre encima. Permanece oculto
  al iniciar y se abre desde el desplegable de la tarjeta azul **Traducir**.
- `interpret-overlay`: cámara compacta, sin marco y siempre encima. Reconoce
  señas y reproduce el resultado únicamente por voz; no muestra transcripción,
  historial ni palabras reconocidas.

## Requisitos una sola vez

1. Node.js 18 o superior.
2. Rust estable (`rustup`, ya instalado en la máquina de desarrollo).
3. Microsoft Edge WebView2 Runtime (incluido normalmente en Windows 10/11).
4. Microsoft C++ Build Tools si Cargo indica que falta `link.exe`.

## Prueba rápida en navegador

Sirve para validar avatar, contexto, texto y diseño sin compilar Windows:

```powershell
npm run dev -- --host 127.0.0.1
```

Abrir `http://127.0.0.1:5173/?overlay=1`.

Para probar la cámara compacta abrir
`http://127.0.0.1:5173/?overlay=interpret`.

En otra terminal iniciar las animaciones:

```powershell
cd sign_ai
venv\Scripts\activate
uvicorn api:app --port 8000
```

## Prueba como ventana real sobre Word

En una terminal nueva, desde la raíz del proyecto:

```powershell
npm run desktop:dev
```

Después:

1. Abrir Word.
2. En la tarjeta azul **Traducir**, pulsar la flecha y elegir
   **Abrir avatar flotante**.
3. Mover el avatar por la zona de `Signara` en su barra superior y dejarlo
   encima de Word.
4. Pulsar el icono del micrófono y decir `Hola, cómo estás por favor`.
5. Probar también `Mañana tenemos clase por la mañana`.
6. Solo los fragmentos confirmados se envían al avatar; las hipótesis
   provisionales pueden cambiar sin producir señas equivocadas.
7. Arrastrar cualquier borde o esquina para redimensionar libremente.
8. El botón `□` vuelve a la aplicación completa; `×` oculta el widget sin
    cerrar Signara.

Para Interpretar, abrir el desplegable de la tarjeta morada y elegir
**Abrir cámara flotante**. La cámara comienza a reconocer cuando el modelo y
el permiso están listos; el botón circular permite pausar o reanudar. La seña
confirmada se escucha, pero no aparece como texto en la ventana.

## Qué cubre este MVP

- Ventana flotante transparente, movible y redimensionable desde sus ocho lados.
- Avatar responsive: Three.js recalcula el lienzo y la cámara sin deformarlo.
- Bandeja de Windows: mostrar, ocultar, recuperar interacción, abrir y salir.
- Dos controles de entrada únicamente en el avatar flotante: micrófono y play.
- Guía rápida en la primera apertura; el botón `?` permite consultarla de nuevo.
- Play captura la salida predeterminada de Windows con WASAPI, también con audífonos.
- Transcripción local con Whisper/Silero, sin enviar ni guardar el audio.
- Cámara flotante responsive con salida solo por voz y sin texto reconocido.
- Ventana incremental: unidades pendientes y confirmadas.
- Memoria v1 de tema, tiempo, intención, pronombres/referentes y expresión facial.
- Deletreo como respaldo cuando el significado existe pero falta su animación.

## Lo que sigue pendiente

- Empaquetar Python y dependencias como sidecar en el instalador distribuible.
- Separar aplicaciones/hablantes; el MVP escucha la mezcla del dispositivo predeterminado.
- Migrar el micrófono a ASR local cuando WebView2 no exponga Web Speech.
- Aplicar los modificadores faciales de SignPlan al VRM en tiempo real.
- Planificador gramatical LSC validado por comunidad sorda/intérpretes.
- Memoria de loci de terceras personas basada en el discurso completo.

## Audio de videos y llamadas (solo avatar flotante, Windows)

Preparación una sola vez, desde la raíz:

```powershell
npm run desktop:audio:setup
```

Esto crea `desktop_audio/venv` independiente de `sign_ai/venv` e instala
PyAudioWPatch (WASAPI), faster-whisper y Silero VAD. Descarga el modelo `base`
a `desktop_audio/cache/speech-models/base` (junto al entorno virtual de audio).
La app carga esa carpeta directamente, sin depender de AppData ni de refs de
Hugging Face. Requiere internet en esta preparación si falta la descarga;
la transcripción posterior es local. No cambia pesos, datos ni API del GNN.

Recompilar la aplicación nativa para incluir los comandos nuevos:

```powershell
npm run desktop:dev
```

En el avatar flotante:

La guía inicial explica las dos fuentes, el color de preparación/escucha,
movimiento y tamaño de la ventana, minimizar/ampliar/cerrar y detener la captura.
Al terminar o saltar, se recuerda en ese perfil. `?` la reabre y detiene las
entradas de audio mientras se consulta; no activa escucha automáticamente.

1. **Micrófono** escucha a alguien presente (Web Speech actual).
2. **Play** escucha el audio del PC. El color rosa indica que la captura confirmó
   estar lista; vuelve a pulsar el mismo botón para detenerla. Durante carga,
   play pulsa en morado (todavía no está escuchando).
3. Son fuentes excluyentes. Cambiar descarta contexto pendiente de la fuente anterior
   y resultados atrasados, pero permite terminar señas ya confirmadas en cola.
4. Prueba un video en español con «Hola, cómo estás», «Tengo sed», «Gracias».
5. Pausa el video 15 segundos: no debe crear nuevas señas. Puede terminar la cola existente.
6. Reanuda y repite una frase: debe interpretarla de nuevo, una vez por emisión real.
7. Cambia entre parlantes y audífonos: el worker vuelve a enumerar la salida cada 2 s.
8. Cerrar/ocultar el avatar detiene captura; minimizar permite seguir escuchando.

### Preparación y reanudación de Play

Al abrir/enfocar el avatar flotante se precargan Whisper, Silero y las librerías
de audio, y se calienta la inferencia con silencio sintético. Esta preparación
no abre dispositivos ni captura audio. La primera carga todavía puede tardar
unos segundos (3,5 s en la auditoría local); si pulsas Play antes de terminar,
debes esperar a que se ponga rosa.

Al pausar Play se cierra el dispositivo y se descartan el audio pendiente y el
contexto de esa sesión, pero el motor permanece en RAM. Al reanudar se reutiliza
ese proceso con una cola, historial de confirmación e identificadores nuevos;
no se repite la carga del modelo. El rosa sigue indicando captura realmente
activa, no simplemente un motor preparado. La demora de activación con WASAPI
real debe comprobarse en el equipo; no se garantiza una activación instantánea.

Ocultar el widget también pausa la captura. Salir de Signara libera el motor;
una interrupción del proceso exige cargarlo otra vez. Mantenerlo preparado
consume RAM mientras Signara siga abierta, aunque Play esté apagado. El cierre
del dispositivo debe confirmarse; si no hay acuse en cuatro segundos, la app
termina el proceso por seguridad. Los resultados de sesiones anteriores no
pueden entrar en la nueva sesión.

No aparece en la ventana grande ni en la cámara flotante. En navegador play
está deshabilitado. El audio y el texto transcrito no se muestran sobre las manos.
Los errores excepcionales sí aparecen debajo de los controles.

### Flujo y límites explícitos

- Silero detecta voz. A partir de 1,2 s de audio se consulta una ventana
  solapada cada 800 ms (si la CPU tarda, se usa el snapshot más reciente).
  LocalAgreement-2 confirma únicamente palabras que coinciden en dos lecturas
  consecutivas, con timestamps y un margen final de 350 ms. No se envían
  hipótesis completas ni se espera a que termine toda la intervención.
- Una pausa de 700 ms confirma el sufijo restante, sin volver a enviar lo
  confirmado. El planificador conserva prefijos como «cómo» y «tengo» hasta
  completar «cómo estás» y «tengo sed»; no se deletrean por adelantado.
- El límite de ocho palabras se aplica al contexto todavía pendiente, no
  al bloque confirmado que envía Play. Primero se resuelven las expresiones
  completas: incluso un bloque largo que empieza por «tengo sed» produce
  `TENGO_SED`, no las letras de ambas palabras por separado. La pantalla
  normal también conserva el orden desde la primera seña, usando el VRM
  precargado en lugar de posponer solo el primer token al siguiente render.
- Ventana móvil máxima de 12 s, sin dividir la voz arbitrariamente a los 8 s.
  Si la CPU pierde audio todavía no confirmado, se detiene con un error
  explícito. La cola reemplaza parciales viejos, pero nunca descarta un cierre.
- Se calienta la primera inferencia antes de marcar play como listo. Estos
  intervalos son de captura, NO una garantía de latencia: hacen falta dos
  lecturas, procesamiento de Whisper, planificación y reproducción.
- `low_latency.py` elimina únicamente el relleno artificial al final del
  espectrograma: mínimo 8 s y 1 s de margen, sin recortar audio real. Antes se
  codificaban 30 s aunque hubiese solo 2 s de voz. Los pesos `base`, beam=3 y
  los filtros de confirmación se conservan. La variante mínima de 4 s se
  rechazó porque cambió «sed» por «ser» en la prueba sintética.
  `SIGNARA_SPEECH_FULL_WINDOW=1` recupera el encoder con padding completo.
- En la grabación aportada, cada consulta pasó de ~2,6–3,2 s a ~0,6 s en la
  auditoría offline. Alimentando el mismo archivo al ritmo real de captura,
  las consultas costaron 0,76–1,01 s y el primer texto confirmado llegó a los
  2,78 s, antes del fin de voz (3,14 s). Esto mide el pipeline Python, NO la
  primera seña visible: después hay IPC, planificación y reproducción. Frases
  muy cortas todavía pueden terminar antes de obtener dos lecturas estables.
- Una confirmación con varias unidades se encola en un solo lote. Se preparan
  empalmes y salida mientras se reproduce el clip actual; las señas consecutivas
  parten de la pose anterior, sin un reposo obligatorio entre palabras.
  Si todavía no hay audio confirmado siguiente, no se inventan señas ni se
  mantiene al avatar congelado esperando indefinidamente.
- Whisper usa español, CPU/int8 y no arrastra transcripciones anteriores. Se
  filtran salidas con alto no-speech, baja probabilidad o repetición excesiva.
- El decoder recibe `sed` como vocabulario acústico (`hotwords`), no como
  texto obligatorio. El modelo `base` confundía la palabra corta con «ser» o
  «se» en las voces de prueba; el encoder corto también puede cambiar esa
  elección aunque conserve el audio. No se sustituye SE/SER por SED en el
  planificador, ni se usa el historial como prompt. Los filtros de silencio,
  la confirmación incremental y la espera de `TENGO_SED` se mantienen.
  La regresión con una voz sintética cubre frase aislada normal/rápida,
  frase larga, habla seguida y controles como «tengo sueño», «tengo seis
  libros» y «tengo que ser responsable». No garantiza precisión con cualquier
  voz, ruido o velocidad; un nombre propio todavía puede transcribirse mal.
- Cada fragmento tiene un ID de sesión/resultado; no se vuelve a traducir el
  historial. Decir de nuevo la misma frase es válido y no se elimina por texto.
- El widget lee eventos con cursor cada 350 ms desde un buffer nativo acotado,
  en lugar de depender de callbacks de Channel en segundo plano. Los reintentos
  recuperan resultados no consumidos sin repetirlos. Una interrupción, pérdida
  del buffer o arranque sin completar se informa y desactiva play.
- El log nativo registra solo sesión, tipo de evento y estado; no guarda el
  audio ni las frases transcritas.
- Cola acotada: si el equipo no alcanza el ritmo, se informa y se detiene,
  en lugar de acumular indefinidamente una conversación atrasada.
- Se oye toda la mezcla: notificaciones, música y otras aplicaciones pueden
  interferir. No hay diarización ni garantía para varias personas hablando a la vez.
- No activar a la vez salida de voz de la cámara: el loopback también oiría a Signara.
- La llamada debe usar la salida predeterminada de Windows. Una aplicación
  configurada para otra salida no estará en esta captura.
- Las señas disponibles y la gramática LSC validada siguen limitando la traducción.

La versión instalada todavía necesita un entorno Python de audio externo;
`SIGNARA_AUDIO_PYTHON` permite indicar su `python.exe`. Se incluyen los scripts
en los recursos Tauri, no el intérprete ni las dependencias. El desarrollo en
este repositorio encuentra `desktop_audio/venv` automáticamente.

Pruebas automáticas sin captar conversaciones:

```powershell
npm run test:desktop-audio
npm run test:avatar-voice-routing
desktop_audio/venv/Scripts/python.exe -m unittest discover -s desktop_audio -p "test_*.py"
desktop_audio/venv/Scripts/python.exe desktop_audio/audit_preparation.py
cargo test --manifest-path src-tauri/Cargo.toml --lib desktop_audio::tests -- --include-ignored
```

La auditoría de preparación carga el motor residente, verifica que no anuncie
escucha ni entregue transcripciones y comprueba su salida al cerrar la tubería;
no envía START ni captura audio. Las pruebas nativas de tuberías usan un proceso
simulado, no el dispositivo de sonido. La suite Python incluye regresiones de
precarga, cancelación durante carga, pausa, reutilización y resultados atrasados.

Regresión del ASR con voces sintéticas sin reproducir ni capturar sonido:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop_audio/make_phrase_fixtures.ps1
desktop_audio/venv/Scripts/python.exe desktop_audio/audit_phrases.py --baseline
desktop_audio/venv/Scripts/python.exe desktop_audio/audit_phrases.py
```

Las voces se generan en el caché ignorado, sin sobreescribir archivos existentes.
`--baseline` compara la política anterior sin vocabulario; el comando normal
verifica `tengo sed` una sola vez y ausencia de `sed` en las frases de control.
Se utiliza la misma segmentación, decoder y confirmación del worker. Esta
auditoría no abre WASAPI ni mide la animación visible de la ventana.

Prueba end-to-end opt-in (reproduce una voz sintética por la salida de Windows;
no guarda la captura y comprueba 6 s de pausa sin transcripciones nuevas):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop_audio/make_test_audio.ps1
desktop_audio/venv/Scripts/python.exe desktop_audio/smoke_test.py
```

Auditar un archivo aportado sin reproducirlo ni captar audio del dispositivo:

```powershell
desktop_audio/venv/Scripts/python.exe desktop_audio/audit_streaming.py "C:\ruta\video.mp4"
desktop_audio/venv/Scripts/python.exe desktop_audio/audit_streaming.py "C:\ruta\video.mp4" --realtime --require-before-end
```

Muestra el instante de audio y el coste de inferencia por separado. `--realtime`
alimenta la misma cola y VAD online al ritmo de captura, sin reproducir sonido;
registra la entrega de texto en tiempo de reloj. `--require-before-end` comprueba
que haya una entrega antes del final de voz del archivo (puede fallar para una
frase muy corta). Ninguna variante mide latencia end-to-end del widget.
El enfoque de confirmación se basa en
[Whisper-Streaming / LocalAgreement](https://github.com/ufal/whisper_streaming).
