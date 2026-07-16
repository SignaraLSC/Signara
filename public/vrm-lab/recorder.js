/**
 * recorder.js — Grabador y replicador de poses LSC via MediaPipe + Kalidokit → VRM
 */
import * as THREE from 'three';
import { getActiveCalib, getWristCalib } from './calibration.js?v=22';
import { buildCalibrationUI } from './calibration.js?v=22';

// ─── Estado ───────────────────────────────────────────────────────────────────
let _vrm         = null;
let _frames      = [];
let _recording   = false;
let _recTimer    = null;
let _interval    = 80;
let _holistic    = null;
let _mpCamera    = null;
let _videoEl     = null;
let _isStreaming  = false;
let _cameraActive = false;
let _lastPose    = null;
let _smooth      = {};       // EMA keyed por bone UUID
const ALPHA      = 0.25;    // 0 = sin suavizado, 1 = máximo suavizado
const ALPHA_FINGER = 0.12;  // dedos más responsivos
const ALPHA_WRIST  = 0.04;  // muñeca: bajo = sigue giros al instante
const ALPHA_PLAYBACK = 0.16; // reproducción JSON: suavizado ligero entre frames
let _lastHandFrame = { right: 0, left: 0 };
let _prevHandZ   = { left: null, right: null };
let _handHold    = { left: null, right: null };
let _qSmooth     = {};    // quaternion EMA por hueso
let _playbackMode  = false;  // reproducción dataset: sin suavizado ni filtro cara
let _bakingMode    = false;  // horneado a keyframes: aplicación instantánea

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initRecorder(vrm) {
    _vrm = vrm;
    buildUI();
    buildCalibrationUI();
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function buildUI() {
    const toggle = document.createElement('button');
    toggle.id = 'recToggle';
    toggle.textContent = '🔴 Grabar seña';
    Object.assign(toggle.style, {
        position:'fixed', top:'16px', right:'24px', zIndex:'30',
        padding:'8px 18px', borderRadius:'999px',
        border:'1px solid rgba(255,80,80,0.4)',
        background:'rgba(160,30,30,0.55)', color:'#ffcccc',
        fontFamily:"'Syne',sans-serif", fontSize:'13px', fontWeight:'600',
        cursor:'pointer', backdropFilter:'blur(8px)', transition:'background 0.2s',
    });
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'recPanel';
    Object.assign(panel.style, {
        position:'fixed', top:'58px', right:'16px', zIndex:'50',
        width:'290px', background:'rgba(8,12,22,0.96)',
        border:'1px solid rgba(255,80,80,0.18)', borderRadius:'16px', padding:'18px',
        display:'none', flexDirection:'column', gap:'11px',
        backdropFilter:'blur(16px)', boxShadow:'0 12px 40px rgba(0,0,0,0.6)',
        maxHeight:'calc(100vh - 80px)', overflowY:'auto',
        scrollbarWidth:'thin',
        color:'#dce8ff', fontFamily:"'DM Sans',sans-serif", fontSize:'13px',
    });
    panel.innerHTML = `
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:15px;color:#ff9999;">
            🎥 Grabador de señas LSC
        </div>

        <div style="position:relative;width:100%;aspect-ratio:4/3;background:#000;border-radius:10px;overflow:hidden;">
            <video id="recVid" style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);" playsinline muted></video>
            <canvas id="recCvs" style="position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);pointer-events:none;"></canvas>
            <div id="recBadge" style="position:absolute;top:7px;left:8px;display:flex;align-items:center;gap:5px;">
                <div id="recDot" style="width:8px;height:8px;border-radius:50%;background:#444;transition:background 0.3s;"></div>
                <span id="recLbl" style="font-size:11px;color:#aaa;">Sin cámara</span>
            </div>
            <div id="handBadge" style="position:absolute;top:7px;right:8px;font-size:10px;color:rgba(0,212,160,0.7);display:none;">✋ manos OK</div>
            <div id="recCounter" style="position:absolute;bottom:7px;right:8px;font-size:18px;font-weight:800;color:#ff4444;display:none;font-family:'Syne',sans-serif;text-shadow:0 0 8px rgba(255,0,0,0.6);">● REC</div>
        </div>

        <button id="camBtn" style="padding:9px;border-radius:9px;border:1px solid rgba(255,80,80,0.3);background:rgba(255,80,80,0.12);color:#ffaaaa;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;">
            ▶ Iniciar cámara
        </button>

        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;">
            <div>
                <div style="font-size:10.5px;color:rgba(180,200,255,0.5);margin-bottom:4px;letter-spacing:0.1em;text-transform:uppercase;">Nombre de la seña</div>
                <input id="animName" type="text" value="NUEVA_SEÑA"
                    style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid rgba(80,140,255,0.25);background:rgba(12,22,50,0.75);color:#dce8ff;font-family:'DM Sans',sans-serif;font-size:13px;outline:none;box-sizing:border-box;" />
            </div>
            <div>
                <div style="font-size:10.5px;color:rgba(180,200,255,0.5);margin-bottom:4px;letter-spacing:0.1em;text-transform:uppercase;">ms/frame</div>
                <input id="intervalInp" type="number" value="80" min="40" max="300" step="10"
                    style="width:72px;padding:7px 8px;border-radius:8px;border:1px solid rgba(80,140,255,0.25);background:rgba(12,22,50,0.75);color:#dce8ff;font-family:'DM Sans',sans-serif;font-size:13px;outline:none;" />
            </div>
        </div>

        <button id="recBtn" disabled
            style="padding:12px;border-radius:10px;border:none;background:rgba(255,60,60,0.18);color:rgba(255,130,130,0.5);font-family:'Syne',sans-serif;font-size:14px;font-weight:700;cursor:not-allowed;letter-spacing:0.02em;transition:all 0.2s;">
            ● Grabar
        </button>

        <div id="frameInfo" style="font-size:12px;color:rgba(180,200,255,0.45);text-align:center;min-height:16px;"></div>

        <div style="display:flex;gap:7px;">
            <button id="prevBtn"
                style="flex:1;padding:9px;border-radius:9px;border:1px solid rgba(80,140,255,0.3);background:rgba(61,127,255,0.1);color:#88aaff;font-family:'DM Sans',sans-serif;font-size:12.5px;font-weight:500;cursor:pointer;">
                ▶ Preview
            </button>
            <button id="expBtn"
                style="flex:1;padding:9px;border-radius:9px;border:1px solid rgba(0,212,160,0.35);background:rgba(0,212,160,0.1);color:#00d4aa;font-family:'Syne',sans-serif;font-size:12.5px;font-weight:700;cursor:pointer;">
                📋 Exportar
            </button>
        </div>
        <button id="clrBtn"
            style="padding:7px;border-radius:8px;border:1px solid rgba(255,80,80,0.18);background:transparent;color:rgba(255,130,130,0.55);font-family:'DM Sans',sans-serif;font-size:11.5px;cursor:pointer;">
            🗑 Limpiar grabación
        </button>

        <div style="font-size:10.5px;color:rgba(180,200,255,0.3);line-height:1.6;border-top:1px solid rgba(80,140,255,0.1);padding-top:8px;">
            1. Inicia cámara — el avatar replicará tus movimientos.<br>
            2. Ajusta valores en el panel <b style="color:#88aaff">⚙ Calibración</b> (izquierda).<br>
            3. Presiona <b style="color:#ff9999">● Grabar</b> y realiza la seña.<br>
            4. Exporta → pega en <code style="color:#88aaff">animations.js</code>.
        </div>
    `;
    document.body.appendChild(panel);

    toggle.addEventListener('click', () => {
        const open = panel.style.display !== 'flex';
        panel.style.display = open ? 'flex' : 'none';
        toggle.style.background = open ? 'rgba(200,40,40,0.8)' : 'rgba(160,30,30,0.55)';
    });

    document.getElementById('camBtn').addEventListener('click', () => {
        _isStreaming ? stopCamera() : startCamera();
    });
    document.getElementById('recBtn').addEventListener('click', () => {
        _recording ? stopRecording() : startRecording();
    });
    document.getElementById('intervalInp').addEventListener('input', e => {
        _interval = Math.max(40, parseInt(e.target.value) || 80);
    });
    document.getElementById('prevBtn').addEventListener('click', previewAnimation);
    document.getElementById('expBtn').addEventListener('click',  exportAnimation);
    document.getElementById('clrBtn').addEventListener('click',  clearFrames);
}

// ─── Cámara / MediaPipe ───────────────────────────────────────────────────────
function setStatus(msg, live = false) {
    const dot = document.getElementById('recDot');
    const lbl = document.getElementById('recLbl');
    if (lbl) lbl.textContent = msg;
    if (dot) {
        dot.style.background = live ? '#00d4aa' : '#444';
        dot.style.boxShadow  = live ? '0 0 6px #00d4aa' : 'none';
    }
}

async function startCamera() {
    setStatus('Cargando MediaPipe…');
    await loadMP();

    _videoEl  = document.getElementById('recVid');
    _holistic = new window.Holistic({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/${f}`
    });
    _holistic.setOptions({
        modelComplexity:       2,
        smoothLandmarks:       true,
        enableSegmentation:    false,
        refineFaceLandmarks:   false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence:  0.5,
    });
    _holistic.onResults(onResults);

    _mpCamera = new window.Camera(_videoEl, {
        onFrame: async () => {
            if (!_cameraActive || !_holistic || !_videoEl) return;
            try { await _holistic.send({ image: _videoEl }); }
            catch (e) { /* cámara deteniéndose */ }
        },
        width: 640, height: 480,
    });
    _cameraActive = true;
    await _mpCamera.start();
    _isStreaming = true;

    document.getElementById('camBtn').textContent = '⏹ Detener cámara';
    document.getElementById('camBtn').style.background = 'rgba(255,80,80,0.25)';
    document.getElementById('recBtn').disabled = false;
    document.getElementById('recBtn').style.cssText = `
        padding:12px;border-radius:10px;border:none;
        background:linear-gradient(135deg,#cc2222,#ff4444);
        color:#fff;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;
        cursor:pointer;letter-spacing:0.02em;
        box-shadow:0 4px 18px rgba(255,40,40,0.4);transition:all 0.2s;
    `;
    setStatus('En vivo', true);

    const panel = document.getElementById('recPanel');
    const toggle = document.getElementById('recToggle');
    if (panel) panel.style.display = 'flex';
    if (toggle) toggle.style.background = 'rgba(200,40,40,0.8)';
}

function stopCamera() {
    stopRecording();
    _cameraActive = false;
    const cam = _mpCamera;
    _mpCamera = null;
    cam?.stop();
    if (_holistic) { _holistic.close(); _holistic = null; }
    _isStreaming = false;
    _lastPose    = null;
    _smooth      = {};
    _qSmooth     = {};

    document.getElementById('camBtn').textContent = '▶ Iniciar cámara';
    document.getElementById('camBtn').style.background = 'rgba(255,80,80,0.12)';
    document.getElementById('recBtn').disabled = true;
    document.getElementById('recBtn').style.color      = 'rgba(255,130,130,0.5)';
    document.getElementById('recBtn').style.background = 'rgba(255,60,60,0.18)';
    document.getElementById('recBtn').style.cursor     = 'not-allowed';
    document.getElementById('handBadge').style.display = 'none';
    setStatus('Sin cámara', false);

    // Volver a pose relajada
    if (_vrm) returnToIdle();
}

function returnToIdle() {
    if (!_vrm) return;
    // Animación suave de 500ms hacia brazos colgando
    const rightUpper = _vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    const leftUpper  = _vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    const start      = performance.now();
    const dur        = 500;
    const targets    = [
        { bone: 'rightUpperArm', x:0, y:0, z: 1.4  },
        { bone: 'leftUpperArm',  x:0, y:0, z:-1.4  },
        { bone: 'rightLowerArm', x:0, y:0, z:0 },
        { bone: 'leftLowerArm',  x:0, y:0, z:0 },
        { bone: 'rightHand',     x:0, y:0, z:0 },
        { bone: 'leftHand',      x:0, y:0, z:0 },
    ];
    const froms = targets.map(t => {
        const b = _vrm.humanoid.getNormalizedBoneNode(t.bone);
        return b ? { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z } : { x:0, y:0, z:0 };
    });
    function step(now) {
        const raw = (now - start) / dur;
        const t   = raw < 0.5 ? 2*raw*raw : -1+(4-2*raw)*raw;
        const tt  = Math.min(t, 1);
        targets.forEach((tg, i) => {
            const b = _vrm.humanoid.getNormalizedBoneNode(tg.bone);
            if (!b) return;
            b.rotation.x = froms[i].x + (tg.x - froms[i].x) * tt;
            b.rotation.y = froms[i].y + (tg.y - froms[i].y) * tt;
            b.rotation.z = froms[i].z + (tg.z - froms[i].z) * tt;
        });
        if (raw < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ─── Carga asíncrona de MediaPipe + Kalidokit ─────────────────────────────────
export function ensureKalidokit() {
    return loadMP();
}

export function resetRigSmoothing() {
    _smooth      = {};
    _qSmooth     = {};
    _handHold    = { left: null, right: null };
    _prevHandZ   = { left: null, right: null };
}

function loadMP() {
    return new Promise(resolve => {
        if (window.Holistic && window.Camera && window.Kalidokit) { resolve(); return; }
        const s1 = Object.assign(document.createElement('script'), {
            src: 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/holistic.js',
            crossOrigin: 'anonymous',
        });
        const s2 = Object.assign(document.createElement('script'), {
            src: 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js',
            crossOrigin: 'anonymous',
        });
        const s3 = Object.assign(document.createElement('script'), {
            src: 'https://cdn.jsdelivr.net/npm/kalidokit@1.1.0/dist/kalidokit.umd.js',
            crossOrigin: 'anonymous',
        });
        s1.onload = () => {
            document.head.appendChild(s2);
            s2.onload = () => {
                document.head.appendChild(s3);
                s3.onload  = () => { console.log('✅ Kalidokit cargado'); resolve(); };
                s3.onerror = () => { console.warn('⚠️ Kalidokit no disponible'); resolve(); };
            };
        };
        document.head.appendChild(s1);
    });
}

// ─── Suavizado EMA ────────────────────────────────────────────────────────────
function setSmoothRot(bone, x, y, z, alpha = ALPHA) {
    if (_bakingMode) alpha = 0;
    else if (_playbackMode) alpha = ALPHA_PLAYBACK;
    const k = bone.uuid;
    const p = _smooth[k] ?? { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
    const sx = p.x * alpha + x * (1 - alpha);
    const sy = p.y * alpha + y * (1 - alpha);
    const sz = p.z * alpha + z * (1 - alpha);
    _smooth[k] = { x: sx, y: sy, z: sz };
    bone.rotation.set(sx, sy, sz);
}

// ─── Kalidokit → nombre de hueso VRM ─────────────────────────────────────────
// Kalidokit PoseSolver → keys: RightUpperArm, RightLowerArm, LeftUpperArm, etc.
// Kalidokit HandSolver → keys: RightWrist, RightIndexProximal, RightPinkyProximal, etc.
// VRM usa 'little' en lugar de 'pinky', y 'hand' en lugar de 'wrist'.
// Conversión: PascalCase → camelCase.
function kaliToVRM(key) {
    return key
        .replace('Pinky', 'Little')   // VRM usa 'little' no 'pinky'
        .replace('Wrist', 'Hand')      // muñeca = 'hand' en VRM
        .replace(/^([A-Z])/, c => c.toLowerCase()); // camelCase
}

// ─── Aplicar resultado PoseSolver → huesos VRM ───────────────────────────────
// Kalidokit asume el modelo mirando hacia -Z.
// Nuestro modelo mira hacia +Z → el eje X (adelante/atrás) queda invertido.
// Fix: negar X en todos los huesos del cuerpo.
// Gains tweakables en vivo desde consola: window.poseGain.RightLowerArm.y = 2.0
// sign  = [x, y, z]  multiplica el signo (debe ser ±1)
// gain  = [x, y, z]  amplitud
// Pose.solve cubre brazos + muñecas en un espacio consistente.
// RightHand/LeftHand vienen del Pose.solve con el mismo convenio de ejes que el brazo.
// NOTA: Pose.solve NO genera RightHand/LeftHand — la muñeca se calcula por
// separado en applyWristFromLandmarks() usando quaterniones y los landmarks crudos.
// alias consola: window.poseGain = CALIB.pose

function applyKalidokitPose(rigged, armTrust = { left: 1, right: 1 }) {
    const calib = getActiveCalib();
    const clamp = (v) => Math.max(-Math.PI, Math.min(Math.PI, v));
    for (const kaliKey in calib.pose) {
        const rot = rigged[kaliKey];
        if (!rot) continue;
        const m = calib.pose[kaliKey];
        const vrmName = kaliToVRM(kaliKey);
        const bone    = _vrm.humanoid.getNormalizedBoneNode(vrmName);
        if (!bone) continue;
        const trust = kaliKey.startsWith('Right') ? armTrust.right
                    : kaliKey.startsWith('Left')  ? armTrust.left : 1;
        const alpha = _playbackMode ? ALPHA_PLAYBACK : ALPHA + (1 - trust) * 0.65;
        setSmoothRot(bone,
            clamp((rot.x ?? 0) * m.x),
            clamp((rot.y ?? 0) * m.y),
            clamp((rot.z ?? 0) * m.z),
            alpha
        );
    }
}

if (typeof window !== 'undefined') window.poseGain = getActiveCalib().pose;

// ─── Muñeca: Kalidokit + quaterniones desde landmarks 3D ─────────────────────
const _vX = new THREE.Vector3();
const _vY = new THREE.Vector3();
const _vZ = new THREE.Vector3();
const _mHand = new THREE.Matrix4();
const _qLm    = new THREE.Quaternion();
const _qOff   = new THREE.Quaternion();
const _qFinal = new THREE.Quaternion();
const _qKali  = new THREE.Quaternion();
const _eTmp   = new THREE.Euler();

function clampMult(m) { return Math.max(-4, Math.min(4, m ?? 1)); }

/** Suavizado por quaternion — conserva giros de muñeca sin perder el eje roll. */
function setSmoothQuat(bone, qTarget, alpha) {
    if (_bakingMode) alpha = 0;
    else if (_playbackMode) alpha = ALPHA_PLAYBACK;
    const k = bone.uuid;
    if (!_qSmooth[k]) _qSmooth[k] = bone.quaternion.clone();
    _qSmooth[k].slerp(qTarget, 1 - alpha);
    bone.quaternion.copy(_qSmooth[k]);
    bone.rotation.setFromQuaternion(bone.quaternion, bone.rotation.order);
}

/** Orientación 3D completa de la mano (incluye giro de muñeca). */
function quatFromHandLandmarks(lm, vrmSide) {
    if (!lm || lm.length < 18) return null;
    const w = lm[0], mid = lm[9], idx = lm[5], pink = lm[17];
    const sx = vrmSide === 'right' ? -1 : 1;

    _vY.set(sx * (mid.x - w.x), -(mid.y - w.y), (mid.z ?? 0) - (w.z ?? 0)).normalize();
    _vX.set(sx * (idx.x - pink.x), -(idx.y - pink.y), (idx.z ?? 0) - (pink.z ?? 0)).normalize();
    _vZ.crossVectors(_vX, _vY).normalize();
    _vX.crossVectors(_vY, _vZ).normalize();
    _mHand.makeBasis(_vX, _vY, _vZ);
    _qLm.setFromRotationMatrix(_mHand);

    _eTmp.setFromQuaternion(_qLm, 'XYZ');
    _qLm.setFromEuler(new THREE.Euler(
        _eTmp.x * clampMult(getWristCalib(vrmSide).x),
        _eTmp.y * clampMult(getWristCalib(vrmSide).y),
        _eTmp.z * clampMult(getWristCalib(vrmSide).z),
        'XYZ'
    ));
    return _qLm.clone();
}

function quatFromKalidokit(wrist, poseHand, w) {
    let kx = (wrist.x ?? 0) * clampMult(w.x);
    let ky = (wrist.y ?? 0) * clampMult(w.y);
    let kz = (wrist.z ?? 0) * clampMult(w.z);
    if (poseHand?.z) kz += poseHand.z * (w.poseZ ?? 0.35);
    _qKali.setFromEuler(new THREE.Euler(kx, ky, kz, 'XYZ'));
    return _qKali.clone();
}

/**
 * Confianza 0–1 de que la mano está bien asociada (no cruzando la cara con Z ambiguo).
 * rHand → mano izq real (pose índice 15), lHand → mano der real (pose índice 16).
 */
function handTrackingTrust(pose, handLm, poseWristIdx, vrmSide) {
    if (!handLm || !handLm[0]) return 0;
    let trust = 1;
    const hw = handLm[0];
    const pw = pose?.[poseWristIdx];
    const nose = pose?.[0];

    if (pw && (pw.visibility ?? 1) > 0.45) {
        const dist2d = Math.hypot(hw.x - pw.x, hw.y - pw.y);
        if (dist2d > 0.1) trust *= Math.max(0.15, 1 - (dist2d - 0.1) / 0.22);
    }

    if (nose) {
        const nearFace = Math.hypot(hw.x - nose.x, hw.y - nose.y) < 0.2;
        if (nearFace) {
            const hwz = hw.z ?? 0;
            const nz  = nose.z ?? 0;
            if (Math.abs(hwz - nz) < 0.045) trust *= 0.2;
            const prev = _prevHandZ[vrmSide];
            if (prev != null && Math.abs(hwz - prev) > 0.07) trust *= 0.25;
            _prevHandZ[vrmSide] = hwz;
            if (pw && Math.hypot(hw.x - pw.x, hw.y - pw.y) > 0.14) trust *= 0.15;
        } else {
            _prevHandZ[vrmSide] = hw.z ?? 0;
        }
    }

    return Math.max(0, Math.min(1, trust));
}

function applyHeldHand(side) {
    const hold = _handHold[side];
    if (!hold || !_vrm) return;
    const apply = (name, r, alpha) => {
        const b = _vrm.humanoid.getNormalizedBoneNode(name);
        if (b) setSmoothRot(b, r.x, r.y, r.z, alpha);
    };
    apply(`${side}Hand`, hold.wrist, 0.35);
    for (const [name, r] of Object.entries(hold.fingers)) apply(name, r, 0.4);
}

function captureHandHold(vrmSide, handRig, kaliSide) {
    const wristKey = `${kaliSide}Wrist`;
    const prefix = vrmSide;
    const fingers = {};
    for (const k of Object.keys(handRig)) {
        if (!k.endsWith('Wrist') && handRig[k]) {
            fingers[kaliToVRM(k)] = {
                x: _vrm.humanoid.getNormalizedBoneNode(kaliToVRM(k))?.rotation.x ?? 0,
                y: _vrm.humanoid.getNormalizedBoneNode(kaliToVRM(k))?.rotation.y ?? 0,
                z: _vrm.humanoid.getNormalizedBoneNode(kaliToVRM(k))?.rotation.z ?? 0,
            };
        }
    }
    const wb = _vrm.humanoid.getNormalizedBoneNode(`${prefix}Hand`);
    _handHold[vrmSide] = {
        wrist: wb ? { x: wb.rotation.x, y: wb.rotation.y, z: wb.rotation.z } : { x:0,y:0,z:0 },
        fingers,
    };
}

function applyHandRig(handRig, kaliSide, poseRig, handLm, trust = 1) {
    if (!handRig || !_vrm) return;
    const vrmSide = kaliSide === 'Right' ? 'right' : 'left';

    if (trust < 0.3) {
        applyHeldHand(vrmSide);
        return;
    }

    const w = getWristCalib(vrmSide);
    const vrmHand = `${vrmSide}Hand`;
    const wristKey = `${kaliSide}Wrist`;
    const wrist = handRig[wristKey];
    const poseHand = poseRig?.[`${kaliSide}Hand`];
    const off = w.offset ?? { x: 0, y: 0, z: 0 };
    const blend = Math.max(0, Math.min(1, (w.blend ?? 0.7) * trust));
    const aW = _playbackMode ? ALPHA_PLAYBACK : ALPHA_WRIST + (1 - trust) * 0.3;
    const aF = _playbackMode ? ALPHA_PLAYBACK : ALPHA_FINGER + (1 - trust) * 0.4;

    const qKali = wrist ? quatFromKalidokit(wrist, poseHand, w) : new THREE.Quaternion();
    const qLm   = quatFromHandLandmarks(handLm, vrmSide);

    if (qLm && blend > 0.05) {
        _qFinal.copy(qKali).slerp(qLm, blend);
    } else {
        _qFinal.copy(qKali);
    }

    if (off.x || off.y || off.z) {
        _qOff.setFromEuler(new THREE.Euler(off.x, off.y, off.z, 'XYZ'));
        _qFinal.multiply(_qOff);
    }

    const bone = _vrm.humanoid.getNormalizedBoneNode(vrmHand);
    if (bone) setSmoothQuat(bone, _qFinal, aW);

    const clampRot = (v) => Math.max(-Math.PI, Math.min(Math.PI, v));

    for (const [kaliKey, rot] of Object.entries(handRig)) {
        if (!rot || kaliKey === wristKey) continue;
        const vrmName = kaliToVRM(kaliKey);
        const fb      = _vrm.humanoid.getNormalizedBoneNode(vrmName);
        if (!fb) continue;
        const m = kaliKey.includes('Thumb') ? getActiveCalib().thumb : getActiveCalib().fingers;
        setSmoothRot(fb,
            clampRot((rot.x ?? 0) * clampMult(m.x) * trust),
            clampRot((rot.y ?? 0) * clampMult(m.y) * trust),
            clampRot((rot.z ?? 0) * clampMult(m.z) * trust),
            aF
        );
    }

    if (trust > 0.65 || _playbackMode) captureHandHold(vrmSide, handRig, kaliSide);
}

// ─── Relajar dedos cuando la mano deja de detectarse ─────────────────────────
function relaxHandFingers(side) {
    if (_playbackMode) {
        applyHeldHand(side);
        return;
    }
    if (_handHold[side]) {
        applyHeldHand(side);
        return;
    }
    const prefix = side;
    const FINGERS = ['Index', 'Middle', 'Ring', 'Little', 'Thumb'];
    const PARTS   = ['Proximal', 'Intermediate', 'Distal'];
    for (const f of FINGERS) {
        for (const p of PARTS) {
            const bone = _vrm.humanoid.getNormalizedBoneNode(`${prefix}${f}${p}`);
            if (!bone) continue;
            setSmoothRot(bone, 0, 0, 0, 0.85);   // alpha alto = volver lento a 0
        }
    }
    const wrist = _vrm.humanoid.getNormalizedBoneNode(`${prefix}Hand`);
    if (wrist) setSmoothRot(wrist, 0, 0, 0, 0.85);
}

// ─── Hook para recognition.js ────────────────────────────────────────────────
let _recogHook = null;
export function setRecognitionHook(fn) { _recogHook = fn; }

// ─── Resultados MediaPipe ─────────────────────────────────────────────────────
function processHolisticFrame(results, opts = {}) {
    const vrm = opts.vrm ?? _vrm;
    if (!vrm) return;

    const playback = opts.playback ?? false;
    const skipUI   = opts.skipUI ?? playback;
    const prevVrm  = _vrm;
    const prevPlay = _playbackMode;

    _vrm          = vrm;
    _playbackMode = playback;

    try {
        if (!skipUI) drawOverlay(results);
        if (!playback && _recogHook) _recogHook(results);

        const pose   = results.poseLandmarks;
        const pose3D = results.poseWorldLandmarks ?? results.za;
        const rHand  = results.rightHandLandmarks;
        const lHand  = results.leftHandLandmarks;

        if (!skipUI) {
            const dot   = document.getElementById('recDot');
            const badge = document.getElementById('handBadge');
            if (dot)   dot.style.background = pose ? '#00d4aa' : '#ff4444';
            if (badge) badge.style.display = (rHand || lHand) ? 'block' : 'none';
        }

        const KT = window.Kalidokit;
        let poseRig = null;

        const trustLeft  = playback ? 1 : (rHand ? handTrackingTrust(pose, rHand, 15, 'left')  : 1);
        const trustRight = playback ? 1 : (lHand ? handTrackingTrust(pose, lHand, 16, 'right') : 1);
        const armTrust   = { left: trustLeft, right: trustRight };

        if (!skipUI) {
            const badge = document.getElementById('handBadge');
            if (badge && (trustLeft < 0.45 || trustRight < 0.45)) {
                badge.textContent = '⚠️ mano cerca cara';
                badge.style.color = 'rgba(255,180,80,0.9)';
            } else if (badge) {
                badge.textContent = '✋ manos OK';
                badge.style.color = 'rgba(0,212,160,0.7)';
            }
        }

        if (KT && pose && pose3D) {
            try {
                poseRig = KT.Pose.solve(pose3D, pose, {
                    runtime:         'mediapipe',
                    video:           playback ? null : _videoEl,
                    imageSize:       { width: 640, height: 480 },
                    smoothLandmarks: !playback,
                });
                if (poseRig) applyKalidokitPose(poseRig, armTrust);
            } catch (e) {
                console.warn('Pose.solve error:', e.message);
            }
        }

        if (KT) {
            // JSON grabado: lh/rh = mano izq/der anatómica (sin swap selfie de cámara)
            const anaLh = results.anatomicalLh;
            const anaRh = results.anatomicalRh;
            const useAnatomical = playback && (anaLh || anaRh);

            if (useAnatomical) {
                if (anaLh) {
                    try {
                        const handRig = KT.Hand.solve(anaLh, 'Left');
                        if (handRig) applyHandRig(handRig, 'Left', poseRig, anaLh, 1);
                    } catch (e) { /* silenciar */ }
                } else {
                    relaxHandFingers('left');
                }
                if (anaRh) {
                    try {
                        const handRig = KT.Hand.solve(anaRh, 'Right');
                        if (handRig) applyHandRig(handRig, 'Right', poseRig, anaRh, 1);
                    } catch (e) { /* silenciar */ }
                } else {
                    relaxHandFingers('right');
                }
            } else if (rHand || lHand) {
                if (rHand) {
                    try {
                        const handRig = KT.Hand.solve(rHand, 'Left');
                        if (handRig) applyHandRig(handRig, 'Left', poseRig, rHand, trustLeft);
                    } catch (e) { /* silenciar */ }
                } else {
                    relaxHandFingers('left');
                }
                if (lHand) {
                    try {
                        const handRig = KT.Hand.solve(lHand, 'Right');
                        if (handRig) applyHandRig(handRig, 'Right', poseRig, lHand, trustRight);
                    } catch (e) { /* silenciar */ }
                } else {
                    relaxHandFingers('right');
                }
            } else if (playback) {
                relaxHandFingers('left');
                relaxHandFingers('right');
            }
        }

        if (!opts.vrm) _lastPose = { pose, rHand, lHand };
    } finally {
        if (opts.vrm) _vrm = prevVrm;
        _playbackMode = prevPlay;
    }
}

export function applyHolisticToVrm(vrm, results, opts = {}) {
    processHolisticFrame(results, { vrm, playback: true, skipUI: true, ...opts });
}

function onResults(results) {
    if (!_vrm) return;
    processHolisticFrame(results);
}

// ─── Overlay esqueleto ────────────────────────────────────────────────────────
function drawOverlay(results) {
    const cv = document.getElementById('recCvs');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    cv.width  = cv.offsetWidth;
    cv.height = cv.offsetHeight;
    ctx.clearRect(0, 0, cv.width, cv.height);

    const pose = results.poseLandmarks;
    if (!pose) return;
    const W = cv.width, H = cv.height;

    ctx.strokeStyle = 'rgba(0,212,160,0.6)';
    ctx.lineWidth   = 2;
    for (const [a,b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24]]) {
        const pa = pose[a], pb = pose[b];
        if (!pa || !pb || pa.visibility < 0.4 || pb.visibility < 0.4) continue;
        ctx.beginPath(); ctx.moveTo(pa.x*W, pa.y*H); ctx.lineTo(pb.x*W, pb.y*H); ctx.stroke();
    }
    ctx.fillStyle = '#00d4aa';
    for (const i of [11,12,13,14,15,16]) {
        const p = pose[i];
        if (!p || p.visibility < 0.4) continue;
        ctx.beginPath(); ctx.arc(p.x*W, p.y*H, 4, 0, Math.PI*2); ctx.fill();
    }

    if (results.rightHandLandmarks) {
        ctx.fillStyle = 'rgba(0,212,160,0.5)';
        for (const p of results.rightHandLandmarks) {
            ctx.beginPath(); ctx.arc(p.x*W, p.y*H, 2, 0, Math.PI*2); ctx.fill();
        }
    }
    if (results.leftHandLandmarks) {
        ctx.fillStyle = 'rgba(61,127,255,0.5)';
        for (const p of results.leftHandLandmarks) {
            ctx.beginPath(); ctx.arc(p.x*W, p.y*H, 2, 0, Math.PI*2); ctx.fill();
        }
    }
}

// ─── Huesos VRM que se graban ─────────────────────────────────────────────────
const RECORD_BONES = [
    'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperArm',  'leftLowerArm',  'leftHand',
    'rightIndexProximal',    'rightIndexIntermediate',    'rightIndexDistal',
    'rightMiddleProximal',   'rightMiddleIntermediate',   'rightMiddleDistal',
    'rightRingProximal',     'rightRingIntermediate',     'rightRingDistal',
    'rightLittleProximal',   'rightLittleIntermediate',   'rightLittleDistal',
    'rightThumbProximal',    'rightThumbIntermediate',    'rightThumbDistal',
    'leftIndexProximal',     'leftIndexIntermediate',     'leftIndexDistal',
    'leftMiddleProximal',    'leftMiddleIntermediate',    'leftMiddleDistal',
    'leftRingProximal',      'leftRingIntermediate',      'leftRingDistal',
    'leftLittleProximal',    'leftLittleIntermediate',    'leftLittleDistal',
    'leftThumbProximal',     'leftThumbIntermediate',     'leftThumbDistal',
    'spine', 'chest', 'neck',
];

export function setBakingMode(on) {
    _bakingMode = !!on;
}

export function captureVrmPose(vrm, duration = 80) {
    const pose = {};
    for (const name of RECORD_BONES) {
        const bone = vrm.humanoid.getNormalizedBoneNode(name);
        if (!bone) continue;
        const x = +bone.rotation.x.toFixed(4);
        const y = +bone.rotation.y.toFixed(4);
        const z = +bone.rotation.z.toFixed(4);
        if (Math.abs(x) > 0.003 || Math.abs(y) > 0.003 || Math.abs(z) > 0.003)
            pose[name] = { x, y, z };
    }
    return { duration, pose };
}

// ─── Captura de frames ────────────────────────────────────────────────────────
// En VRM normalizado, T-pose = (0,0,0), así que los valores actuales
// ya son el delta desde neutral → los guardamos directamente.
function captureCurrentFrame() {
    const pose = {};
    for (const name of RECORD_BONES) {
        const bone = _vrm.humanoid.getNormalizedBoneNode(name);
        if (!bone) continue;
        const x = +bone.rotation.x.toFixed(4);
        const y = +bone.rotation.y.toFixed(4);
        const z = +bone.rotation.z.toFixed(4);
        // Solo guardar si hay alguna rotación significativa
        if (Math.abs(x) > 0.005 || Math.abs(y) > 0.005 || Math.abs(z) > 0.005)
            pose[name] = { x, y, z };
    }
    return { duration: _interval, pose };
}

function startRecording() {
    if (!_isStreaming) return;
    _frames    = [];
    _recording = true;
    const btn = document.getElementById('recBtn');
    btn.textContent = '⏹ Detener';
    btn.style.background = 'linear-gradient(135deg,#880000,#cc0000)';
    document.getElementById('recCounter').style.display = 'block';
    _recTimer = setInterval(() => {
        if (!_vrm) return;
        _frames.push(captureCurrentFrame());
        updateFrameInfo();
    }, _interval);
}

function stopRecording() {
    if (!_recording) return;
    _recording = false;
    clearInterval(_recTimer);
    _recTimer  = null;
    const btn  = document.getElementById('recBtn');
    btn.textContent = '● Grabar';
    btn.style.background = 'linear-gradient(135deg,#cc2222,#ff4444)';
    document.getElementById('recCounter').style.display = 'none';
    updateFrameInfo();
}

function updateFrameInfo() {
    const info = document.getElementById('frameInfo');
    if (!info) return;
    if (_frames.length === 0) { info.textContent = ''; return; }
    const totalMs = _frames.length * _interval;
    info.textContent = `${_frames.length} frames · ${(totalMs/1000).toFixed(2)}s grabados`;
    info.style.color = 'rgba(0,212,160,0.7)';
}

function clearFrames() { stopRecording(); _frames = []; updateFrameInfo(); }

// ─── Preview ──────────────────────────────────────────────────────────────────
async function previewAnimation() {
    if (_frames.length === 0) { alert('No hay frames grabados aún'); return; }
    const { playKeyframes } = await import('./animations.js?v=22');
    playKeyframes(_vrm, _frames, () => {});
}

// ─── Exportar ─────────────────────────────────────────────────────────────────
function exportAnimation() {
    if (_frames.length === 0) { alert('No hay frames grabados'); return; }

    const name = (document.getElementById('animName').value || 'NUEVA_SEÑA')
        .trim().toUpperCase().replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,'');

    // Simplificar: eliminar frames consecutivos casi idénticos
    const simplified = [_frames[0]];
    for (let i = 1; i < _frames.length; i++) {
        const prev = _frames[i-1].pose;
        const curr = _frames[i].pose;
        let maxDiff = 0;
        for (const bone of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
            const a = prev[bone] ?? { x:0, y:0, z:0 };
            const b = curr[bone] ?? { x:0, y:0, z:0 };
            maxDiff = Math.max(maxDiff, Math.abs(a.x-b.x), Math.abs(a.y-b.y), Math.abs(a.z-b.z));
        }
        if (maxDiff > 0.015) simplified.push(_frames[i]);
    }

    const lines = [
        `// Grabado: ${_frames.length} frames → ${simplified.length} keyframes · VRM`,
        `export const ANIM_${name} = [`,
    ];
    for (const f of simplified) {
        const entries = Object.entries(f.pose)
            .map(([b, r]) => `        ${b}: {x:${r.x}, y:${r.y}, z:${r.z}}`)
            .join(',\n');
        lines.push(`    { duration:${f.duration}, pose:{\n${entries}\n    }},`);
    }
    lines.push(`];\n`);
    lines.push(`// Agregar al LSC_DICTIONARY en animations.js:`);
    lines.push(`// '${name.toLowerCase().replace(/_/g,' ')}': ANIM_${name},`);

    const code = lines.join('\n');
    navigator.clipboard.writeText(code)
        .then(() => {
            const btn = document.getElementById('expBtn');
            const orig = btn.textContent;
            btn.textContent = `✅ Copiado (${simplified.length} KF)`;
            btn.style.background = 'rgba(0,212,160,0.3)';
            setTimeout(() => { btn.textContent = orig; btn.style.background = 'rgba(0,212,160,0.1)'; }, 3000);
        })
        .catch(() => {
            console.log('📋 Código para animations.js:\n' + code);
            alert(`${simplified.length} keyframes → ver consola (F12)`);
        });
    console.log(`📋 ANIM_${name} (${simplified.length} KF de ${_frames.length}):\n` + code);
}
