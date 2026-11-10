# SPDX-License-Identifier: GPL-3.0-or-later
import pathlib
import tempfile
import unittest

import numpy as np

from compare import SIZE, differences
from setup import verify


class FidelityGate(unittest.TestCase):
    def test_generated_pixels_cannot_hide_in_unchanged_context(self):
        reference = np.zeros((1, 3, SIZE, SIZE), dtype=np.float32)
        actual = reference.copy()
        mask = np.zeros((1, 1, SIZE, SIZE), dtype=np.float32)
        mask[:, :, 10:20, 10:20] = 1
        actual[:, :, 10:20, 10:20] = 20
        stats = differences(reference, actual, mask)
        self.assertEqual(stats["whole"]["p99"], 0)
        self.assertEqual(stats["masked"]["p99"], 20)

    def test_nonfinite_or_wrong_shape_outputs_never_pass(self):
        reference = np.zeros((1, 3, SIZE, SIZE), dtype=np.float32)
        mask = np.ones((1, 1, SIZE, SIZE), dtype=np.float32)
        for value in (float("nan"), float("inf")):
            invalid = reference.copy()
            invalid[0, 0, 0, 0] = value
            with self.assertRaises(ValueError):
                differences(reference, invalid, mask)
        with self.assertRaises(ValueError):
            differences(reference, reference[0], mask)

    def test_wrong_asset_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "model"
            path.write_bytes(b"wrong model")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                verify(path, "0" * 64)


if __name__ == "__main__":
    unittest.main()
