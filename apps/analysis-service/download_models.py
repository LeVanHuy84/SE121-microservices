import os
import urllib.request

MODEL_DIR = "model"
os.makedirs(MODEL_DIR, exist_ok=True)

models = {
    "model_arousal.pkl": "https://drive.google.com/uc?id=1tuLglbtUTQu1boqACZAy-HPKXo8gwZd1",
    "model_valence.pkl": "https://drive.google.com/uc?id=15wzE7LMUHnP9otLHgg4keSzI5txRgH47",
}

for name, url in models.items():
    path = os.path.join(MODEL_DIR, name)
    if not os.path.exists(path):
        print(f"Downloading {name}...")
        urllib.request.urlretrieve(url, path)
    else:
        print(f"{name} already exists")
