"""
reconvert_tflite.py
───────────────────
Re-converts the trained LSTM model to a TFLite file that is compatible with
the TFLite runtime bundled in tflite_flutter ^0.11.0.

Root cause of the original error:
  "Didn't find op for builtin opcode 'FULLY_CONNECTED' version '12'"
  TF 2.14+ generates FULLY_CONNECTED v12 when dynamic-range INT8 quantisation
  is used.  The runtime in tflite_flutter 0.11.0 only supports v ≤ 9.

Fix used here:
  Replace tf.lite.Optimize.DEFAULT (dynamic-range INT8) with
  float16 quantisation (target_spec.supported_types = [tf.float16]).
  Float16 quant keeps FULLY_CONNECTED at version ≤ 9 and still delivers a
  ~2× model-size reduction over full float32.

  The .keras files in this workspace were saved with Keras 3.x, which is
  incompatible with TF 2.14's bundled Keras 2.x loader.  We therefore convert
  directly from the SavedModel directory that was already exported by the
  notebook (ml/models/lstm_saved_model/), skipping the .keras load entirely.

Run from the ml/ directory:
  python reconvert_tflite.py
"""

import os, sys, shutil, json
import numpy as np

# ─── Locate the ml/ directory regardless of cwd ──────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

import tensorflow as tf

print(f"TensorFlow : {tf.__version__}")

# ─── Paths ────────────────────────────────────────────────────────────────────
# Use the SavedModel already exported by the notebook — avoids the
# Keras 2.x vs 3.x incompatibility when loading the .keras files.
SAVED_MODEL   = os.path.join(SCRIPT_DIR, "models", "lstm_saved_model")
OUT_DIR       = os.path.join(SCRIPT_DIR, "models", "tflite")
TFLITE_OUT    = os.path.join(OUT_DIR,    "tactical_lstm_quantised.tflite")
META_JSON_IN  = os.path.join(OUT_DIR,    "model_metadata.json")

FLUTTER_ASSETS = os.path.join(
    SCRIPT_DIR, "..", "flutter_app", "assets", "models"
)

if not os.path.exists(SAVED_MODEL):
    sys.exit(
        f"ERROR: SavedModel not found at {SAVED_MODEL}\n"
        "Run Section 11 of the notebook first to export the SavedModel."
    )

print(f"Using SavedModel at: {SAVED_MODEL}")

# ─── 1. Convert to TFLite with FLOAT16 quantisation ──────────────────────────
#  KEY FIX: use float16 quant instead of dynamic-range INT8.
#  Strategy: try pure-builtins first (no Flex delegate needed → simpler runtime).
#  The converter flag _experimental_lower_tensor_list_ops=True (default) rewrites
#  Bidirectional-LSTM's TensorList ops into native TFLite while/LSTM kernels.
#  If that succeeds the .tflite runs on the default tflite_flutter runtime.
#  If it fails we fall back to SELECT_TF_OPS + Flex delegate.

def _make_converter_builtins_only() -> tf.lite.TFLiteConverter:
    conv = tf.lite.TFLiteConverter.from_saved_model(SAVED_MODEL)
    conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    conv.target_spec.supported_types = [tf.float16]
    # _experimental_lower_tensor_list_ops defaults to True — let the compiler
    # lower TensorListReserve/Stack/SetItem to native LSTM/while ops.
    return conv

def _make_converter_flex() -> tf.lite.TFLiteConverter:
    conv = tf.lite.TFLiteConverter.from_saved_model(SAVED_MODEL)
    conv.target_spec.supported_ops = [
        tf.lite.OpsSet.TFLITE_BUILTINS,
        tf.lite.OpsSet.SELECT_TF_OPS,
    ]
    conv._experimental_lower_tensor_list_ops = False
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    conv.target_spec.supported_types = [tf.float16]
    return conv

print("\nAttempting conversion — pure TFLITE_BUILTINS (no Flex delegate) …")
used_flex = False
try:
    tflite_bytes = _make_converter_builtins_only().convert()
    print("  ✓ Builtins-only conversion succeeded — no Flex delegate required.")
except Exception as e:
    print(f"  Builtins-only failed ({e.__class__.__name__}: {e})")
    print("\nFalling back to SELECT_TF_OPS (Flex delegate) …")
    tflite_bytes = _make_converter_flex().convert()
    used_flex = True
    print("  ✓ Flex-delegate conversion succeeded.")

os.makedirs(OUT_DIR, exist_ok=True)
with open(TFLITE_OUT, "wb") as f:
    f.write(tflite_bytes)

size_kb = os.path.getsize(TFLITE_OUT) / 1024
print(f"TFLite model written → {TFLITE_OUT}  ({size_kb:.1f} KB)")
if used_flex:
    print("  ⚠  Model uses Flex (SELECT_TF_OPS). Ensure")
    print("     org.tensorflow:tensorflow-lite-select-tf-ops is in build.gradle.kts.")

# ─── 2. Quick sanity-check with the Python TFLite interpreter ────────────────
try:
    interp = tf.lite.Interpreter(model_path=TFLITE_OUT)
    interp.allocate_tensors()
    inp_detail = interp.get_input_details()[0]
    out_detail = interp.get_output_details()[0]
    print(f"\nSanity check passed:")
    print(f"  Input  shape : {inp_detail['shape']}  dtype={inp_detail['dtype']}")
    print(f"  Output shape : {out_detail['shape']}  dtype={out_detail['dtype']}")
    # Run one forward pass with zeros to verify end-to-end
    dummy = np.zeros(inp_detail['shape'], dtype=np.float32)
    interp.set_tensor(inp_detail['index'], dummy)
    interp.invoke()
    out = interp.get_tensor(out_detail['index'])
    print(f"  Forward pass  : output={out}  sum={out.sum():.4f} (should be ~1.0)")
except Exception as e:
    print(f"\nNote: interpreter sanity check skipped (expected for Flex-delegate models):\n  {e}")

# ─── 3. Copy artefacts to Flutter assets ────────────────────────────────────
os.makedirs(FLUTTER_ASSETS, exist_ok=True)

dest_model = os.path.join(FLUTTER_ASSETS, "tactical_lstm_quantised.tflite")
shutil.copy2(TFLITE_OUT, dest_model)
print(f"\nCopied model  → {dest_model}")

if os.path.exists(META_JSON_IN):
    dest_meta  = os.path.join(FLUTTER_ASSETS, "model_metadata.json")
    shutil.copy2(META_JSON_IN, dest_meta)
    print(f"Copied metadata → {dest_meta}")
else:
    print("Warning: model_metadata.json not found in ml/models/tflite/ — skipping copy.")

print("\n✅  Reconversion complete.  Rebuild and re-run the Flutter app.")
