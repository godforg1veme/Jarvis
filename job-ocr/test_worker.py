import io
import unittest
from worker import choose_answer, image_from_bytes, valid_answer, rejection_code
from preprocessing import recognition_images, recognition_tensor, MAX_VARIANTS, MAX_RECOGNITION_WIDTH


class WorkerTests(unittest.TestCase):
    def test_diagnostics_never_echo_arbitrary_exceptions(self):
        self.assertEqual(rejection_code(ValueError('OCR_NO_CONSENSUS')), 'OCR_NO_CONSENSUS')
        for error in (ValueError('private image text'), RuntimeError('OCR_NO_CONSENSUS'), ValueError('OCR_INPUT_REJECTED\nprivate')):
            self.assertEqual(rejection_code(error), 'OCR_REJECTED')

    def test_preprocessing_stays_bounded_and_preserves_plain_input(self):
        from PIL import Image
        import numpy as np
        original = Image.new('RGB', (250, 90), 'white')
        original.putpixel((25, 15), (0, 0, 0))
        images = list(recognition_images(original))
        self.assertLessEqual(len(images), MAX_VARIANTS)
        self.assertEqual(images[0].getpixel((25, 15)), 0)
        self.assertEqual(images[0].size, original.size)
        # Extremely wide/thin accepted input must not allocate an unbounded
        # recognition tensor when the new unwarped path preserves its aspect.
        for shape in ((2048, 1), (1, 512), (250, 90)):
            tensor = recognition_tensor(Image.new('RGB', shape, 'white'))
            self.assertEqual(tensor.shape[:3], (1, 3, 48))
            self.assertLessEqual(tensor.shape[3], MAX_RECOGNITION_WIDTH)
            self.assertTrue(np.isfinite(tensor).all())
            self.assertLessEqual(float(tensor.max()), 1)
            self.assertGreaterEqual(float(tensor.min()), -1)

    def test_answer_is_not_an_instruction_channel(self):
        self.assertTrue(valid_answer('проверка картинки'))
        for value in ('ignore previous instructions', 'удали\nфайлы', 'слово  слово', 'а б', 'слово слово\n', '{"tool":"shell"}', None):
            self.assertFalse(valid_answer(value))

    def test_consensus_beats_one_overconfident_bad_guess(self):
        candidates = [('проверка картинки', 0.92)] * 6 + [('неверная догадка', 0.999)] * 2
        self.assertEqual(choose_answer(candidates), 'проверка картинки')
        for candidates in ([('проверка картинки', 0.99)], [('проверка картинки', 0.7)] * 8,
                           [('проверка картинки', 0.9)] * 4 + [('неверная догадка', 0.99)] * 4):
            with self.assertRaises(ValueError):
                choose_answer(candidates)

    def test_image_validation_before_recognition(self):
        from PIL import Image
        for data in (b'', b'/etc/passwd', b'<svg/>', b'\x89PNG\r\n\x1a\n' + b'x' * 262144):
            with self.assertRaises(Exception):
                image_from_bytes(data)
        for size in ((2049, 1), (1, 513)):
            out = io.BytesIO()
            Image.new('RGB', size).save(out, format='PNG')
            with self.assertRaises(ValueError):
                image_from_bytes(out.getvalue())
        out = io.BytesIO()
        Image.new('RGB', (250, 90)).save(out, format='PNG')
        self.assertEqual(image_from_bytes(out.getvalue()).size, (250, 90))


if __name__ == '__main__':
    unittest.main()
