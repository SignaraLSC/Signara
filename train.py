import pandas as pd
import numpy as np

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Dense
from tensorflow.keras.utils import to_categorical

# ----------------------------
# CARGAR DATASET
# ----------------------------

data = pd.read_csv("dataset.csv")

X = data.drop("label", axis=1).values
y = data["label"].values

# ----------------------------
# ENCODE LABELS
# ----------------------------

encoder = LabelEncoder()

y_encoded = encoder.fit_transform(y)

y_categorical = to_categorical(y_encoded)

# ----------------------------
# TRAIN TEST SPLIT
# ----------------------------

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y_categorical,
    test_size=0.2,
    random_state=42
)

# ----------------------------
# MODELO
# ----------------------------

model = Sequential()

model.add(Dense(128, activation="relu", input_shape=(63,)))
model.add(Dense(64, activation="relu"))
model.add(Dense(len(encoder.classes_), activation="softmax"))

# ----------------------------
# COMPILAR
# ----------------------------

model.compile(
    optimizer="adam",
    loss="categorical_crossentropy",
    metrics=["accuracy"]
)

# ----------------------------
# ENTRENAR
# ----------------------------

model.fit(
    X_train,
    y_train,
    epochs=50,
    batch_size=16,
    validation_data=(X_test, y_test)
)

# ----------------------------
# GUARDAR MODELO
# ----------------------------

model.save("model.h5")

# ----------------------------
# GUARDAR LABELS
# ----------------------------

with open("labels.txt", "w") as f:

    for label in encoder.classes_:
        f.write(label + "\n")

print("\nMODELO ENTRENADO Y GUARDADO")