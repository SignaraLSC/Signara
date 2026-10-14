"""Dos checkpoints conservados, una ruta de reconocimiento con duración libre.

La rama histórica conserva forma local y sus 24 pasos internos. La temporal
recibe el recorrido íntegro y solo puede aportar las letras móviles validadas.
No promediar softmax de modelos distintos: no son confidencias calibradas entre sí.
"""

from dataclasses import dataclass, replace

import numpy as np
import torch

from core.confusion import canonical_label, evaluate_prediction
from core.gnn_model import SEQ_LEN
from core.fingerspelling_geometry import downward_pose, hand_evidence, lateral_pendulum, pose_masks, unambiguous_two_finger_pendulum
from core.preprocess import LEGACY_PREPROCESS, TRAJECTORY_PREPROCESS, sequence_compact_to_gnn


MOTION_LETTERS = frozenset({"G", "H", "J", "S", "Z", "Ñ"})
ALPHABET = frozenset("ABCDEFGHIJKLMNÑOPQRSTUVWXYZ")


def resample_shape(frames, length=SEQ_LEN):
    """Adaptador del checkpoint viejo; no altera el buffer ni fija su duración."""
    positions = np.linspace(0, len(frames) - 1, length)
    lo = np.floor(positions).astype(int)
    hi = np.minimum(lo + 1, len(frames) - 1)
    weight = (positions - lo)[:, None]
    return (frames[lo] * (1 - weight) + frames[hi] * weight).astype(np.float32)


def motion_evidence(frames):
    """Exigir recorrido, no solo el prior temporal de una ventana de 6 cuadros."""
    hands = np.asarray(frames, dtype=np.float32).reshape(-1, 2, 21, 3)
    for side in range(2):
        hand = hands[:, side]
        visible = np.linalg.norm(hand[:, 0, :2], axis=1) > 1e-6
        if int(visible.sum()) < 6:
            continue
        hand = hand[visible]
        span = np.linalg.norm(hand[:, [5, 9, 17], :2] - hand[:, :1, :2], axis=2).max(axis=1)
        scale = max(float(np.median(span)), 0.025)
        for point in (0, 4, 8, 12, 16, 20):
            path = hand[:, point, :2]
            extent = float(np.linalg.norm(np.ptp(path, axis=0)))
            travel = float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum())
            if extent >= scale * 0.22 and travel >= scale * 0.35:
                return True
    return False


def _probabilities(model, frames, *, sequence=False, normalize=True, preprocess=LEGACY_PREPROCESS):
    representation = sequence_compact_to_gnn(frames, normalize=normalize, preprocess=preprocess)
    tensor = torch.from_numpy(representation).unsqueeze(0)
    with torch.inference_mode():
        logits = model(tensor, torch.tensor([len(frames)])) if sequence else model(tensor)
        return torch.softmax(logits, dim=1)[0].cpu().numpy()


def _motion_candidate(labels, probabilities):
    # Competencia con TODAS las clases originales: no amplificar una masa
    # residual de H para convertirla artificialmente en una letra segura.
    prediction, confidence, _ = evaluate_prediction(labels, probabilities, min_conf=0.85, min_margin=0.18)
    return prediction if prediction in MOTION_LETTERS else None, confidence


def wrist_signature(frames):
    """Recorrido de muñeca relativo a la palma, sin depender de la cadencia.

    La mediana de tres solo verifica el tipo de recorrido. No altera los
    cuadros recibidos por los checkpoints ni sustituye sus predicciones.
    """
    hands = np.asarray(frames, dtype=np.float32).reshape(-1, 2, 21, 3)
    visible = np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6
    side = int(visible.sum(axis=0).argmax())
    hand = hands[visible[:, side], side]
    if len(hand) < 6:
        return np.zeros(2), 0.0, np.zeros(2)
    scale = max(float(np.median(np.linalg.norm(hand[:, [5, 9, 17], :2] - hand[:, :1, :2], axis=2).max(axis=1))), 0.025)
    path = hand[:, 0, :2] / scale
    path = np.array([np.median(path[max(0, i-1):i+2], axis=0) for i in range(len(path))])
    extent = np.ptp(path, axis=0)
    steps = np.diff(path, axis=0)
    travel = float(np.linalg.norm(steps, axis=1).sum())
    backtrack = (np.abs(steps).sum(axis=0) - np.abs(path[-1] - path[0])) / 2
    return extent, travel, backtrack


def motion_preparation_start(candidate, frames):
    # G requiere índice; H índice/medio; Ñ además orientación hacia abajo.
    # No mezclar la formación de los dedos al entrar con el trazo. Un único corte
    # geométrico, nunca buscar el segmento con mayor softmax.
    if candidate not in {'G', 'H', 'Ñ'}:
        return 0
    hands = np.asarray(frames, dtype=np.float32).reshape(-1, 2, 21, 3)
    visible = np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6
    side = int(visible.sum(axis=0).argmax())
    if not visible[:, side].all():
        return 0
    hand = hands[:, side]
    compatible = np.ones(len(hand), dtype=bool)
    for mcp in ((5,) if candidate == 'G' else (5, 9)):
        chain = hand[:, mcp:mcp+4]
        bones = np.linalg.norm(np.diff(chain, axis=1), axis=2).sum(axis=1)
        compatible &= np.linalg.norm(chain[:, -1] - chain[:, 0], axis=1) / np.maximum(bones, 1e-6) >= 0.80
        if candidate == 'Ñ':
            compatible &= (chain[:, -1, 1] - chain[:, 0, 1]) / np.maximum(bones, 1e-6) >= .45
    if compatible[:3].all():
        return 0
    for start in range(2, len(frames)-5):
        if compatible[start:start+3].all():
            return start
    return 0


def _sustained_downward_pair(frames):
    evidence = hand_evidence(frames, allow_gaps=True)
    if evidence is None:
        return False
    _, extensions, down, _ = evidence
    _, _, two_down = pose_masks(extensions, down)
    return float(two_down.mean()) >= .65


def compatible_motion_shape(candidate, frames):
    """Un traslado de L no demuestra J/H: comprobar también sus dedos.

    En las tomas J del corpus el meñique está extendido; en H, índice y medio.
    Rechazar una contradicción clara con esas tomas, no forzar J/H a partir
    de esta geometría. La corroboración M/N se exporta por separado. Razones tip/MCP sobre la
    longitud de los huesos son invariantes a traslación, escala y giro rígido.
    """
    if candidate not in ('J', 'H', 'G', 'Ñ'):
        return True
    if candidate == 'Ñ':
        return lateral_pendulum(frames)
    hands = np.asarray(frames, dtype=np.float32).reshape(-1, 2, 21, 3)
    visibility = np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6
    side = int(visibility.sum(axis=0).argmax())
    hand = hands[visibility[:, side], side]
    if len(hand) < 6:
        return False
    extensions = []
    for mcp in (5, 9, 13, 17):
        chain = hand[:, mcp:mcp + 4]
        bones = np.linalg.norm(np.diff(chain, axis=1), axis=2).sum(axis=1)
        extensions.append(np.linalg.norm(chain[:, -1] - chain[:, 0], axis=1) / np.maximum(bones, 1e-6))
    index, middle, ring, pinky = extensions
    if candidate == 'G':
        # En las G completas grabadas los dedos no mantienen la forma N/Ñ
        # de índice y medio extendidos hacia abajo. Un traslado de esa forma
        # no es G aunque su softmax temporal sea alto.
        if _sustained_downward_pair(frames):
            return False
        # La N sostenida de la traza tiene los cuatro dedos rectos durante
        # todo el traslado. Eso contradice la G del corpus, no demuestra G.
        # Solo un veto; nunca convertir esta geometría en N/M/otra letra.
        return (float(np.median(index)) >= .80 and
                not all(float(np.median(finger)) > 0.96 for finger in (index, middle, ring, pinky)))
    if candidate == 'H':
        # Las dos H falsas de la traza tenían el medio plegado (0.32/0.43),
        # frente a >=0.99 en las tomas H. Solo veto de forma incompatible:
        # esta comprobación nunca emite H ni escoge una letra alternativa.
        # El tamaño del recorrido no distingue H de Z: imponer un máximo
        # hacía depender H de una amplitud muy específica del corpus.
        return float(np.median(index)) >= 0.80 and float(np.median(middle)) >= 0.80
    contradicts = (index > 0.85) & (pinky < 0.80) & (index - pinky > 0.20)
    return float(np.median(pinky)) >= 0.80 and float(np.mean(contradicts)) < 0.65


def _alphabet_shape_evidence(frames, model, labels, *, normalize, preprocess):
    """Corroboración independiente de formas, no una tabla palabra→letra.

    S puede parecer NO al modelo histórico de clips, pero sus formas locales
    son alfabéticas. MAL mantiene MAL en el inicio/centro/final: no debe pasar
    a Ñ por el prior de duración del modelo nuevo. Las tres consultas usan
    los pesos históricos y nunca renormalizan probabilidades residuales.
    """
    votes = 0
    for index in (0, len(frames) // 2, len(frames) - 1):
        held = np.repeat(frames[index:index + 1], SEQ_LEN, axis=0)
        probabilities = _probabilities(model, held, normalize=normalize, preprocess=preprocess)
        prediction, _, _ = evaluate_prediction(labels, probabilities, min_conf=0.70, min_margin=0.12)
        votes += prediction in ALPHABET
    return votes >= 2


@dataclass
class HybridScores:
    labels: list[str]
    probabilities: np.ndarray
    source: str
    motion: bool
    blocked: bool = False
    input_frames: int = 0
    evaluated_frames: int = 0
    preparation_frames: int = 0
    pose_evidence: dict | None = None


def _verified_pose(scores, frames):
    # Only corroborate the M/N family the historical model already detects.
    # Never promote a tiny residual alphabet probability or a word to N/M.
    family = [i for i, label in enumerate(scores.labels) if label in {'M', 'N', 'Ñ'}]
    mass = float(scores.probabilities[family].sum())
    if mass < .80:
        return scores
    pose = downward_pose(frames)
    if pose is None or pose[0] not in scores.labels:
        return scores
    label, support = pose
    probabilities = scores.probabilities.copy()
    probabilities[family] *= 1-support
    probabilities[scores.labels.index(label)] += mass*support
    # This score is neural family mass × anatomical support, NOT a newly
    # trained/calibrated class posterior. Export its provenance explicitly.
    return replace(scores, probabilities=probabilities, source='verified_finger_pose',
                   blocked=False, pose_evidence={'label': label, 'support': support,
                                                'neural_family_mass': mass})


def _verified_pendulum(scores, frames, sequence_labels, sequence_probabilities):
    # This does not turn a word or a residual alphabet score into Ñ. BOTH
    # checkpoints must already support the M/N/Ñ family. Temporal/cadence
    # candidates have priority; this resolves an otherwise static-family read.
    if 'Ñ' not in scores.labels:
        return None
    family = [i for i, label in enumerate(scores.labels) if label in {'M', 'N', 'Ñ'}]
    temporal_family = [i for i, label in enumerate(sequence_labels) if label in {'M', 'N', 'Ñ'}]
    mass = float(scores.probabilities[family].sum())
    temporal_mass = float(sequence_probabilities[temporal_family].sum())
    if min(mass, temporal_mass) < .90:
        return None
    support = unambiguous_two_finger_pendulum(frames)
    if support is None:
        return None
    # Auxiliary evidence, explicitly exported; not a calibrated NN posterior.
    weight = support * temporal_mass
    probabilities = scores.probabilities.copy()
    probabilities[family] *= 1-weight
    probabilities[scores.labels.index('Ñ')] += mass*weight
    _, extensions, down, _ = hand_evidence(frames, allow_gaps=True)
    two, three, _ = pose_masks(extensions, down)
    return replace(scores, probabilities=probabilities, source='verified_finger_pendulum',
                   blocked=False, evaluated_frames=len(frames),
                   pose_evidence={'label': 'Ñ', 'support': support, 'neural_family_mass': mass,
                                  'temporal_family_mass': temporal_mass, 'lateral_return': True,
                                  'support_scope': 'unambiguous_anatomical_frames',
                                  'anatomical_coverage': float((two | three).mean()),
                                  'two_finger_coverage': float(two.mean()),
                                  'three_finger_coverage': float(three.mean())})


def recognize_hybrid(frames, shape_model, shape_labels, sequence_model, sequence_labels,
                     *, normalize=True, preprocess=LEGACY_PREPROCESS, letters_only=False,
                     _allow_preparation=True):
    frames = np.asarray(frames, dtype=np.float32)
    shape_probabilities = _probabilities(shape_model, resample_shape(frames),
                                        normalize=normalize, preprocess=preprocess)
    has_motion = motion_evidence(frames)
    scores = HybridScores(shape_labels, shape_probabilities, "legacy_shape", has_motion,
                          input_frames=len(frames), evaluated_frames=SEQ_LEN)
    shape_prediction, _, _ = evaluate_prediction(shape_labels, shape_probabilities,
                                                 min_conf=0.80, min_margin=0.18)
    alphabet_shapes = False
    if (not letters_only and has_motion and shape_prediction and shape_prediction != 'IDLE'
            and len(shape_prediction) > 1):
        alphabet_shapes = _alphabet_shape_evidence(frames, shape_model, shape_labels,
                                                   normalize=normalize, preprocess=preprocess)
        if not alphabet_shapes:
            # La rama de formas elimina el traslado; puede decir COMO_ESTAS
            # durante una H. No cancelar ANTES de consultar el recorrido.
            # Una letra solo puede resolver esa contradicción si dos lecturas
            # temporales del MISMO recorrido y su forma coinciden.
            sequence_probabilities = _probabilities(sequence_model, frames, sequence=True,
                                                   preprocess=TRAJECTORY_PREPROCESS)
            candidate, _ = _motion_candidate(sequence_labels, sequence_probabilities)
            preparation = motion_preparation_start(candidate, frames) if _allow_preparation else 0
            if preparation:
                prepared = recognize_hybrid(frames[preparation:], shape_model, shape_labels,
                                            sequence_model, sequence_labels, normalize=normalize,
                                            preprocess=preprocess, letters_only=letters_only,
                                            _allow_preparation=False)
                return replace(prepared, input_frames=len(frames), preparation_frames=preparation)
            if candidate in {'G', 'H', 'Ñ'} and len(frames) >= 12 and compatible_motion_shape(candidate, frames):
                cadence = resample_shape(frames, max(6, (len(frames)+1)//2))
                cadence_probs = _probabilities(sequence_model, cadence, sequence=True,
                                              preprocess=TRAJECTORY_PREPROCESS)
                corroboration, _ = _motion_candidate(sequence_labels, cadence_probs)
                if corroboration == candidate:
                    return HybridScores(sequence_labels, sequence_probabilities, 'sequence_motion_word_conflict', True,
                                        input_frames=len(frames), evaluated_frames=len(frames))
            if shape_prediction in {'COMO_ESTAS', 'FAMILIA'}:
                visible = np.linalg.norm(frames.reshape(-1, 2, 21, 3)[:, :, 0, :2], axis=2) > 1e-6
                if not visible.all(axis=1).any():
                    # Las variantes registradas son de dos manos. Una H de
                    # una sola mano no demuestra COMO_ESTAS por su pose local.
                    return replace(scores, blocked=True, source='word_hand_contradiction')
            return scores
    if has_motion:
        sequence_probabilities = _probabilities(sequence_model, frames, sequence=True,
                                               preprocess=TRAJECTORY_PREPROCESS)
        primary_candidate, _ = _motion_candidate(sequence_labels, sequence_probabilities)
        preparation = motion_preparation_start(primary_candidate, frames) if _allow_preparation else 0
        if preparation:
            prepared = recognize_hybrid(frames[preparation:], shape_model, shape_labels,
                                        sequence_model, sequence_labels, normalize=normalize,
                                        preprocess=preprocess, letters_only=letters_only,
                                        _allow_preparation=False)
            return replace(prepared, input_frames=len(frames), preparation_frames=preparation)
        if primary_candidate and not compatible_motion_shape(primary_candidate, frames):
            # Un veto de dedos invalida ESA clase, no las demás lecturas del
            # mismo recorrido. Antes se abandonaba aquí aunque la cadencia
            # alternativa y el especialista de formas coincidieran en H/G/J.
            # Exigir ambas evidencias evita rescatar una clase por softmax solo.
            if len(frames) >= 12:
                cadence = resample_shape(frames, max(6, (len(frames) + 1) // 2))
                cadence_probabilities = _probabilities(sequence_model, cadence, sequence=True,
                                                      preprocess=TRAJECTORY_PREPROCESS)
                candidate, _ = _motion_candidate(sequence_labels, cadence_probabilities)
                if (candidate and candidate == shape_prediction and
                        compatible_motion_shape(candidate, frames)):
                    return HybridScores(sequence_labels, cadence_probabilities,
                                        'sequence_motion_corroborated_cadence', True,
                                        input_frames=len(frames), evaluated_frames=len(cadence))
            if primary_candidate == 'G' and _sustained_downward_pair(frames):
                # No cambiar una G contradictoria por la P de su cola móvil.
                # Conservar la lectura completa (o abstenerse si es ambigua);
                # una N sostenida puede corroborarse luego por la pose actual.
                scores.source = 'motion_shape_rejected'
                scores.blocked = canonical_label(shape_labels[int(scores.probabilities.argmax())]) in MOTION_LETTERS
                return _verified_pose(scores, frames)
            # Si el buffer aún contiene una transición, releer la forma local
            # reciente con el especialista histórico. No emitir J ni forzar L.
            scores.probabilities = _probabilities(shape_model, resample_shape(frames[-6:]),
                                                  normalize=normalize, preprocess=preprocess)
            scores.source = 'motion_shape_rejected'
            scores.blocked = canonical_label(shape_labels[int(scores.probabilities.argmax())]) in MOTION_LETTERS
            return _verified_pose(scores, frames)
        if primary_candidate and (shape_prediction not in MOTION_LETTERS or shape_prediction == primary_candidate):
            return HybridScores(sequence_labels, sequence_probabilities, "sequence_motion", True,
                                input_frames=len(frames), evaluated_frames=len(frames))
        sequence_prediction, _, _ = evaluate_prediction(sequence_labels, sequence_probabilities,
                                                        min_conf=0.80, min_margin=0.18)
        if (not letters_only and not alphabet_shapes and sequence_prediction and sequence_prediction != 'IDLE' and len(sequence_prediction) > 1
                and sequence_prediction == shape_prediction):
            # Dos ramas dicen GRACIAS/BIEN: no convertirla en J/H al acelerar
            # artificialmente la cadencia de una toma que ya era reconocible.
            return scores
        # Cadencia doble del navegador: conservar principio y fin y repartir
        # TODO el recorrido a media densidad. Nunca usar los últimos 24 cuadros.
        # Este respaldo es explícito y auditable, no convierte palabras en letras.
        if len(frames) >= 12:
            cadence = resample_shape(frames, max(6, (len(frames) + 1) // 2))
            slower_probabilities = _probabilities(sequence_model, cadence, sequence=True,
                                                 preprocess=TRAJECTORY_PREPROCESS)
            candidate, _ = _motion_candidate(sequence_labels, slower_probabilities)
            preparation = motion_preparation_start(candidate, frames) if _allow_preparation else 0
            if preparation:
                prepared = recognize_hybrid(frames[preparation:], shape_model, shape_labels,
                                            sequence_model, sequence_labels, normalize=normalize,
                                            preprocess=preprocess, letters_only=letters_only,
                                            _allow_preparation=False)
                return replace(prepared, input_frames=len(frames), preparation_frames=preparation)
            if candidate and not compatible_motion_shape(candidate, frames):
                candidate = None
            if candidate and (not primary_candidate or candidate == shape_prediction):
                return HybridScores(sequence_labels, slower_probabilities, "sequence_motion_cadence", True,
                                    input_frames=len(frames), evaluated_frames=len(cadence))
            if primary_candidate and candidate == primary_candidate:
                return HybridScores(sequence_labels, sequence_probabilities, "sequence_motion", True,
                                    input_frames=len(frames), evaluated_frames=len(frames))
            if primary_candidate and candidate and candidate != primary_candidate:
                scores.blocked = True
                scores.source = "hybrid_conflict"
                return scores
        if primary_candidate:
            # Ya hubo un desacuerdo entre letras móviles. Una S aislada contra
            # Z, sin corroboración temporal, no resuelve el recorrido mezclado.
            # Tampoco forzar la Z histórica: esperar una secuencia consistente.
            if {primary_candidate, shape_prediction} == {'S', 'Z'}:
                scores.blocked = True
                scores.source = "hybrid_conflict"
                return scores
            return HybridScores(sequence_labels, sequence_probabilities, "sequence_motion", True,
                                input_frames=len(frames), evaluated_frames=len(frames))
        pendulum = _verified_pendulum(scores, frames, sequence_labels, sequence_probabilities)
        if pendulum is not None:
            return pendulum
    # El checkpoint antiguo no decide G/H/J/S/Z/Ñ. Una postura final de J no
    # rescata J sin recorrido; tampoco basta su softmax histórico para elegirla.
    if (has_motion and len(frames) >= 12 and shape_prediction in {'M', 'N'}
            and not motion_evidence(frames[-8:])):
        # Un buffer no confirmado puede conservar M aunque ya se sostenga N.
        # Solo resolver ese desacuerdo si el MISMO checkpoint histórico ve
        # claramente otra M/N en la pose reciente quieta. No reinterpretar Ñ
        # ni borrar su recorrido: los candidatos temporales tuvieron prioridad.
        recent_probabilities = _probabilities(shape_model, resample_shape(frames[-8:]),
                                             normalize=normalize, preprocess=preprocess)
        recent_prediction, _, _ = evaluate_prediction(shape_labels, recent_probabilities,
                                                      min_conf=0.94, min_margin=0.25)
        if recent_prediction in {'M', 'N'} and recent_prediction != shape_prediction:
            return _verified_pose(HybridScores(shape_labels, recent_probabilities, 'legacy_recent_pose', has_motion,
                                  input_frames=len(frames), evaluated_frames=SEQ_LEN), frames)
    scores.blocked = canonical_label(shape_labels[int(np.argmax(shape_probabilities))]) in MOTION_LETTERS
    return _verified_pose(scores, frames)
