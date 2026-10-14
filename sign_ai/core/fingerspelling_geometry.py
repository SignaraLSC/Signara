"""Evidence for the recorded N/M/Ñ variant, not a universal alphabet detector.

N: index/middle down; M: index/middle/ring down; Ñ: two-finger lateral
pendulum. Estimates may be unreliable under occlusion: unknown is not a vote.
No frames or checkpoint inputs are altered by these checks.
"""
import numpy as np


def hand_evidence(frames, *, allow_gaps=False):
    hands = np.asarray(frames, dtype=np.float32).reshape(-1, 2, 21, 3)
    visible = np.linalg.norm(hands[:, :, 0, :2], axis=2) > 1e-6
    side = int(visible.sum(axis=0).argmax())
    if np.mean(visible.all(axis=1)) > .20:
        return None
    if not visible[:, side].all() and (not allow_gaps or float(visible[:, side].mean()) < .85):
        return None
    # Solo para corroborar el péndulo, tolerar pérdidas breves. La red recibe
    # todos los cuadros RAW; esta vista nunca rellena ni reescribe sus datos.
    hand = hands[visible[:, side], side]
    if len(hand) < 6:
        return None
    extensions, down = [], []
    for mcp in (5, 9, 13, 17):
        chain = hand[:, mcp:mcp+4]
        length = np.linalg.norm(np.diff(chain, axis=1), axis=2).sum(axis=1)
        if np.any(length < 1e-5):
            return None
        extensions.append(np.linalg.norm(chain[:, -1]-chain[:, 0], axis=1)/length)
        down.append((chain[:, -1, 1]-chain[:, 0, 1])/length)
    extensions, down = np.array(extensions).T, np.array(down).T
    scale = max(float(np.median(np.linalg.norm(hand[:, [5, 9, 17], :2]-hand[:, :1, :2], axis=2).max(axis=1))), .025)
    return hand, extensions, down, scale


def pose_masks(extensions, down):
    first_two = (extensions[:, :2].min(axis=1) >= .85) & (down[:, :2].min(axis=1) >= .45)
    two = first_two & (extensions[:, 2] <= .65) & (extensions[:, 3] <= .80)
    three = first_two & (extensions[:, 2] >= .85) & (down[:, 2] >= .45) & (extensions[:, 3] <= .80)
    return two, three, first_two


def downward_pose(frames):
    """A sustained anatomical vote; not a correction based on a label alone."""
    evidence = hand_evidence(np.asarray(frames)[-8:])
    if evidence is None:
        return None
    hand, extensions, down, scale = evidence
    if np.linalg.norm(np.ptp(hand[:, 0, :2], axis=0)) >= scale * .18:
        return None
    two, three, _ = pose_masks(extensions, down)
    # The three decisive fingers must keep their configuration. A fluctuating
    # folded pinky is not counted as a fourth finger or as a new pose.
    spread = np.ptp(np.percentile(extensions[:, :3], [10, 90], axis=0), axis=0)
    if float(spread.max()) > .12:
        return None
    for label, votes in (('N', two), ('M', three)):
        support = float(votes.mean())
        if int(votes.sum()) >= 6 and support >= .75:
            return label, support
    return None


def lateral_pendulum(frames):
    evidence = hand_evidence(frames, allow_gaps=True)
    if evidence is None:
        return False
    hand, extensions, down, scale = evidence
    _, three, first_two = pose_masks(extensions, down)
    # A clear, persistent third finger contradicts this Ñ variant. Ambiguous
    # ring/pinky estimates do not hard-block a neural Ñ under occlusion.
    if float(first_two.mean()) < .65 or float(three.mean()) > .60:
        return False
    paths = []
    for tip in (8, 12):
        raw = hand[:, tip, :2] / scale
        xy = np.array([np.median(raw[max(0, i-1):i+2], axis=0) for i in range(len(raw))])
        paths.append(xy)
        path = xy[:, 0]
        # Exigir una ida y vuelta de amplitud real, no sumar diminutos
        # retrocesos de jitter hasta convertir una N quieta en Ñ.
        low_before = np.minimum.accumulate(path)
        low_after = np.minimum.accumulate(path[::-1])[::-1]
        high_before = np.maximum.accumulate(path)
        high_after = np.maximum.accumulate(path[::-1])[::-1]
        swing = max(float(np.minimum(path-low_before, path-low_after).max()),
                    float(np.minimum(high_before-path, high_after-path).max()))
        if float(np.ptp(path)) < .25 or swing < .10:
            return False
    # El retorno X por sí solo aceptaba la entrada diagonal de una N.
    # Exigir un vaivén X compartido y dominante. Una punta puede tener
    # saltos Y por oclusión: debe existir al menos otra que corrobore el eje,
    # pero AMBAS siguen necesitando retorno y correlación lateral.
    extents = np.array([np.ptp(np.percentile(p, [10, 90], axis=0), axis=0) for p in paths])
    if float(extents[:, 0].min()) < 1.2 * float(extents[:, 1].min()):
        return False
    correlation = float(np.corrcoef(paths[0][:, 0], paths[1][:, 0])[0, 1])
    if not np.isfinite(correlation) or correlation < .85:
        return False
    return True


def unambiguous_two_finger_pendulum(frames):
    """Stricter evidence for an auxiliary Ñ vote, not for vetoing neural Ñ.

    Unlike the occlusion-tolerant neural corroboration, this requires
    sustained two-finger evidence, little three-finger contradiction and
    a coherent lateral return. Unknown ring estimates are not votes for M.
    A vertical reposition, three-finger swing or insufficient coverage is unknown.
    """
    evidence = hand_evidence(frames, allow_gaps=True)
    if evidence is None or not lateral_pendulum(frames):
        return None
    _, extensions, down, _ = evidence
    two, three, _ = pose_masks(extensions, down)
    known = two | three
    if float(known.mean()) < .65 or float(two.mean()) < .60 or float(three.mean()) > .20:
        return None
    # El soporte es condicional a cuadros anatómicamente inequívocos.
    # Los desconocidos no son evidencia de tres dedos ni se eliminan de
    # la entrada neuronal. La cobertura mínima impide ignorar casi la toma.
    support = float(two.sum() / known.sum())
    if support < .75:
        return None
    return support
