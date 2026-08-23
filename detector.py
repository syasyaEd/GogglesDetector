"""YOLO-World safety goggles detector."""

from __future__ import annotations

import threading
from typing import Any

import numpy as np

SAFETY_LABELS = {
    "safety goggles",
    "protective goggles",
    "lab goggles",
    "industrial safety goggles",
    "wraparound safety glasses",
    "safety glasses",
    "protective eyewear",
}
GLASSES_LABELS = {"eyeglasses", "sunglasses", "reading glasses", "glasses", "spectacles"}
PROMPTS = [
    "safety goggles",
    "protective goggles",
    "lab goggles",
    "industrial safety goggles",
    "wraparound safety glasses",
    "eyeglasses",
    "sunglasses",
    "reading glasses",
    "spectacles",
]


def _is_fashion(label: str) -> bool:
    return any(key in label for key in ("eyeglass", "sunglass", "reading glasses", "spectacle")) or label == "glasses"


def _is_explicit_safety(label: str) -> bool:
    # Do not treat the generic word "goggles" as PPE. Fashion goggles match that too.
    return any(
        key in label
        for key in (
            "wraparound",
            "safety goggle",
            "protective",
            "lab goggle",
            "industrial",
            "safety glasses",
            "protective eyewear",
        )
    ) or label in SAFETY_LABELS


def _kind(label: str, conf: float) -> str | None:
    if _is_fashion(label):
        return "glasses" if conf >= 0.20 else None
    if _is_explicit_safety(label):
        return "safety" if conf >= 0.28 else None
    return None


def _iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = max((ax2 - ax1) * (ay2 - ay1), 1e-9)
    area_b = max((bx2 - bx1) * (by2 - by1), 1e-9)
    return inter / (area_a + area_b - inter)


class GogglesDetector:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._device = "cpu"
        self.ready = False
        self.error: str | None = None

    def load(self) -> None:
        try:
            import ssl
            import torch
            from ultralytics import YOLOWorld

            ssl._create_default_https_context = ssl._create_unverified_context

            if torch.backends.mps.is_available():
                self._device = "mps"
            elif torch.cuda.is_available():
                self._device = "cuda"
            else:
                self._device = "cpu"

            model = YOLOWorld("yolov8s-worldv2.pt")
            model.set_classes(PROMPTS)
            dummy = np.zeros((320, 320, 3), dtype=np.uint8)
            try:
                model.predict(dummy, verbose=False, imgsz=320, device=self._device)
            except Exception:
                self._device = "cpu"
                model.predict(dummy, verbose=False, imgsz=320, device=self._device)
            self._model = model
            self.ready = True
            self.error = None
            print(f"[GoggleGuard] YOLO-World ready on {self._device}", flush=True)
        except Exception as exc:  # noqa: BLE001
            self.ready = False
            self.error = str(exc)
            print(f"[GoggleGuard] YOLO load failed: {exc}", flush=True)

    def detect(self, image_rgb: np.ndarray) -> list[dict[str, Any]]:
        if not self.ready or self._model is None:
            return []

        with self._lock:
            results = self._model.predict(
                image_rgb,
                verbose=False,
                conf=0.15,
                imgsz=640,
                device=self._device,
            )

        boxes: list[dict[str, Any]] = []
        result = results[0]
        height, width = image_rgb.shape[:2]
        names = result.names
        if result.boxes is None:
            return boxes

        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls_id = int(box.cls[0])
            label = str(names.get(cls_id, cls_id)).lower()
            conf = float(box.conf[0])
            kind = _kind(label, conf)
            if kind is None:
                continue
            boxes.append(
                {
                    "label": label,
                    "kind": kind,
                    "conf": round(conf, 3),
                    "bbox": [
                        round(x1 / width, 4),
                        round(y1 / height, 4),
                        round(x2 / width, 4),
                        round(y2 / height, 4),
                    ],
                }
            )

        safety = [item for item in boxes if item["kind"] == "safety"]
        glasses = [item for item in boxes if item["kind"] == "glasses"]
        kept_safety = []
        for item in safety:
            rivals = [g for g in glasses if _iou(item["bbox"], g["bbox"]) > 0.25]
            if rivals:
                rival = max(rivals, key=lambda g: g["conf"])
                # Close call → fashion glasses. A safety booth should not lock on ordinary glasses.
                if rival["conf"] >= item["conf"] - 0.08:
                    continue
            kept_safety.append(item)
        kept_glasses = []
        for item in glasses:
            if any(_iou(item["bbox"], other["bbox"]) > 0.25 for other in kept_safety):
                continue
            kept_glasses.append(item)
        return kept_safety + kept_glasses
