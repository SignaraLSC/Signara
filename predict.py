import cv2
import numpy as np
import pyttsx3
import time

from tensorflow.keras.models import load_model

from mediapipe.python.solutions import hands as mp_hands
from mediapipe.python.solutions import drawing_utils as mp_draw

# ----------------------------
# CARGAR MODELO
# ----------------------------

model = load_model("model.h5")

# ----------------------------
# LABELS
# ----------------------------

with open("labels.txt", "r") as f:
    labels = [line.strip() for line in f.readlines()]

# ----------------------------
# VOZ
# ----------------------------

engine = pyttsx3.init()

# ----------------------------
# MEDIAPIPE
# ----------------------------

hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7
)

# ----------------------------
# CAMARA
# ----------------------------

cap = cv2.VideoCapture(0)

sentence = ""

last_prediction = ""
stable_count = 0
last_added_time = time.time()

while True:

    ret, frame = cap.read()

    if not ret:
        break

    frame = cv2.flip(frame, 1)

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    results = hands.process(rgb)

    prediction_text = ""

    if results.multi_hand_landmarks:

        for hand_landmarks in results.multi_hand_landmarks:

            mp_draw.draw_landmarks(
                frame,
                hand_landmarks,
                mp_hands.HAND_CONNECTIONS
            )

            landmarks = []

            for lm in hand_landmarks.landmark:
                landmarks.extend([lm.x, lm.y, lm.z])

            if len(landmarks) == 63:

                X = np.array(landmarks).reshape(1, -1)

                prediction = model.predict(X, verbose=0)

                predicted_class = np.argmax(prediction)

                prediction_text = labels[predicted_class]

                # ESTABILIDAD
                if prediction_text == last_prediction:
                    stable_count += 1
                else:
                    stable_count = 0

                last_prediction = prediction_text

                # AGREGAR LETRA
                if stable_count > 15:

                    current_time = time.time()

                    if current_time - last_added_time > 1:

                        sentence += prediction_text

                        print(sentence)

                        engine.say(prediction_text)
                        engine.runAndWait()

                        last_added_time = current_time

                        stable_count = 0

    cv2.putText(
        frame,
        f"Prediccion: {prediction_text}",
        (10, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 255, 0),
        2
    )

    cv2.putText(
        frame,
        f"Texto: {sentence}",
        (10, 80),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (255, 255, 255),
        2
    )

    cv2.imshow("Traductor de Senas", frame)

    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break

    elif key == ord("c"):
        sentence = ""

cap.release()
cv2.destroyAllWindows()