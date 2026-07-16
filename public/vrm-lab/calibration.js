/**
 * calibration.js — Calibración en vivo de mapeo Kalidokit → VRM
 * Cada eje es un multiplicador (recomendado: -3 … +3). Valores >5 distorsionan la muñeca.
 */

const WRIST_DEFAULT = {
    x: -3.4, y: -0.4, z: 0.1,
    poseZ: 0.35,
    blend: 0.7,
    offset: { x: 0, y: 0, z: 0 },
};

export const DEFAULT_CALIB = {
    wristRight: JSON.parse(JSON.stringify(WRIST_DEFAULT)),
    wristLeft:  JSON.parse(JSON.stringify(WRIST_DEFAULT)),
    pose: {
        RightUpperArm: { x: -1.5, y: 1.2, z: -1.3 },
        RightLowerArm: { x: 0.6, y: 2.0, z: -1.2 },
        LeftUpperArm:  { x: -0.9, y: 1.3, z: -1.6 },
        LeftLowerArm:  { x: -4.0, y: -2.0, z: -1.2 },
        Chest:         { x: 0.15, y: 0.15, z: 0.15 },
        Neck:          { x: 0.25, y: 0.25, z: 0.25 },
    },
    fingers: { x: -1.5, y: -1.2, z: -1.4 },
    thumb:   { x: 1, y: 1, z: 1 },
};

export const CALIB = JSON.parse(JSON.stringify(DEFAULT_CALIB));

/** Calibración optimizada para JSON grabados (landmarks MediaPipe, sin cámara).
 *
 * NOTA sobre los signos de X en los brazos:
 *   En animations.js el comentario es: rightUpperArm.x +0.5 = adelante, -0.5 = atrás
 *   Kalidokit produce X positivo para "brazo al frente". Si multiplicamos por un
 *   número NEGATIVO, el brazo termina yendo detrás del avatar.
 *   → Los X de los brazos van con signo POSITIVO para que la seña aparezca al frente.
 */
export const DATASET_CALIB = {
    wristRight: { x: -2.4, y: -0.35, z: 0.12, poseZ: 0.32, blend: 0.6, offset: { x: 0, y: 0, z: 0 } },
    wristLeft:  { x: -2.4, y: -0.35, z: 0.12, poseZ: 0.32, blend: 0.6, offset: { x: 0, y: 0, z: 0 } },
    pose: {
        RightUpperArm: { x: 1.3,  y: 1.15, z: -1.2 },   // X+ → adelante
        RightLowerArm: { x: -0.55, y: 1.75, z: -1.1 },  // signo opuesto al hombro
        LeftUpperArm:  { x: 0.85, y: 1.25, z: -1.45 },  // X+ → adelante
        LeftLowerArm:  { x: 2.5,  y: -1.6, z: -1.1 },   // signo opuesto al hombro
        Chest:         { x: 0.12, y: 0.12, z: 0.12 },
        Neck:          { x: 0.2, y: 0.2, z: 0.2 },
    },
    fingers: { x: -1.25, y: -1.05, z: -1.15 },
    thumb:   { x: 1, y: 1, z: 1 },
};

let _playbackCalib = false;

export function getActiveCalib() {
    return _playbackCalib ? DATASET_CALIB : CALIB;
}

export function setPlaybackCalib(on) {
    _playbackCalib = !!on;
    if (typeof window !== 'undefined') window.CALIB = getActiveCalib();
}

/** Calibración de muñeca por mano: 'right' | 'left' (VRM) */
export function getWristCalib(vrmSide) {
    const c = getActiveCalib();
    return vrmSide === 'right' ? c.wristRight : c.wristLeft;
}

const POSE_LABELS = {
    RightUpperArm: 'Brazo der. (hombro)',
    RightLowerArm: 'Antebrazo der.',
    LeftUpperArm:  'Brazo izq. (hombro)',
    LeftLowerArm:  'Antebrazo izq.',
    Chest:         'Pecho',
    Neck:          'Cuello',
};

const STEP = 0.1;

function round1(v) { return Math.round(v * 10) / 10; }

function setAxis(obj, axis, val) {
    obj[axis] = round1(val);
    if (typeof window !== 'undefined') window.CALIB = CALIB;
}

function makeStepBtn(text, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    Object.assign(b.style, {
        width: '26px', height: '26px', padding: '0', borderRadius: '6px',
        border: '1px solid rgba(80,140,255,0.35)', background: 'rgba(61,127,255,0.15)',
        color: '#88aaff', cursor: 'pointer', fontSize: '14px', fontWeight: '700',
        fontFamily: "'DM Sans',sans-serif", lineHeight: '1',
    });
    b.addEventListener('click', fn);
    return b;
}

function makeNumInput(obj, axis) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = '0.1';
    inp.value = obj[axis];
    Object.assign(inp.style, {
        width: '54px', padding: '4px 2px', textAlign: 'center',
        borderRadius: '6px', border: '1px solid rgba(80,140,255,0.3)',
        background: 'rgba(12,22,50,0.85)', color: '#00d4aa',
        fontFamily: "'DM Sans',sans-serif", fontSize: '12px', fontWeight: '600',
    });
    inp.addEventListener('change', () => {
        setAxis(obj, axis, parseFloat(inp.value) || 0);
        inp.value = obj[axis];
    });
    inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!Number.isNaN(v)) setAxis(obj, axis, v);
    });
    return inp;
}

function addAxisBlock(container, title, obj) {
    const sec = document.createElement('div');
    Object.assign(sec.style, {
        marginBottom: '10px', paddingBottom: '8px',
        borderBottom: '1px solid rgba(80,140,255,0.12)',
    });

    const h = document.createElement('div');
    h.textContent = title;
    Object.assign(h.style, {
        fontSize: '11px', fontWeight: '600', color: '#88aaff',
        marginBottom: '5px', fontFamily: "'Syne',sans-serif",
    });
    sec.appendChild(h);

    const grid = document.createElement('div');
    Object.assign(grid.style, {
        display: 'grid', gridTemplateColumns: '18px 1fr 1fr 1fr', gap: '4px', alignItems: 'center',
    });

    const hdr = ['', 'X', 'Y', 'Z'];
    hdr.forEach((t, i) => {
        const s = document.createElement('span');
        s.textContent = t;
        Object.assign(s.style, {
            textAlign: i === 0 ? 'left' : 'center',
            fontSize: '10px', color: 'rgba(180,200,255,0.45)',
        });
        grid.appendChild(s);
    });

    const lbl = document.createElement('span');
    lbl.textContent = '×';
    Object.assign(lbl.style, { fontSize: '10px', color: 'rgba(180,200,255,0.45)' });
    grid.appendChild(lbl);

    ['x', 'y', 'z'].forEach(axis => {
        const cell = document.createElement('div');
        Object.assign(cell.style, { display: 'flex', gap: '2px', justifyContent: 'center', alignItems: 'center' });
        const inp = makeNumInput(obj, axis);
        cell.appendChild(makeStepBtn('−', () => { setAxis(obj, axis, obj[axis] - STEP); inp.value = obj[axis]; }));
        cell.appendChild(inp);
        cell.appendChild(makeStepBtn('+', () => { setAxis(obj, axis, obj[axis] + STEP); inp.value = obj[axis]; }));
        grid.appendChild(cell);
    });

    sec.appendChild(grid);
    container.appendChild(sec);
}

function addBlendSlider(container, wristObj, label) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { margin: '-4px 0 10px', fontSize: '10px', color: 'rgba(180,200,255,0.55)' });
    const lbl = document.createElement('div');
    lbl.textContent = `${label}: ${(wristObj.blend ?? 0.1).toFixed(2)}`;
    Object.assign(lbl.style, { marginBottom: '3px' });
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = '0'; inp.max = '1'; inp.step = '0.05';
    inp.value = wristObj.blend ?? 0.1;
    inp.style.width = '100%';
    inp.addEventListener('input', () => {
        wristObj.blend = parseFloat(inp.value);
        lbl.textContent = `${label}: ${wristObj.blend.toFixed(2)}`;
    });
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    container.appendChild(wrap);
}

export function getCalibrationExport() {
    const payload = JSON.parse(JSON.stringify(CALIB));
    const js = [
        '// ── Calibración LSC — pegar en calibration.js (DEFAULT_CALIB) ──',
        `export const DEFAULT_CALIB = ${JSON.stringify(payload, null, 4)};`,
        '',
        '// Valores JSON:',
        JSON.stringify(payload, null, 2),
    ].join('\n');
    return { json: JSON.stringify(payload, null, 2), js, payload };
}

export function exportCalibration() {
    const { js } = getCalibrationExport();
    console.log('%c📋 CALIBRACIÓN LSC', 'color:#00d4aa;font-weight:bold;font-size:14px');
    console.log(js);

    const ta = document.getElementById('calibExport');
    if (ta) {
        ta.value = js;
        ta.style.display = 'block';
    }

    const msg = document.getElementById('calibExportMsg');
    if (msg) msg.textContent = '✅ Copiado — pégalo en el chat con Cursor';

    navigator.clipboard.writeText(js).catch(() => {
        if (msg) msg.textContent = '⚠️ Ver consola (F12) — no se pudo copiar';
    });

    return js;
}

export function buildCalibrationUI() {
    if (document.getElementById('calibPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'calibPanel';
    Object.assign(panel.style, {
        position: 'fixed', top: '70px', left: '16px', zIndex: '100',
        width: '268px', maxHeight: 'calc(100vh - 90px)', overflowY: 'auto',
        padding: '14px', background: 'rgba(8,12,22,0.97)',
        border: '2px solid rgba(80,140,255,0.45)', borderRadius: '14px',
        backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        fontFamily: "'DM Sans',sans-serif", color: '#dce8ff', fontSize: '12px',
        scrollbarWidth: 'thin',
    });

    const title = document.createElement('h3');
    title.textContent = '⚙ Calibración en vivo';
    Object.assign(title.style, {
        fontFamily: "'Syne',sans-serif", fontSize: '13px', fontWeight: '700',
        color: '#88aaff', marginBottom: '4px',
    });
    panel.appendChild(title);

    const hint = document.createElement('p');
    hint.textContent = 'Muñeca der./izq. separadas. Slider 3D alto = sigue giros. Exportar al terminar.';
    Object.assign(hint.style, {
        fontSize: '10px', color: 'rgba(180,200,255,0.5)', lineHeight: '1.4', marginBottom: '10px',
    });
    panel.appendChild(hint);

    addAxisBlock(panel, '🖐 Muñeca derecha', CALIB.wristRight);
    addBlendSlider(panel, CALIB.wristRight, '🔄 Mezcla 3D (der.)');
    addAxisBlock(panel, '🖐 Muñeca izquierda', CALIB.wristLeft);
    addBlendSlider(panel, CALIB.wristLeft, '🔄 Mezcla 3D (izq.)');

    for (const [key, label] of Object.entries(POSE_LABELS)) {
        if (CALIB.pose[key]) addAxisBlock(panel, `💪 ${label}`, CALIB.pose[key]);
    }

    addAxisBlock(panel, '✋ Dedos', CALIB.fingers);
    addAxisBlock(panel, '👍 Pulgar', CALIB.thumb);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '6px', marginTop: '8px' });

    const expBtn = document.createElement('button');
    expBtn.type = 'button';
    expBtn.textContent = '📋 Exportar';
    Object.assign(expBtn.style, {
        flex: '1', padding: '9px', borderRadius: '8px', border: 'none',
        background: 'linear-gradient(135deg,#00a884,#00d4aa)', color: '#042',
        fontFamily: "'Syne',sans-serif", fontSize: '12px', fontWeight: '700', cursor: 'pointer',
    });
    expBtn.addEventListener('click', exportCalibration);
    btnRow.appendChild(expBtn);

    const conBtn = document.createElement('button');
    conBtn.type = 'button';
    conBtn.textContent = 'F12';
    conBtn.title = 'Imprimir en consola';
    Object.assign(conBtn.style, {
        padding: '9px 10px', borderRadius: '8px',
        border: '1px solid rgba(80,140,255,0.35)', background: 'rgba(61,127,255,0.12)',
        color: '#88aaff', fontSize: '11px', cursor: 'pointer',
    });
    conBtn.addEventListener('click', () => exportCalibration());
    btnRow.appendChild(conBtn);

    panel.appendChild(btnRow);

    const msg = document.createElement('div');
    msg.id = 'calibExportMsg';
    Object.assign(msg.style, {
        marginTop: '6px', fontSize: '10px', color: 'rgba(0,212,160,0.8)', textAlign: 'center', minHeight: '14px',
    });
    panel.appendChild(msg);

    const ta = document.createElement('textarea');
    ta.id = 'calibExport';
    ta.readOnly = true;
    ta.placeholder = 'La calibración exportada aparecerá aquí…';
    Object.assign(ta.style, {
        display: 'none', width: '100%', height: '120px', marginTop: '8px',
        padding: '8px', borderRadius: '8px', resize: 'vertical',
        border: '1px solid rgba(80,140,255,0.25)', background: 'rgba(0,0,0,0.4)',
        color: '#88aaff', fontFamily: 'monospace', fontSize: '9px', boxSizing: 'border-box',
    });
    panel.appendChild(ta);

    document.body.appendChild(panel);

    if (typeof window !== 'undefined') {
        window.CALIB = CALIB;
        window.exportCalibration = exportCalibration;
    }
}
