import os
import re
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recording_labels import parse_label, phone_filter
from route_recordings import plan_routes, copy_routes, digest


class LabelRoutingTests(unittest.TestCase):
    def test_64_mib_binary_copy(self):
        # 실제 휴대폰/SFTP 테스트가 아니라 분류기의 큰 파일 보존 검사다.
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / 'phone', Path(tmp) / 'ready'
            source.mkdir()
            p = source / '261008_내부_오전미팅.m4a'
            with p.open('wb') as stream:
                for _ in range(64):
                    stream.write(b'\x01' * 1024 * 1024)
            os.utime(p, (time.time() - 180, time.time() - 180))
            self.assertEqual(copy_routes(source, output), 1)
            target = output / 'internal' / p.name
            self.assertEqual(target.stat().st_size, 64 * 1024 * 1024)
            self.assertEqual(digest(p), digest(target))

    def test_phone_filter_only_accepts_registered_names_and_explicit_labels(self):
        rule = re.compile(phone_filter())
        for name in ['261008_내부_오전미팅.m4a', '261008_위프코리아_통화_1430.m4a', '261008_보울게임즈_미팅_1600.M4A', '261008_위프코리아_통화.m4a', '261008_위프코리아_통화_2.m4a', '261008_위프코리아_미팅_3.m4a']:
            self.assertIsNotNone(rule.fullmatch(name))
        for name in ['261008_미등록기업_통화_1430.m4a', '261008_위프코리아_통화_0.m4a', '261008_내부_통화_1430.m4a', '261008_내부_오전미팅.m4a.partial', '261008 오전미팅.m4a']:
            self.assertIsNone(rule.fullmatch(name))

    def test_strict_labels(self):
        for name in ['261008_내부_오전미팅.m4a', '261008_내부_마감미팅.m4a',
                     '261008_위프코리아_통화_1430.m4a', '261008_위프코리아_미팅_1600.M4A',
                     '240229_내부_오전미팅.m4a', '261008_위프코리아_통화.m4a',
                     '261008_위프코리아_통화_2.m4a', '261008_위프코리아_미팅_3.m4a']:
            self.assertIsNotNone(parse_label(name), name)
        for name in ['음성 001.m4a', '261008 오전미팅.m4a', '260231_내부_오전미팅.m4a',
                     '260229_내부_오전미팅.m4a', '261008_위프코리아_통화_0.m4a',
                     '261008_위프코리아_통화_02.m4a', '261008_내부_오전미팅_2.m4a',
                     '261008_위프코리아_통화_2460.m4a', '261008_내부_통화_1430.m4a',
                     '261008_위프코리아_오전미팅.m4a', '261008_위프코리아_통화_1430.m4a.partial',
                     '261008_위프코리아_통화 (0).m4a', '../261008_내부_오전미팅.m4a']:
            self.assertIsNone(parse_label(name), name)

    def test_copy_separates_routes_and_preserves_originals(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, output = root / 'phone', root / 'ready'
            source.mkdir()
            names = ['261008_내부_오전미팅.m4a', '261008_위프코리아_통화.m4a',
                     '261008_위프코리아_통화_2.m4a', '음성001.m4a',
                     '261008_내부_마감미팅.m4a.partial']
            for index, name in enumerate(names):
                p = source / name
                p.write_bytes(str(index).encode())
                os.utime(p, (time.time() - 180, time.time() - 180))
            self.assertEqual(len(plan_routes(source, output)), 3)
            self.assertFalse(output.exists())  # 미리보기에는 쓰기 없음
            self.assertEqual(copy_routes(source, output), 3)
            self.assertEqual(copy_routes(source, output), 0)
            self.assertEqual((output / 'internal' / names[0]).read_bytes(), b'0')
            for index in [1, 2]:
                self.assertEqual((output / 'clients' / '수집대기' / '위프코리아' / names[index]).read_bytes(), str(index).encode())
            self.assertEqual(len(list(source.iterdir())), len(names))
            renamed = source / '261008_보울게임즈_통화_1430.m4a'
            renamed.write_bytes(b'1')
            os.utime(renamed, (time.time() - 180, time.time() - 180))
            with self.assertRaisesRegex(ValueError, '다른 라벨'):
                copy_routes(source, output)
            self.assertFalse((output / 'clients' / '수집대기' / '보울게임즈').exists())

    def test_unknown_company_recent_upload_and_existing_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, output = Path(tmp) / 'phone', Path(tmp) / 'ready'
            source.mkdir()
            p = source / '261008_위프코리아_통화_1430.m4a'
            p.write_bytes(b'one')
            self.assertEqual(plan_routes(source, output), [])
            os.utime(p, (time.time() - 180, time.time() - 180))
            copy_routes(source, output)
            p.write_bytes(b'two')
            os.utime(p, (time.time() - 180, time.time() - 180))
            self.assertEqual(copy_routes(source, output), 1)
            self.assertEqual(copy_routes(source, output), 0)
            folder = output / 'clients' / '수집대기' / '위프코리아'
            self.assertEqual((folder / p.name).read_bytes(), b'one')
            self.assertEqual((folder / '261008_위프코리아_통화_2.m4a').read_bytes(), b'two')
            p.rename(source / '261008_미등록기업_통화_1430.m4a')
            with self.assertRaisesRegex(ValueError, '등록되지 않은'):
                plan_routes(source, output)

    def test_two_same_named_uploads_and_automatic_phone_suffix_are_preserved(self):
        self.assertIsNotNone(parse_label('261008_위프코리아_통화 (1).m4a'))
        self.assertIsNotNone(re.fullmatch(phone_filter(), '261008_위프코리아_통화 (1).m4a'))
        with tempfile.TemporaryDirectory() as temporary:
            source, output = Path(temporary) / 'inbox', Path(temporary) / 'ready'
            for stamp, content in [('20261008_101010_123', b'first call'),
                                   ('20261008_101010_124', b'second call')]:
                folder = source / stamp
                folder.mkdir(parents=True)
                audio = folder / '261008_위프코리아_통화.m4a'
                audio.write_bytes(content)
                os.utime(audio, (time.time() - 180, time.time() - 180))
            self.assertEqual(copy_routes(source, output), 2)
            self.assertEqual(copy_routes(source, output), 0)
            copies = output / 'clients/수집대기/위프코리아'
            self.assertEqual({p.read_bytes() for p in copies.iterdir()}, {b'first call', b'second call'})
            self.assertEqual(len(list(source.rglob('*.m4a'))), 2)

    def test_timestamp_inbox_rejects_symlink_escape(self):
        if os.name == 'nt':
            self.skipTest('Windows symlink creation needs separate privileges; checked on VPS')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'inbox/20261008_101010_123'
            folder.mkdir(parents=True)
            (folder / '261008_위프코리아_통화.m4a').symlink_to(root / 'outside')
            with self.assertRaisesRegex(ValueError, '심볼릭 링크'):
                plan_routes(root / 'inbox', root / 'ready')


if __name__ == '__main__':
    unittest.main()
