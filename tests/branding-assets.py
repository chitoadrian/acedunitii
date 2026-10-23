"""Decode the actual exported bitmaps; verify alpha and approved source pixels."""
from pathlib import Path
import unittest
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]


class BrandingAssets(unittest.TestCase):
    def test_full_logo_colors_are_original_not_reconstructed(self):
        source = Image.open(ROOT / 'assets/branding/edunity-official-source.png').convert('RGB')
        logo = Image.open(ROOT / 'assets/ac-edunity-logo.png').convert('RGBA')
        # Exact source bbox; alpha changes only the neutral outer canvas.
        expected = source.crop((202,129,1070,1173))
        self.assertEqual(logo.size, expected.size)
        self.assertIsNone(ImageChops.difference(logo.convert('RGB'),expected).getbbox())

    def test_icons_are_transparent_and_have_visible_colored_pixels(self):
        for name in ['favicon.png','favicon-192.png','favicon-48.png','favicon-32.png','favicon-16.png','apple-touch-icon.png']:
            with self.subTest(name=name):
                im = Image.open(ROOT / name).convert('RGBA')
                self.assertEqual(im.getpixel((0,0))[3],0)
                self.assertEqual(im.getpixel((im.width-1,im.height-1))[3],0)
                self.assertEqual(im.getchannel('A').getextrema(),(0,255))
                box = im.getchannel('A').getbbox()
                self.assertGreater(box[2]-box[0], im.width*.8)
                self.assertGreater(box[3]-box[1], im.height*.85)

    def test_all_ico_frames_decode_and_keep_alpha(self):
        with Image.open(ROOT / 'favicon.ico') as im:
            for size in im.ico.sizes():
                frame = im.ico.getimage(size).convert('RGBA')
                self.assertEqual(frame.size,size)
                self.assertEqual(frame.getpixel((0,0))[3],0)

    def test_social_preview_fully_decodes_at_declared_dimensions(self):
        im = Image.open(ROOT / 'assets/og-image.webp')
        im.load()
        self.assertEqual(im.size,(1200,630))
        self.assertEqual(im.mode,'RGB')


if __name__ == '__main__':
    unittest.main()
