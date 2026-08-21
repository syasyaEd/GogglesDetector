"""GoggleGuard booth server — live camera, goggles AI, email souvenirs."""

from __future__ import annotations

import io
import mimetypes
import os
import threading
from datetime import datetime
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image

from detector import GogglesDetector
from mailer import is_valid_email, mail_app_available, send_photo, smtp_configured

load_dotenv()

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".task")

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
SENT = ROOT / "sent_photos"
SENT.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")
CORS(app)

detector = GogglesDetector()


def _boot_model() -> None:
    detector.load()


threading.Thread(target=_boot_model, daemon=True).start()


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/api/health")
def health():
    return jsonify(
        {
            "yolo": detector.ready,
            "error": detector.error,
            "smtp": smtp_configured(),
            "mail_app": mail_app_available(),
            "email_ready": smtp_configured() or mail_app_available(),
        }
    )


@app.post("/api/detect")
def detect():
    if "image" not in request.files and not request.data:
        return jsonify({"ok": False, "error": "No image"}), 400

    if "image" in request.files:
        raw = request.files["image"].read()
    else:
        raw = request.data

    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:  # noqa: BLE001
        return jsonify({"ok": False, "error": "Invalid image"}), 400

    array = np.array(image)
    boxes = detector.detect(array) if detector.ready else []
    return jsonify({"ok": True, "ready": detector.ready, "boxes": boxes})


@app.post("/api/send")
def send():
    email = (request.form.get("email") or "").strip()
    status_label = request.form.get("status") or "Safety check complete"
    filter_name = request.form.get("filter") or "Natural"
    file = request.files.get("image")

    if not is_valid_email(email):
        return jsonify({"ok": False, "error": "Please enter a valid email address."}), 400
    if file is None:
        return jsonify({"ok": False, "error": "Missing photo."}), 400

    image_bytes = file.read()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_email = "".join(ch if ch.isalnum() or ch in "._-+@" else "_" for ch in email)
    photo_path = SENT / f"{stamp}_{safe_email}.jpg"
    photo_path.write_bytes(image_bytes)
    log_path = SENT / "log.csv"
    if not log_path.exists():
        log_path.write_text("time,email,status,filter,result\n", encoding="utf-8")

    result = send_photo(email, image_bytes, status_label, filter_name)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(
            f"{stamp},{email},{status_label},{filter_name},{result.get('via') or result.get('error')}\n"
        )

    status = 200 if result.get("ok") else 500
    return jsonify(result), status


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5050"))
    print(f"[GoggleGuard] Open http://127.0.0.1:{port}", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
