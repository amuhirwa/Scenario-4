# flutter_app/assets/models/

After running the ML notebook, copy these two files here:

  ml/models/tflite/tactical_lstm_quantised.tflite  →  assets/models/
  ml/models/tflite/model_metadata.json             →  assets/models/

The TFLite model runs entirely on-device (edge inference).
No network connection is required for activity classification.
