/**
 * datasetPlayer.js — Convierte JSON de landmarks → keyframes VRM y reproduce.
 */
import {
    applyHolisticToVrm, ensureKalidokit, resetRigSmoothing,
    captureVrmPose, setBakingMode,
} from './recorder.js?v=22';
import { setPlaybackCalib } from './calibration.js?v=22';

const _cache  = {};
const _baked  = {};

function landmarkPt(arr) {
    return { x: arr[0], y: arr[1], z: arr[2] ?? 0, visibility: 1 };
}

function handActive(lm) {
    if (!lm || lm.length !== 21) return false;
    return lm.some(p => Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2] ?? 0) > 0.001);
}

function cloneFrame(f) {
    return {
        pose: (f.pose || []).map(p => [...p]),
        rh:   (f.rh   || []).map(p => [...p]),
        lh:   (f.lh   || []).map(p => [...p]),
    };
}

/** Rellena huecos entre frames con mano detectada. */
function fillHandGaps(frames, key) {
    const active = frames.map((f, i) => handActive(f[key]) ? i : -1).filter(i => i >= 0);
    if (!active.length) return;
    const first = active[0];
    const last  = active[active.length - 1];
    let carry = null;
    for (let i = first; i <= last; i++) {
        if (handActive(frames[i][key])) carry = frames[i][key];
        else if (carry) frames[i][key] = carry.map(p => [...p]);
    }
}

function preprocessDataset(dataset) {
    const frames = dataset.frames.map(cloneFrame);
    fillHandGaps(frames, 'lh');
    fillHandGaps(frames, 'rh');
    return { ...dataset, frames };
}

/**
 * El recorder (04_record_animations.py) hace `cv2.flip(frame, 1)` ANTES de
 * pasar la imagen a MediaPipe → MediaPipe etiqueta los landmarks asumiendo
 * imagen normal, pero los datos están en espacio de imagen volteada.
 *
 * Consecuencias:
 *   1. Las coords X están espejadas (X → 1-X frente a una imagen no volteada).
 *   2. Las etiquetas L/R quedan intercambiadas anatómicamente:
 *        pose[15] "LEFT_WRIST"  → en realidad la muñeca DERECHA
 *        pose[16] "RIGHT_WRIST" → en realidad la muñeca IZQUIERDA
 *        lh (left_hand_landmarks)  → en realidad la mano DERECHA
 *        rh (right_hand_landmarks) → en realidad la mano IZQUIERDA
 *   3. Además Y está en convención de imagen (Y-down), Kalidokit la quiere
 *      en mundial (Y-up) centrada en caderas.
 *
 * Esta función desespeja X, intercambia los pares L/R del pose y voltea Y
 * para entregar a Kalidokit datos en convención estándar.
 */

// Pares (LEFT_idx, RIGHT_idx) del pose de MediaPipe que hay que intercambiar
const POSE_LR_PAIRS = [
    [1, 4], [2, 5], [3, 6], [7, 8], [9, 10],
    [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
    [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

function unmirrorAndSwapPose(rawPose) {
    // Clonar y desespejar X
    const flipped = rawPose.map(p => p ? [1 - (p[0] ?? 0), p[1] ?? 0, p[2] ?? 0] : [0, 0, 0]);
    // Intercambiar pares L/R
    for (const [l, r] of POSE_LR_PAIRS) {
        if (flipped[l] && flipped[r]) {
            const tmp = flipped[l];
            flipped[l] = flipped[r];
            flipped[r] = tmp;
        }
    }
    return flipped;
}

function unmirrorHand(rawHand) {
    return rawHand.map(p => p ? [1 - (p[0] ?? 0), p[1] ?? 0, p[2] ?? 0] : [0, 0, 0]);
}

export function frameToHolisticResults(frame) {
    // Paso 1: desespejar X y reordenar pares L/R del pose
    const fixedPose = unmirrorAndSwapPose(frame.pose || []);

    // Paso 2: 2D para poseLandmarks (Y queda igual, en convención imagen)
    const pose2D = fixedPose.map(landmarkPt);
    while (pose2D.length < 33) pose2D.push({ x: 0, y: 0, z: 0, visibility: 0 });

    // Paso 3: 3D para poseWorldLandmarks — centrar en caderas y voltear Y
    const hipL = fixedPose[23], hipR = fixedPose[24];
    const hipX = (hipL && hipR) ? (hipL[0] + hipR[0]) / 2 : 0.5;
    const hipY = (hipL && hipR) ? (hipL[1] + hipR[1]) / 2 : 0.5;
    const hipZ = (hipL && hipR) ? ((hipL[2] ?? 0) + (hipR[2] ?? 0)) / 2 : 0;

    const pose3D = fixedPose.map(p => ({
        x:  (p[0] ?? 0) - hipX,
        y: -((p[1] ?? 0) - hipY),   // imagen (Y-down) → mundial (Y-up)
        z:  (p[2] ?? 0) - hipZ,     // Z se mantiene en convención MediaPipe
                                    // (negativo = hacia cámara). La calibración
                                    // DATASET_CALIB ya tiene multiplicadores
                                    // negativos en X que compensan la dirección
                                    // del avatar — voltear Z aquí duplicaba la
                                    // inversión y mandaba los brazos detrás.
        visibility: 1,
    }));
    while (pose3D.length < 33) pose3D.push({ x: 0, y: 0, z: 0, visibility: 0 });

    const results = {
        poseLandmarks: pose2D,
        poseWorldLandmarks: pose3D,
        anatomicalLh: null,
        anatomicalRh: null,
    };

    // Paso 4: intercambiar lh ↔ rh anatómicamente y desespejar X
    //   JSON "lh" (mano izq según MediaPipe en imagen volteada) = mano DERECHA real
    //   JSON "rh" (mano der según MediaPipe en imagen volteada) = mano IZQUIERDA real
    if (handActive(frame.rh)) results.anatomicalLh = unmirrorHand(frame.rh).map(landmarkPt);
    if (handActive(frame.lh)) results.anatomicalRh = unmirrorHand(frame.lh).map(landmarkPt);
    return results;
}

// Suavizado temporal (EMA) de las rotaciones de hueso ya horneadas. El horneado
// aplica cada frame sin suavizar (alpha=0), así que el tembleque de los landmarks
// pasa tal cual a los keyframes → se ve "tosco". Un EMA por hueso lo reduce sin
// depender de la calibración. alpha alto = más suave (más lag), bajo = más fiel.
function smoothPoses(frames, alpha = 0.35) {
    if (frames.length < 2) return frames;
    const out = frames.map(f => ({ ...f, pose: {} }));
    const acc = {};
    for (let i = 0; i < frames.length; i++) {
        const pose = frames[i].pose || {};
        for (const bone of Object.keys(pose)) {
            const p = pose[bone];
            if (!acc[bone]) acc[bone] = { x: p.x, y: p.y, z: p.z };
            else acc[bone] = {
                x: acc[bone].x + alpha * (p.x - acc[bone].x),
                y: acc[bone].y + alpha * (p.y - acc[bone].y),
                z: acc[bone].z + alpha * (p.z - acc[bone].z),
            };
            out[i].pose[bone] = { ...acc[bone] };
        }
    }
    return out;
}

function simplifyKeyframes(frames, threshold = 0.012) {
    if (!frames.length) return frames;
    const out = [{ ...frames[0] }];
    for (let i = 1; i < frames.length; i++) {
        const prev = out[out.length - 1].pose;
        const curr = frames[i].pose;
        let maxDiff = 0;
        for (const bone of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
            const a = prev[bone] ?? { x: 0, y: 0, z: 0 };
            const b = curr[bone] ?? { x: 0, y: 0, z: 0 };
            maxDiff = Math.max(maxDiff, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
        }
        if (maxDiff > threshold) {
            out.push({ ...frames[i] });
        } else {
            // Acumular duración para preservar el timing original
            out[out.length - 1] = {
                ...out[out.length - 1],
                duration: out[out.length - 1].duration + frames[i].duration,
            };
        }
    }
    return out;
}

export async function loadDataset(url) {
    if (_cache[url]) return _cache[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo cargar ${url}: ${res.status}`);
    const data = await res.json();
    _cache[url] = data;
    return data;
}

/** Convierte landmarks → keyframes VRM (cache en memoria). */
export async function bakeToKeyframes(vrm, dataset) {
    const key = dataset.token || `ds_${dataset.frames?.length}`;
    if (_baked[key]) return _baked[key];

    console.log(`⏳ Horneando "${key}"…`);
    await ensureKalidokit();

    const { setIdlePose } = await import('./animations.js?v=22');
    setIdlePose(vrm);
    resetRigSmoothing();
    setPlaybackCalib(true);
    setBakingMode(true);

    const prepared = preprocessDataset(dataset);
    const ms       = Math.round(1000 / (prepared.fps || 30));
    const raw      = [];

    for (const frame of prepared.frames) {
        applyHolisticToVrm(vrm, frameToHolisticResults(frame));
        raw.push(captureVrmPose(vrm, ms));
    }

    setBakingMode(false);
    setPlaybackCalib(false);
    resetRigSmoothing();

    const keyframes = simplifyKeyframes(smoothPoses(raw));
    _baked[key] = keyframes;
    console.log(`✅ "${key}": ${raw.length} frames → ${keyframes.length} keyframes VRM`);
    return keyframes;
}

/** Reproduce dataset horneado con el motor playKeyframes (igual que hola, gracias…). */
export async function playLandmarkDataset(vrm, dataset, onDone) {
    const keyframes = await bakeToKeyframes(vrm, dataset);
    const { playKeyframes, setIdlePose } = await import('./animations.js?v=22');
    // Tras el horneado el avatar queda en la pose del ÚLTIMO frame del JSON.
    // Sin este reset, playKeyframes interpolaría desde el final hacia el primer
    // keyframe (la pose inicial de la seña), reproduciendo la seña al revés
    // durante esa transición.
    setIdlePose(vrm);
    return playKeyframes(vrm, keyframes, onDone);
}

export async function playDatasetFile(vrm, filename, onDone) {
    const dataset = await loadDataset(`./${filename}`);
    return playLandmarkDataset(vrm, dataset, onDone);
}
