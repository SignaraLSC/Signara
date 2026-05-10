import cv2
import csv
import os
import mediapipe as mp

from mediapipe.tasks import python
from mediapipe.tasks.python import vision

BaseOptions = python.BaseOptions
HandLandmarker = vision.HandLandmarker
HandLandmarkerOptions = vision.HandLandmarkerOptions
VisionRunningMode = vision.RunningMode

MODEL_PATH = "hand_landmarker.task"

if not os.path.exists(MODEL_PATH):
    print("No se encontró hand_landmarker.task")
    exit()

options = HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=VisionRunningMode.IMAGE,
    num_hands=1
)

detector = HandLandmarker.create_from_options(options)

dataset_file = "dataset.csv"

if not os.path.exists(dataset_file):
    with open(dataset_file, "w", newline="") as f:
        writer = csv.writer(f)

current_label = "A"

cap = cv2.VideoCapture(0)

HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),
    (9,13),(13,14),(14,15),(15,16),
    (13,17),(17,18),(18,19),(19,20),
    (0,17)
]

print("Presiona letras o números")
print("S = guardar")
print("Q = salir")

while True:

    ret, frame = cap.read()

    if not ret:
        break

    frame = cv2.flip(frame, 1)

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=rgb
    )

    result = detector.detect(mp_image)

    landmarks_data = []

    if result.hand_landmarks:

        for hand_landmarks in result.hand_landmarks:

            points = []

            h, w, _ = frame.shape

            for landmark in hand_landmarks:

                landmarks_data.extend([
                    landmark.x,
                    landmark.y,
                    landmark.z
                ])

                cx = int(landmark.x * w)
                cy = int(landmark.y * h)

                points.append((cx, cy))

                cv2.circle(
                    frame,
                    (cx, cy),
                    6,
                    (0,255,0),
                    -1
                )

            for connection in HAND_CONNECTIONS:

                start_idx, end_idx = connection

                cv2.line(
                    frame,
                    points[start_idx],
                    points[end_idx],
                    (255,0,0),
                    2
                )

    cv2.putText(
        frame,
        f"Label: {current_label}",
        (10,40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0,255,0),
        2
    )

    cv2.imshow("Recolector IA", frame)

    key = cv2.waitKey(1)

    if key == ord('q'):
        break

    elif key == ord('s'):

        if len(landmarks_data) == 63:

            row = landmarks_data + [current_label]

            with open(dataset_file, "a", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(row)

            print(f"Guardado: {current_label}")

    elif key != -1:

        try:
            current_label = chr(key).upper()
            print(f"Label actual: {current_label}")
        except:
            pass

cap.release()
cv2.destroyAllWindows()