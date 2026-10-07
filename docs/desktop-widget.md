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
6. Una pausa breve confirma
   el fragmento aunque WebView2 no lo marque formalmente como final.
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
- Interfaz mínima con un único control de micrófono.
- Cámara flotante responsive con salida solo por voz y sin texto reconocido.
- Ventana incremental: unidades pendientes y confirmadas.
- Memoria v1 de tema, tiempo, intención, pronombres/referentes y expresión facial.
- Deletreo como respaldo cuando el significado existe pero falta su animación.

## Lo que sigue pendiente

- Captura nativa del audio del sistema (Teams, Meet, YouTube).
- ASR nativo/local cuando WebView2 no exponga Web Speech.
- Aplicar los modificadores faciales de SignPlan al VRM en tiempo real.
- Planificador gramatical LSC validado por comunidad sorda/intérpretes.
- Memoria de loci de terceras personas basada en el discurso completo.
