"""
Inference engine for tactical activity recognition.
Loads the TF SavedModel exported from the ML notebook for server-side inference.

Using tf.saved_model.load() (rather than tf.keras.models.load_model) avoids
Keras version deserialization issues — the SavedModel format is a pure TF
artifact that is compatible across all TF 2.x environments regardless of which
Keras version is installed system-wide.

NOTE on TFLite: the quantised .tflite model requires the TFLite Flex delegate
(SELECT_TF_OPS) and is intended for the Android device only. The server uses
the SavedModel directly.
"""
from __future__ import annotations
import json
import os
import numpy as np
from typing import Optional

import tensorflow as tf

SAVED_MODEL_DIR = os.path.join(
    os.path.dirname(__file__),
    '..', 'ml', 'models', 'lstm_saved_model'
)
METADATA_PATH = os.path.join(
    os.path.dirname(__file__),
    '..', 'ml', 'models', 'tflite', 'model_metadata.json'
)

# ─── Distress detection ───────────────────────────────────────────────────────
# If a soldier has been PRONE_STILL for this many consecutive windows, raise alert
PRONE_ALERT_WINDOWS = 10     # 10 × 0.64 s ≈ 6.4 seconds of no movement


class TacticalClassifier:
    """Singleton inference engine. One instance per FastAPI process."""

    _instance: Optional["TacticalClassifier"] = None

    def __new__(cls) -> "TacticalClassifier":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._loaded = False
        return cls._instance

    def load(self) -> None:
        if self._loaded:
            return
        with open(METADATA_PATH) as f:
            self.meta = json.load(f)

        self.labels   = self.meta['label_classes']
        self.raw_mean = np.array(self.meta['raw_mean'], dtype=np.float32).reshape(1, 1, -1)
        self.raw_std  = np.array(self.meta['raw_std'],  dtype=np.float32).reshape(1, 1, -1)
        self.win_size = self.meta['window_size_samples']   # 128

        # Load via tf.saved_model to avoid Keras version deserialization issues.
        # The SavedModel was exported from the ML notebook with inference_model.export().
        # Its 'serve' endpoint accepts (1, 128, 9) float32 tensors.
        _loaded_sm = tf.saved_model.load(SAVED_MODEL_DIR)
        self._infer = _loaded_sm.serve   # concrete function — version-agnostic
        # Warm-up pass so first real request isn't slow
        _dummy = tf.constant(np.zeros((1, self.win_size, 6), dtype=np.float32))
        self._infer(_dummy)
        self._loaded = True
        print(f"[Inference] SavedModel loaded — labels: {self.labels}")

    def predict(self, sensor_channels: list[list[float]]) -> dict:
        """
        sensor_channels: list of 6 lists, each with 128 float values.
        Order: body_acc_xyz, body_gyro_xyz
        Returns: {'activity': str, 'confidence': float, 'all_probs': dict}
        """
        window = np.array(sensor_channels, dtype=np.float32).T   # (128, 6)
        window = (window - self.raw_mean[0]) / self.raw_std[0]
        inp    = window[np.newaxis, :, :]                         # (1, 128, 6)

        probs    = self._infer(tf.constant(inp)).numpy()[0]          # (n_classes,)
        pred_idx = int(np.argmax(probs))

        return {
            'activity':   self.labels[pred_idx],
            'confidence': float(probs[pred_idx]),
            'all_probs':  {lbl: float(p) for lbl, p in zip(self.labels, probs)},
        }


# Global singleton
classifier = TacticalClassifier()
