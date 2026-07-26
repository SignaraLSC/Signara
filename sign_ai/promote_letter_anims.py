"""
Promueve una muestra raw_full por letra a animations/<LETRA>.json
(formato canónico del avatar, con cara slim). Usa la muestra con más frames.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw_full" / "juan"
ANIM = ROOT / "animations"
FPS = 30

# Mismos índices que 00_capture.slim_face / FACE_KEEP
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
FACE_R_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
FACE_L_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
FACE_R_BROW = [107, 66, 105, 63, 70]
FACE_L_BROW = [336, 296, 334, 293, 300]
FACE_LIPS_O = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
FACE_LIPS_I = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
FACE_NOSE = [168, 6, 197, 195, 5, 4]
FACE_KEEP = (
    FACE_OVAL + FACE_R_EYE + FACE_L_EYE + FACE_R_BROW + FACE_L_BROW
    + FACE_LIPS_O + FACE_LIPS_I + FACE_NOSE
)


def slim_face(face):
    return [face[i] if i < len(face) else [0.0, 0.0, 0.0] for i in FACE_KEEP]


def best_sample(letter: str) -> Path | None:
    files = list(RAW.glob(f"{letter}_*.json"))
    if not files:
        return None
    best, best_n = None, -1
    for p in files:
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            n = len(d.get("frames") or [])
            if n > best_n:
                best, best_n = p, n
        except (OSError, json.JSONDecodeError, ValueError):
            continue
    return best


def frames_to_anim(frames_in, token: str) -> dict:
    frames = [
        {
            "lh": f["lh"],
            "rh": f["rh"],
            "pose": f["pose"],
            "pose_world": f.get("pose_world", [[0.0, 0.0, 0.0]] * 33),
            "face": slim_face(f["face"]),
        }
        for f in frames_in
    ]
    return {"token": token, "fps": FPS, "frames": frames}


def promote(letter: str, out_token: str | None = None) -> bool:
    token = out_token or letter
    src = best_sample(letter)
    if not src:
        return False
    d = json.loads(src.read_text(encoding="utf-8"))
    frames_in = d.get("frames") or []
    if not frames_in:
        return False
    ANIM.mkdir(parents=True, exist_ok=True)
    path = ANIM / f"{token}.json"
    path.write_text(json.dumps(frames_to_anim(frames_in, token), separators=(",", ":")), encoding="utf-8")
    print(f"  OK {token} <- {src.name} ({len(frames_in)} frames)")
    return True


def main() -> None:
    done = 0
    for lab in [chr(c) for c in range(ord("A"), ord("Z") + 1)]:
        if promote(lab):
            done += 1
    for alt in ("Ñ", "ENYE", "NN"):
        if promote(alt, out_token="Ñ"):
            done += 1
            break
    print(f"Promovidas {done} animaciones de letra -> {ANIM}")


if __name__ == "__main__":
    main()
