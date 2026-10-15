import io
import unittest
from worker import choose_answer, image_from_bytes, valid_answer


class WorkerTests(unittest.TestCase):
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
