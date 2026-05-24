import pandas as pd
import os
import glob

# =========================================
# BUSCAR TODOS LOS DATASETS INDIVIDUALES
# =========================================
archivos = sorted(glob.glob("data/*_dataset.csv"))

if not archivos:
    print("❌ No se encontraron archivos *_dataset.csv en data/")
    print("👉 Cada persona debe recolectar su dataset primero con 01_collect.py")
    exit(1)

print(f"📂 Encontrados {len(archivos)} dataset(s):")

dfs = []

for archivo in archivos:
    try:
        df = pd.read_csv(archivo, header=None, engine="python", on_bad_lines="skip")
        print(f"  ✅ {archivo}: {df.shape[0]} muestras | clases: {sorted(df[0].unique().tolist())}")
        dfs.append(df)
    except Exception as e:
        print(f"  ⚠  {archivo}: error al leer → {e}")

if not dfs:
    print("❌ No se pudo leer ningún dataset.")
    exit(1)

# =========================================
# UNIR TODOS
# =========================================
df_final = pd.concat(dfs, ignore_index=True)

# =========================================
# RESUMEN
# =========================================
print(f"\n📦 Dataset final: {df_final.shape[0]} muestras totales")
print(f"🧠 Clases: {sorted(df_final[0].unique().tolist())}")
print(f"📏 Features por muestra: {df_final.shape[1] - 1}")

# =========================================
# GUARDAR
# =========================================
os.makedirs("data", exist_ok=True)
df_final.to_csv("data/dataset.csv", index=False, header=False)

print("\n✅ Dataset fusionado correctamente")
print("💾 Guardado en: data/dataset.csv")
print("\n👉 Ahora ejecuta: python 02_train.py")
