# Entrenamiento de señas con recorrido completo

El modelo nuevo **sigue siendo GCN + LSTM**. La GCN procesa cada cuadro de
landmarks de ambas manos; la LSTM recibe la toma completa con su longitud real.
La normalización `wrist_trajectory_xyz_v1` conserva el desplazamiento de la
muñeca en X/Y/Z. No reutiliza el checkpoint de 24 cuadros.

## Grabar

Desde `sign_ai`, inicia `python 00_capture.py`, elige la seña, pulsa `S` antes
de empezar y `S` al terminar **todo** el movimiento. El JSON en
`data/raw_full/<persona>/<SEÑA>_<n>.json` guarda `frames` completos y
`train_frames` separados para el sistema anterior. El CSV sigue teniendo
24 cuadros; **no** es entrada de este entrenamiento. La toma se cierra sola
al llegar a 150 cuadros como límite de seguridad.

## Auditar y entrenar

En PowerShell, desde `sign_ai`:

```powershell
.\venv\Scripts\python.exe 08_train_sequence.py --audit-only
.\venv\Scripts\python.exe 08_train_sequence.py --require-full G H J S Z Ñ SI NO POR_FAVOR
```

`--audit-only` no modifica modelos. El comando de entrenamiento exige, por
defecto, al menos 30 tomas de más de 24 cuadros en total y 10 tomas completas
para cada etiqueta pasada en `--require-full`. Ajusta las listas según las
señas que hayan regrabado; **no** bajes los umbrales para simular cobertura.
Cuando una clase ya tiene al menos 10 tomas completas, el entrenador usa
solo esas tomas para esa clase; las antiguas de 24 no dominan su aprendizaje.
Las clases todavía no regrabadas conservan sus muestras antiguas.
Si la letra o seña realmente dura menos de 24 cuadros, su toma nueva también
es válida: se distingue por la presencia de `train_frames`, aunque no cuente
para el mínimo de tomas largas.

El entrenamiento guarda `models/signara_gnn_sequence.pt`,
`models/labels_gnn_sequence.json` y
`models/signara_gnn_sequence_meta.json`. Nunca sustituye
`models/signara_gnn.pt`. La validación es por toma y puede compartir firmante;
**no demuestra precisión con personas nuevas**. Verifica letras dinámicas,
señas en movimiento, falsos positivos y latencia con cámara real antes de
habilitar el modelo.

## Activar tras validarlo

Solo cuando el checkpoint nuevo sea satisfactorio, reinicia la API con
`SIGNARA_ENABLE_SEQUENCE=1`. `/health` debe indicar
`sequence_model_loaded: true`. La web entonces envía la secuencia real a
`/predict/sequence`; si no hay modelo nuevo mantiene el `/predict` antiguo.
No actives esta variable solo porque terminó el entrenamiento: la precisión
en datos de entrenamiento/validación no sustituye una prueba en vivo.

## Deletreo automático en la web

La primera letra compite con las palabras. Al confirmarse, todas las peticiones
del nombre usan `letters_only: true`; no hay una casilla de modo manual. Las
consultas continúan durante el trazo y el cambio real de dedos o un nuevo
recorrido desbloquea la letra siguiente, sin exigir retirar la mano.

Con el modelo variable, las consultas pueden empezar en 6 cuadros. Se conserva
el recorrido sin remuestrear y se separa su cola de quietud: añadir cuadros de
espera a una H breve alteraba la predicción del modelo. Esta segmentación es
heurística, no demuestra por sí sola reconocimiento continuo perfecto.

Una pausa de 1,8 segundos después de una letra confirmada cierra el nombre y
permite volver a palabras. Es una regla provisional para delimitar unidades,
no una duración obligatoria de la seña. Mantener la misma pose no vuelve a
emitir la última letra. Las respuestas dudosas se descartan: el modo alfabeto
no debe convertir una probabilidad residual de BIEN en una G inventada.

## Reconocimiento híbrido: conservar las formas del modelo anterior

`/predict/sequence` puede coordinar **dos checkpoints**, no sumar sus pesos ni
promediar sus confidencias. El checkpoint histórico local de letras estáticas
se verificó idéntico al de Git y no se sobrescribe:

- **Formas estáticas y palabras:** `signara_gnn.pt`, con su preprocesamiento
  `hand_local_v1`. Un adaptador reparte la secuencia recibida en sus 24 pasos
  internos; esto no exige realizar una seña en un tiempo fijo.
- **G, H, J, S, Z y Ñ:** `signara_gnn_sequence.pt` recibe todos los cuadros
  del recorrido, con `wrist_trajectory_xyz_v1`. Necesita movimiento observable,
  no una postura inmóvil ni probabilidades residuales renormalizadas.
- **Selección:** si el modelo histórico dice una palabra con margen claro,
  se verifica además si las formas del inicio/centro/final son alfabéticas.
  Así una S confundida con NO puede llegar al especialista temporal sin
  convertir automáticamente una MAL auténtica en Ñ. Los desacuerdos entre
  letras móviles necesitan corroboración; de lo contrario se abstiene.

Para probarlo desde `sign_ai`, con el servidor previo detenido:

```powershell
$env:SIGNARA_ENABLE_SEQUENCE = "1"
$env:SIGNARA_ENABLE_HYBRID = "1"
.\venv\Scripts\python.exe -m uvicorn api:app --port 8000 --reload
```

`/health` debe mostrar `hybrid_model_loaded: true` y
`recognition_pipeline: "hybrid_shape_motion"`. No hace falta reentrenar para
probar esta coordinación. `SIGNARA_ENABLE_HYBRID=0` permite comparar el modelo
variable solo; `SIGNARA_ENABLE_SEQUENCE=0` vuelve a la ruta histórica.
Estas variables afectan al proceso iniciado, no reescriben modelos.

El respaldo de cadencia conserva principio y fin de **todo** el recorrido,
distribuyéndolo a media densidad si la primera lectura no se corrobora. No
recorta a los últimos 24 cuadros. Es una mitigación de la sensibilidad a la
velocidad, no un sustituto de entrenar con velocidades y firmantes variados.
Los campos `recognition_source`, `motion_detected` y `evaluated_frames` de la
respuesta quedan también en la traza de desarrollo de la web.

Auditoría reproducible que no modifica pesos ni grabaciones:

```powershell
.\venv\Scripts\python.exe 12_hybrid_audit.py --takes-per-letter 10
.\venv\Scripts\python.exe -m unittest discover -s tests -v
```

La auditoría compara primeras letras, letras dentro del deletreo, cadencia
doble, palabras y compatibilidad de formas estáticas. Puede incluir tomas de
entrenamiento: **no demuestra precisión real con cámara**. Probar nombres que
empiecen por cada letra móvil, cambiar entre letras sin retirar la mano,
repetir a distintas velocidades y comprobar también SI/NO/POR_FAVOR/GRACIAS.
M/N siguen dependiendo de la separación aprendida por el checkpoint anterior;
si todavía se confunden, esta fusión no inventa su diferencia ni garantiza
resolverla sin muestras contrastivas de calidad.

### Cambios entre letras y respuestas tardías

La web bloquea la pose de la consulta confirmada, **no** la pose que llegó
mientras respondía la API. Los cuadros del cambio de dedos que desbloquean la
siguiente letra se conservan desde su inicio. Para confirmar una letra estática
se comprueba también la quietud de los últimos ocho cuadros: un trazo suave no
es una postura quieta solo porque cada desplazamiento individual sea pequeño.
La confirmación final de una letra móvil no se invalida por cambios de dedos
que son parte de su recorrido.

Dentro de un nombre, un NO del modelo histórico ya no veta una S del modelo
temporal: las palabras se filtran al salir del reconocedor, sin convertir
probabilidades residuales en letras. Para J se rechaza una contradicción clara
con los dedos de las tomas del corpus (índice recto y meñique plegado, como L).
Es una comprobación negativa, no un detector geométrico que invente J ni una
garantía de generalización a cualquier ejecución de LSC.

En desarrollo aparece **Guardar diagnóstico** bajo la cámara. Después de un
error, ese botón exporta únicamente landmarks y decisiones recientes, con los
cuadros exactos de cada consulta. No guarda video ni audio y no aparece en la
compilación de producción. Esta traza es necesaria para distinguir un fallo
de clasificación en cámara de una letra descartada por el posprocesamiento.

### Diagnóstico de las tres trazas de deletreo (2026-10-08)

Se encontraron intentos sin confirmar mezclados en buffers de hasta 180
cuadros, cambios esporádicos de slot de una misma mano y H falsas durante
transiciones de formas incompatibles. La web conserva la identidad de una
sola muñeca cercana (no intercambia dos manos), separa un nuevo intento tras
una pausa sostenida aunque el anterior haya sido rechazado y guarda el corte
en `attemptStart`. Los recorridos sin pausas no se cortan a una duración fija.
El híbrido comprueba también la forma de H: no puede validarla solo por un
prior de duración. SI/NO/POR_FAVOR no se confirman con seis cuadros quietos.

Replay reproducible, sin modificar las trazas, pesos ni datasets:

```powershell
# Desde la raíz del repositorio, con la API híbrida activa:
node scripts/replay-spelling-trace.mjs "C:\Users\USER\Downloads\signara-traza-deletreo.json" "C:\Users\USER\Downloads\signara-traza-deletreo (1).json" "C:\Users\USER\Downloads\signara-traza-deletreo (2).json"
```

En la tercera traza, consultas que antes se abstenían recuperan G en dos
lecturas consecutivas al separar el intento. Las dos H incorrectas de la
primera traza ya no salen como H. **La segunda traza sigue sin recuperar Ñ
consistentemente**: cortar el buffer no basta para todos los intentos. No
atribuir cada M a una Ñ correcta ni forzar una sustitución M→Ñ. Las trazas
dicen `expected: deletreo`, sin etiquetar cada intento: hace falta confirmar
qué letra se intentaba y recoger un ensayo aislado/etiquetado de Ñ y J antes
de decidir si se requieren nuevas muestras contrastivas o reentrenamiento.
Los landmarks pueden diferir por ejecución o por oclusión/detección; estos
archivos por sí solos no distinguen ambas causas. No se reentrenaron modelos.

La usuaria aclaró que estaba probando ALSA, G, Ñ y J mezcladas, no una letra
por archivo. Por tanto las predicciones M de un archivo NO son una matriz
de confusión etiquetada de Ñ. Al revisar todas las consultas originales del
modelo temporal, J no superó aproximadamente 0.0234 de probabilidad: no se
puede atribuir su ausencia exclusivamente al filtro de confirmación. El botón
Guardar diagnóstico ahora pide la secuencia intentada y conserva ese texto
en `expected`, separado del nombre seguro del archivo. Incluye además una
revisión del pipeline para distinguir trazas anteriores a las correcciones.
La etiqueta no fuerza predicciones ni activa un modo manual de deletreo.

### Respaldo de fronteras para S/Z (2026-10-08)

La traza `signara-traza-SyZ.json` contenía hasta 180 cuadros mezclando intentos,
sin una pausa suficientemente larga para separar sus recorridos. La web ahora
propone una frontera cuando cambia persistentemente la configuración de dedos,
aunque la muñeca siga moviéndose. El cambio por sí solo **no corta**: primero
se consulta el recorrido entero. Una letra móvil válida o una postura estática
asentada conserva esa lectura. Solo ante una lectura no válida se consulta un
único segmento propuesto; solo una letra móvil respaldada puede activar el corte.
Esto evita partir G/S por sus propios cambios de forma y evita extraer N/K de
una postura intermedia. No se buscan cortes por máxima probabilidad ni se
limita el recorrido a 24 cuadros. Los votos consecutivos siguen siendo necesarios.

El desacuerdo histórico Z / temporal S requiere corroboración temporal; si
la consulta de cadencia tampoco respalda ninguna, se abstiene sin forzar Z ni S.
La regla adicional está acotada a S/Z para conservar la recuperación existente
de G/H/J. La traza v3 registra `shapeStart`, `selectedShapeStart`, la predicción
original y la del respaldo. No cambiaron checkpoints ni datasets.

En las consultas exactas de la traza se recuperan S (21–24) y Z (28–29).
Manteniendo el corte entre consultas también se obtienen dos lecturas
consecutivas de cada letra. **Esto no es una prueba de la confirmación final
en cámara**: siguen interviniendo cambios de dedos, seguimiento y tiempos reales.
En 120 reproducciones completas (10 tomas por letra móvil, dos cadencias),
el respaldo conservó todas las respuestas anteriores. Auditoría reproducible:

```powershell
# Raíz del repositorio, API híbrida activa:
node scripts/audit-spelling-boundaries.mjs
node scripts/replay-spelling-trace.mjs "C:\Users\USER\Downloads\signara-traza-SyZ.json"
npm run test:interpret-temporal
```

Después de reiniciar la API y recargar con Ctrl+F5, probar S/Z alternadas y
nombres con G/H/J. Si sigue fallando, guardar una nueva traza v3 con la
secuencia intentada: estas comprobaciones no garantizan precisión con nuevos
firmantes ni eliminan la necesidad de evaluar velocidades y oclusiones.

### M/N: corroborar la pose actual; Ñ no es el mismo bloqueo (2026-10-08)

En `signara-traza-gmnÑ.json`, M se predice reiteradamente con confianza alta,
pero no se confirma por movimiento/cambio de dedos. En desarrollo v4, si el
recorrido devuelve M/N y existe consenso, la web puede volver a consultar la
pose actual quieta con el checkpoint histórico. Exige la misma letra con al
menos 0.94 de confianza y comprueba otra vez quietud, época del gesto y que
los dedos no hayan cambiado durante la respuesta. No depende entonces de un
solo frame anterior con jitter. No levanta el veto durante movimiento ni
rescata I/J/G/H/Ñ como posturas estáticas.

Si un buffer mezcla M anterior con una N reciente quieta, el híbrido permite
que el mismo checkpoint histórico resuelva esa diferencia con la pose
reciente, solo ante confianza >=0.94 y margen >=0.25. Los candidatos móviles
respaldados mantienen prioridad y reciben todo el recorrido como antes.

La pose guardada permite corroborar M en consultas 24–27 de esta traza; eso
no reproduce todos los frames llegados después de la respuesta en cámara.
**No contiene ninguna predicción Ñ ni H**: no demuestra un bloqueo de Ñ ni
la confusión G→H reportada. La Ñ temporal ya pasa un filtro distinto; no se
corrigió una etiqueta sustituyendo M/N por Ñ. Falta un ensayo aislado de Ñ
y uno de G para estudiar sus errores de clasificación sin los intentos previos.

### Revisión v5: N visible, trayectorias y rebote (2026-10-08)

Las nuevas trazas `m` y `NsalecomoGÑ` son v4; `gmnÑ` adjunta de nuevo la
traza antigua v3. En la de N, las consultas 14–23 devuelven N (0.90–0.998),
pero no se confirma por `pose_still_moving`. Las puntas se desplazan/giran
aunque las extensiones de los dedos recientes permanezcan estables.

v5 agrega una comprobación **solo para M/N**: ocho cuadros con configuración
de dedos estable, desplazamiento de muñeca reciente pequeño relativo a la
mano, comparación con los dedos actuales y dos respuestas concordantes con
confianza mínima 0.94. No exige inmovilidad de todas las puntas. En replay,
la consulta 15 ya pasa esta comprobación; no es una simulación completa de
latencia/cámara y no significa que N/Ñ estén lingüísticamente resueltas.

El final de una consulta no equivale automáticamente al final del trazo.
El bloqueo de una letra móvil puede anclarse a su final asentado si mantiene
la configuración, sin usar el resto de G como otra G. Para otro trazo de
igual forma, se mide el recorrido de muñeca relativo a la mano; una mediana
de tres descarta saltos aislados **solo en el antirrebote**, nunca en los
landmarks enviados al modelo. Ya no se exige un salto absoluto de 0.024 para
desbloquear un trazo lento. Las letras de secuencia requieren dos votos también
en consultas finalizadas. La detección solicita 640×480 en lugar de 320×240;
la resolución efectiva y la fluidez deben verificarse en el dispositivo.

El híbrido veta G cuando los cuatro dedos están persistentemente rectos,
contradiciendo las G del corpus actual; no convierte esa geometría en N.
En la consulta 25 de N deja de responder G, pero devuelve P: queda un error
de clasificación, no una etiqueta corregida artificialmente.

La Ñ falsa durante preparación de M sigue existiendo en el replay. Un veto
experimental por desacuerdo de cadencia empeoró H y Ñ completas y se retiró.
No se debe anunciar esa confusión como resuelta ni forzar Ñ↔N↔M. El clasificador
de clips aún no fue entrenado como segmentador de transiciones/gestos parciales.
Se necesitan ensayos identificados de Z/H y S para estudiar sus fallos actuales;
estas trazas no constituyen una matriz de confusión etiquetada de esas letras.
v5 añade `staticFingerPoseSettled` y `requestLatencyMs` a los diagnósticos.

Verificación offline: 49 pruebas de backend, pruebas temporales, lint y build.
En 10 tomas completas por letra y dos cadencias, H/J/S/Z/Ñ mantienen 10/10;
G conserva 9/10 normal (una abstención) y 10/10 doble. Las 126 respuestas de
posturas estáticas coinciden con legacy y las nueve palabras canónicas no
cambian. Son replays que pueden incluir entrenamiento, **no precisión en
cámara**. No se modificaron checkpoints, grabaciones ni datasets.

### Revisión v6: preparación de Z y falsas Ñ al entrar (2026-10-08)

Las nuevas trazas N/M/Z son v5. N y M comparten las primeras consultas: el
diagnóstico es acumulativo, no todas las consultas del archivo M son intentos
M. Las Ñ confirmadas en estas consultas corresponden a subir/entrar con la
mano de manera monotónica. El híbrido ahora exige una vuelta de muñeca
relativa a la palma para respaldar Ñ: la mediana de tres cuadros solo mide
este criterio, nunca modifica el recorrido enviado al modelo. No sustituye
Ñ por N/M ni demuestra por sí sola que cualquier vaivén sea Ñ.

En Z, el medio estaba plegado durante seis cuadros de preparación. Una única
frontera geométrica permite consultar el recorrido con la forma ya armada,
sin buscar cortes por confianza. El movimiento grande de escritura de esta
Z contradice las H del corpus revisado. La consulta 14 ahora se abstiene y
la 15 devuelve Z; con tres y seis cuadros siguientes del mismo recorrido
también devuelve Z. La web conserva esa frontera en el buffer sin perder los
cuadros llegados durante la petición. `preparationFrames` queda en el diagnóstico.
No hay una sustitución automática H→Z.

**Pendiente importante:** la N sostenida de esta traza sigue siendo clasificada
como M por el checkpoint histórico (7 de 10 sondeos de pose reciente). La N
aparece al entrar, pero no debe confirmarse una forma intermedia en movimiento
para ocultar ese error. La M reciente sí recibe M y es confirmable en replay.
Un sondeo corto durante otro traslado de M aún devuelve Ñ: el nuevo criterio
no es un segmentador aprendido ni elimina todas las transiciones ambiguas.
No prometer M/N/Ñ perfectas ni bajar umbrales. Para resolver clasificación
residual se necesita revisar ejemplos M/N etiquetados, oclusión del pulgar y
distribución captura/web; después, si corresponde, reentrenar con ejemplos
representativos y transiciones negativas. No pedir 100 tomas a ciegas.

Verificación: 52 pruebas backend, temporales JS, lint y build correctos.
Replay de 10 tomas completas por letra en dos cadencias conserva H/J/S/Z/Ñ
10/10; G 9/10 normal (abstención), 10/10 doble. Las 126 respuestas estáticas
coinciden con legacy y las nueve palabras canónicas no cambian. La separación
JS conserva respuestas en 120 replays. **Son comprobaciones de compatibilidad
con corpus, no precisión en cámara ni confirmación completa de las trazas.**
API reiniciada con ambas ramas activas; checkpoints y grabaciones intactos.

### Revisión v7: separar intentos y corroborar N/M/Ñ (2026-10-08)

Se implementa la variante indicada por la usuaria: N = índice/medio hacia
abajo; M = índice/medio/anular hacia abajo; Ñ = péndulo lateral de los dos
primeros dedos. No se presenta como una definición universal del alfabeto.

- La separación detecta una meseta de muñeca/postura aun con jitter ligero,
  y conserva dos cuadros previos al arranque del siguiente intento. Exige
  evidencia independiente: duplicar cuadros no convierte una esquina de Z
  en pausa. No busca cortes que maximicen la confianza del clasificador.
- Ñ exige orientación de índice/medio hacia abajo y una ida/vuelta lateral
  de amplitud real en AMBAS puntas. No basta un retroceso de muñeca ni sumar
  muchos retrocesos diminutos. Tres dedos claramente extendidos de forma
  persistente contradicen esta variante; anular/meñique ambiguos no imponen
  un conteo rígido. Las pérdidas breves de seguimiento se toleran solo en
  esta comprobación; los landmarks enviados a la red no se alteran.
- N/M cuentan con una corroboración auxiliar de ocho cuadros recientes:
  forma, orientación, estabilidad y muñeca asentada. Solo redistribuye masa
  dentro de M/N/Ñ cuando la rama histórica ya respalda esa familia (>=0.80).
  `recognition_source=verified_finger_pose` y `pose_evidence` identifican esa
  intervención. Su score NO es un posterior neuronal nuevo/calibrado; no se
  reentrenaron pesos ni se cambia M→N por una tabla de sustituciones.
- La web comprueba la misma anatomía también en la mano actual y conserva
  dos consultas concordantes. Una respuesta tardía no valida otra postura.
  N→Ñ y otra Ñ pueden abrirse con un péndulo de las puntas aunque la muñeca
  se mueva poco, conservando TODO ese nuevo recorrido. Desbloquear no emite
  una letra: siguen siendo necesarias las comprobaciones de la API.
- El diagnóstico v7 conserva hasta 120 consultas/900 cuadros y registra
  `poseEvidence` y `verifiedFingerPoseSettled`. Es una cola limitada, no una
  grabación completa ni un video etiquetado. `/health` identifica v7.

Resultados: 62 pruebas backend, pruebas temporales JS, lint y build pasan.
La separación conserva las respuestas en 120 replays de tomas móviles a
cadencia original/doble. En el replay de `todasmal`, G es confirmable con un
segmento de 23 cuadros (antes acumulaba 173), y las consultas 27/28 antes Ñ
devuelven M. Las poses asentadas de la traza N reciben N por corroboración;
dos sondeos M residuales ocurren con dedos/recorrido aún no asentados y no
pasan esas comprobaciones de confirmación. No equivale a simular toda la
latencia, desbloqueos, ni confirmación de cámara. La traza recortada no prueba
que todas las H iniciales perdidas hayan quedado recuperadas.

En 10 tomas completas por letra y dos cadencias: H/J/S/Z 10/10, G 9/10 normal
(una abstención), 10/10 doble; Ñ 9/10 (una abstención) en ambas cadencias.
La comprobación geométrica admite 98/100 Ñ completas: una tiene pérdida de
seguimiento importante y otra retorno insuficiente. Las 126 respuestas de
poses estáticas seleccionadas y nueve palabras canónicas se conservan.
Estos datos pueden incluir entrenamiento: NO son precisión con firmantes
nuevos ni garantía de reconocimiento perfecto. La comprobación no puede
reconstruir un anular que MediaPipe estima doblado en una M real; hace falta
verificar cámara/oclusión antes de pedir nuevas tomas o reentrenar.

Para probar: recargar con Ctrl+F5, activar cámara, ensayar por separado
G/H/M/N/Ñ/Z como primera letra y después A→G→H→M→N→Ñ→Z sin retirar la mano.
Mantener N y M un momento sin moverlas: no deben aparecer Ñ ni duplicados;
hacer Ñ en ambos sentidos. Exportar diagnóstico si persiste una confusión,
anotando el orden de los intentos. API híbrida y secuencia activas en :8000;
web en http://127.0.0.1:5173/. No se sobrescribieron datasets, animaciones ni
checkpoints.

### Revisión v8: primera H/G y Ñ durante el recorrido (2026-10-08)

La usuaria confirma M/N correctas con v7: se conserva su corroboración y la
validación de postura actual. No se reentrenaron ni sustituyeron checkpoints,
grabaciones o datasets.

- Se encontró un bloqueo previo a la lectura temporal: una H podía recibir
  COMO_ESTAS por la rama histórica y nunca llegar al especialista de recorrido.
  En el prefijo examinado, a 15 cuadros, ambas lecturas temporales daban H
  (>99 %) aunque los sondeos de formas no aportaban mayoría alfabética. Ahora
  G/H/Ñ pueden resolver esa contradicción solo con acuerdo temporal/cadencia
  y forma compatible. Una sola mano no confirma las variantes registradas
  de COMO_ESTAS/FAMILIA, que requieren dos, mientras falta esa evidencia.
- Se elimina el límite superior de amplitud que vetaba H. Se conserva la
  comprobación de índice/medio y la separación de la formación inicial de
  los dedos; esa preparación también se comprueba para G y Ñ. No se buscan
  cortes de máxima confianza ni se sustituye toda Z por H. G exige índice
  extendido y conserva su veto de cuatro dedos completamente rectos.
- Consultas provisionales a partir de 90 ms, con al menos tres cuadros nuevos;
  la misma muestra final no genera otra consulta. Siguen siendo necesarias
  dos respuestas concordantes y los mismos umbrales de confirmación. No
  equivale a garantizar 90 ms de latencia: dependen de cámara, API y consenso.
- Nuevo respaldo auxiliar `verified_finger_pendulum`: cuando ambas redes
  respaldan M/N/Ñ con masa >=0.90 pero no hay una letra móvil temporal válida,
  exige dos dedos hacia abajo durante >=75 % de los cuadros, retorno lateral
  real de AMBAS puntas y desplazamiento horizontal dominante en ambas.
  No actúa ante una palabra, tres dedos claros, N quieta o traslado vertical.
  Los candidatos temporales válidos tienen prioridad. La corroboración de Ñ
  neuronal conserva su tolerancia anterior a la oclusión; el respaldo es más
  estricto porque está aportando una decisión nueva, no solamente un veto.
  `pose_evidence` informa soporte y masa de las dos redes. Este score auxiliar
  NO es un posterior neuronal calibrado ni significa que la red aprendió Ñ.

71 pruebas backend, pruebas temporales JS, lint y build pasan. La separación
conserva las respuestas en 120 replays de tomas móviles. Replay de 10 tomas
completas por letra: H/J/S/Z 10/10 normal/doble; G 9/10 normal (abstención),
10/10 doble; Ñ 9/10 en ambas cadencias (abstención). Se conservan 126 respuestas
estáticas seleccionadas y las nueve palabras canónicas. Son compatibilidad
con un corpus que puede incluir entrenamiento, NO precisión en cámara.

En el diagnóstico disponible `signara-traza-k.json` (v7; campo expected=k;
sin orden humano verificado por consulta), los recorridos 70/72/76 con dos
dedos hacia abajo y péndulo antes daban M/N: ahora dan Ñ con score auxiliar
0.999/0.959/0.975. Las H comprobadas 34/37/38/118/119 se conservan; el recorrido
ambiguo 112 sigue sin emitir una letra. No atribuir automáticamente todas
esas consultas a intentos humanos Ñ ni declarar resuelta la prueba en vivo.

API reiniciada, `/health` = `first-motion-letters-v8`; web =
`spelling-attempts-v8`. Probar tras Ctrl+F5: H, G, Ñ como primeras letras por
separado; A→H→G→N→Ñ→M sin retirar la mano; Ñ en ambos sentidos; N/M quietas
sin Ñ ni spam; Z para descartar regresión. Falta validar estas pruebas reales.

### Revisión web v9: no borrar consenso al recortar el mismo trazo (2026-10-08)

La traza nueva `signara-traza-v8.json` confirma un fallo de separación en
la web, no ausencia de la clase Ñ. Consultas 35/36: la API devuelve Ñ
0.867/0.991; el detector recorta siete cuadros antes de la segunda y borra
el voto anterior. La siguiente consulta cae a 0.810 y no pasa el umbral.
Tras eso se acumulan hasta 146 cuadros del intento no confirmado.

`retainMotionVotesAfterBoundary` conserva un voto móvil únicamente si el
segmento restante comparte al menos seis cuadros reales y la mitad de la
consulta previa, contiene movimiento y mantiene el último cuadro de esa
consulta. No conserva votos estáticos, otra secuencia por parecido, una cola
quieta ni pocos cuadros del intento anterior. Se aplica a separación por
pausa, por cambio de dedos y a preparación geométrica de la API. Siguen
exigiéndose dos lecturas concordantes; clases, pesos y umbrales no cambian.

La consulta 68 de G tenía 151 cuadros: el respaldo geométrico encuentra un
inicio en 140 y lee los 11 restantes. Antes se esperaba al fracaso de la
consulta completa para hacer otro viaje de red (latencia registrada 759 ms).
`prefetchSpellingBoundary` permite consultar UNA frontera geométrica en
paralelo para buffers largos de >=48 cuadros, solo en flujo alfabético.
La lectura válida del recorrido completo sigue teniendo prioridad: una
frontera rápida no reemplaza G/S/H/etc. por otra letra ni busca máxima
confianza. El respaldo fallido no invalida una consulta principal válida.
Esto elimina una dependencia secuencial, no garantiza una latencia en vivo
ni elimina los desacuerdos G/S provisionales del propio clasificador.

Verificación: 71 pruebas backend, pruebas temporales JS, lint y build pasan;
120 replays de separación conservan las respuestas. La prueba read-only
`scripts/test-spelling-v8-regression.mjs <ruta/signara-traza-v8.json>` verifica
la frontera real 7, conserva el consenso Ñ 0.867/0.991 y el respaldo G
151→11 con un solo sondeo de frontera. No simula todos los desbloqueos,
consultas que se habrían omitido al confirmar Ñ, ni latencia de cámara.
La traza no está etiquetada por intento (expected=v8): no atribuir todas sus
letras a un orden humano no proporcionado. H/S/Z/M/N exitosas se preservan.

Web servida = `spelling-boundaries-consensus-v9`; `/health` mantiene
`first-motion-letters-v8` porque esta corrección NO modifica la API/modelos.
El diagnóstico ahora incluye `consensusVotes`. Recargar Ctrl+F5 y comprobar
N→Ñ→G sin retirar la mano, Ñ como primera letra en ambos sentidos y N/M
quietas sin Ñ ni duplicados. Faltan esas pruebas en vivo; no pedir más tomas
a ciegas para resolver el bug de consenso.

### Diagnóstico v9: G/J restringidas; Ñ mejora en cámara (2026-10-08)

El usuario informa salida `GNMÑMJHSZR`, G/J dependientes de una ejecución
específica y Ñ considerablemente mejor, aunque una vez confundida con M.
La salida coincide exactamente con los diez eventos aceptados del JSON.
`expected=v9` no etiqueta intentos humanos. No asumir que el orden de salida
es el orden intentado; se pidió esa aclaración antes de asignar fallos por clase.

En las consultas 0..24 el buffer crece de 60 a 164 cuadros. La forma permite
G (índice extendido), pero la red temporal devuelve otras clases. Tras una
frontera geométrica, 25..27 usan 11/15/19 cuadros y terminan confirmando G.
Esto demuestra acumulación y respuestas neuronales incorrectas/ambiguas;
NO que la web recorte el recorrido a 24 ni que el veto de forma bloquee G.

Consultas 55..58: meñique extendido (~0.99), índice plegado (~0.45), compatibles
con las tomas J; la red temporal predice G con >0.99. El veto de G evita
emitirla en esa forma. Quitar ese veto no enseña J: permitiría otra confusión.
Sin etiquetas humanas no afirmar todavía que cada consulta era un intento J.

Auditoría read-only: las 100 tomas completas G y las 100 J son de `alanis`,
50 en cada slot de mano. Sus medianas de duración son 15 cuadros; rangos
G 10..28 y J 8..23. La anatomía fue medible en 97 G y 92 J con los controles
actuales. `SequenceDataset` entrega entradas originales preprocesadas, sin
augmentación temporal ni de amplitud; la separación de validación comparte
firmante. Esto es un riesgo de generalización, no prueba de que añadir
augmentación por sí sola corrija todos los intentos.

Ruta pendiente: etiquetar intentos reales de G/J; evaluar límites de gesto
sin cortar inflexiones internas ni elegir cortes por máximo softmax;
comparar ejecuciones naturales con captura y preparar un candidato con
variaciones controladas de cadencia/amplitud y validación independiente.
Las tomas nuevas deben aportar diversidad, no repetir cien veces la misma
ejecución. No se cambian pesos, umbrales, segmentación ni reconocimiento
en esta revisión; preservar Ñ/M/N/H/S/Z y no declarar resuelto G/J.

### Comparación histórica tras reporte de regresión G/J (2026-10-08)

El usuario recuerda que G/J salían antes: revisar primero regresiones, no
atribuir automáticamente el cambio a poca variedad de datos. Se reconstruyó
en memoria `hybrid_recognizer.py` justo antes del mensaje «La G J y H bien,
j sigue floja» (transcript line 8220), sin reemplazar archivos. Los checkpoints
actuales tienen fechas 7 de octubre; no se reentrenaron durante los ajustes
del 8 de octubre. El código histórico tiene 189 líneas.

Comparación con idénticos cuadros: en v9, consultas 0..27 de la primera G y
71/72 de la J aceptada tienen las mismas respuestas en ambas rutas. De las
120 consultas v9 cambian 28 (incluyendo scores/procedencia), principalmente
las comprobaciones anatómicas M/N/Ñ y el nuevo veto de G. En 55..68, muchas
G aceptables por la ruta antigua se rechazan ahora porque el índice está
plegado y el meñique recto. Eso es compatible con J, pero sin etiquetas
humanas no convertir esta compatibilidad en certeza de intención.
Restaurar toda la ruta antigua recuperaría también estas respuestas G y las
Ñ sin péndulo que motivaron ajustes anteriores.

Comparación de fronteras JS antiguas/actuales sobre consultas guardadas:
v9 solo difiere en q54 (43 cuadros: corte antiguo 29, actual 0); esto NO
explica por sí solo la primera G. En v8 difieren q9/14/103; en k q9/50.
La comprobación de cadencia omitida tras un veto primario existe, pero en
las 360 consultas de k/v8/v9 no se encontró una alternativa móvil compatible
que esa salida temprana estuviera descartando. No presentarla como causa
demostrada ni cambiar el reconocimiento por ese motivo.

Ensayo read-only de prefijos con dos votos, sobre las primeras 20 tomas
completas de G y 20 de J, densidad original/doble y ocho cuadros finales
sostenidos: 40 casos por letra, cero pérdidas de reconocimiento respecto
al backend histórico. NO simula cámara, latencia, desbloqueo ni demuestra
precisión independiente (tomas posiblemente de entrenamiento).

Cambio de adquisición pendiente de aislar: cámara/inferencia pasó de
320×240 a 640×480 después del reporte favorable. Puede cambiar landmarks
y cadencia, pero las trazas no contienen píxeles ni timestamps por cuadro
para repetir esa comparación. No afirmar todavía que esa resolución es
la causa. Falta contraste controlado de adquisición/segmentación con
intentos humanos identificados; no pedir regrabar cien tomas ni reentrenar
como requisito previo. `17_spelling_regression_audit.py` conserva la
comparación read-only reproducible contra fuentes históricas. Ningún cambio
en reconocimiento/cámara/pesos se activó en esta revisión.

### Traza v10: recuperación comprobada de H y corroboración robusta de Ñ

La nueva traza sí demuestra la salida temprana que no aparecía en las
anteriores: q33/34 (18 cuadros) dan J temporal con 98 %, pero el meñique
está plegado; a media cadencia el mismo recorrido da H 99,94 % y el
checkpoint de formas coincide en H. Se consulta esa alternativa antes
de abandonar, exigiendo coincidencia independiente y dedos compatibles.
No se baja ningún umbral ni se permite rescatar J por su forma sola.

En el final de v10 hay dos dedos hacia abajo y retorno lateral; la lectura
auxiliar de Ñ se descartaba por extremos verticales de puntas reconstruidas.
Ahora comprueba el rango percentil 10..90 de cuadros con configuración
inequívoca, retorno en ambas puntas y correlación lateral >= .85. La red
recibe todos los cuadros sin cambios; la familia M/N/Ñ debe seguir respaldada
por ambos checkpoints. No es una probabilidad neuronal nueva/calibrada.

Verificación: 75 tests Python, test temporal JS y ESLint pasan. Repetición
de todas las consultas de v8/v9: cero cambios de etiqueta. En v10 se
recuperan H en q33/34 y Ñ al final; las cinco consultas originalmente
aceptadas mantienen su etiqueta. Eso NO simula confirmación/desbloqueo
en cámara y no elimina todavía el retraso de Ñ.

G/J siguen pendientes: en ventanas compatibles con J, el temporal completo
devuelve POR_FAVOR/SI mientras la rama local da J. La rama local elimina
traslación y no puede usarse como prueba del trazo. La traza solo conserva
120 consultas finales, sin anotación por intento; no demuestra todos los
primeros intentos G. No cambiar etiquetas ni restaurar toda la ruta vieja
para ocultarlo. No se reentrenó ni modificó ningún checkpoint/dataset.

### N→G/Ñ y Ñ→M en las nuevas trazas (2026-10-08)

Los archivos `g`, `n` y `ñ` comparten consultas iniciales: exportar no
reiniciaba el diagnóstico. El nombre del archivo no etiqueta cada intento.
Ahora cada exportación vacía solamente los registros diagnósticos e incluye
`backendRevision`; no toca el buffer de inferencia ni el deletreo.

En q1/2 de ese inicio, dos dedos permanecen hacia abajo y la red temporal
da G, aunque la rama local da N. Las 100 G completas del corpus carecen
de esa configuración sostenida. G ahora rechaza esa contradicción
(>=65 % de cuadros con índice/medio extendidos hacia abajo). Al rechazarla
se conserva la lectura completa, no la P de su cola móvil: q1 G→N y q2
se abstiene. No se fuerza una etiqueta a partir del nombre de la traza.

Ñ antes solo exigía retorno X, aceptando q7/8 de entrada de N. Ahora ambas
puntas deben retornar coherentemente (correlación >=.85) y su componente
horizontal robusta común dominar la vertical corroborada por al menos una
punta. Un salto Y independiente no decide el eje. La comprobación auxiliar
cuenta votos anatómicos inequívocos: cobertura >=65 %, dos dedos >=60 %,
contradicción de tres <=20 %, soporte condicional >=75 %. Los desconocidos
no votan M ni se eliminan de la entrada neuronal. El score auxiliar y sus
coberturas tienen procedencia explícita; no son probabilidades neuronales
nuevas/calibradas.

Replay del intento posterior de Ñ: q22/23 (23/28 cuadros) cambian M→Ñ,
con scores auxiliares .888/.909 y pasan la puerta JS de dos votos móviles.
Las J aceptadas en la nueva traza se conservan, igual que las consultas
aceptadas M/N/S/Z/H/G de v8/v9. No equivale a exactitud en cámara.
Comparación read-only de 20 tomas completas por letra: G/H/J/S/Z mantienen
20/20 etiquetas correctas antes/después. Ñ pasa de19/20 a18/20: Ñ_111 tiene
recorrido vertical dominante y ahora se abstiene. Ese coste está identificado:
necesita revisión de la variante/toma con ejecución humana, no declarar Ñ
perfecta ni la captura errónea sin video.

79 pruebas Python, prueba temporal JS, ESLint y build pasan. Checkpoints
con los mismos hashes; no se entrenó ni borraron datos. API activa:
`downward-pair-coherent-pendulum-v11`. La G natural del usuario sigue
pendiente de identificar por intento: se pidió aclaración sobre el gesto
compartido al inicio de las trazas, sin forzar G desde el nombre del archivo.

### v13: M extra antes de N y N provisional antes de Ñ (2026-10-08)

El usuario confirma que todas las letras ya salen; no cambiar los pesos,
la adquisición ni los filtros móviles. En q17, el recheck de ocho cuadros
recientes con dos dedos hacia abajo llamaba a `/predict` legado y obtenía
M .9997. Esos mismos ocho cuadros en `/predict/sequence` dan N .9998 con
corroboración anatómica. El recheck ahora usa esa ruta híbrida sin remuestreo
cuando la secuencia está activa; rechaza rescatar M si la pose reciente es N.
No reetiqueta una respuesta antigua directamente.

q21 confirma N con dedos estables pero puntas todavía en movimiento.
q25 termina dando Ñ .999. Rechazar N sin conservar el reinicio/desbloqueo
actual mezcla su preparación vertical con el péndulo posterior: el replay
de los segmentos acumulados devuelve M en lugar de Ñ. Mantener por tanto
el flujo interno que funciona y diferir SOLO la salida de una N no asentada.
No mostrarla ni enviarla a voz/historial mientras sea provisional. Si se
sostiene como N quieta en varios cuadros, se confirma; si el siguiente
gesto corroborado es Ñ, resuelve únicamente esa N provisional. Una N ya
asentada antes de Ñ se conserva. No eliminar retrospectivamente cualquier
N ni afirmar que se puede inferir la intención de toda transición.

`test-spelling-v13-regression.mjs` reproduce la M errónea del recheck viejo,
su rechazo nuevo y las entradas guardadas de G/M/N/Ñ sin alterar sus etiquetas.
Comprueba que el tramo posterior a q21 no asienta N antes de q25; la salida
resuelta es G M N Ñ. NO es simulación completa de cámara/latencia/desbloqueo:
al cambiar una aceptación también cambian las consultas futuras en vivo.
Falta confirmar la nueva sesión con M→N→Ñ y Ñ como primera letra.
Pruebas temporales JS, 79 pruebas Python, ESLint y build pasan; hashes de
ambos checkpoints intactos. Frontend `spelling-provisional-n-v12`, backend
sin cambios `downward-pair-coherent-pendulum-v11`.
