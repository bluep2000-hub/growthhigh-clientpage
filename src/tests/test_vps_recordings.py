from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import json
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_vps_recordings as runner
from transcribe_drive import recover_notion_record
from recording_jobs import RecordingJobStore
from notion_talk_drafts import NotionDraftError
from test_notion_talk_drafts import FakeClient, job


class VpsTests(unittest.TestCase):
    def test_bridge_verifies_before_processing_and_stops_on_copy_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            source = home / 'ready/clients/수집대기/위프코리아/261008_위프코리아_통화.m4a'
            source.parent.mkdir(parents=True)
            source.write_bytes(b'call')
            (home / 'pipeline').mkdir()
            (home / 'pipeline/.env').write_text('test')
            with patch.object(runner, 'copy_routes', return_value=0), patch.object(runner.subprocess, 'run') as run, \
                    patch.object(runner, 'refresh_drive_folders', return_value=home / 'state/drive-folders.json'):
                runner.run_once(home)
                commands = [call.args[0] for call in run.call_args_list]
                self.assertEqual(commands[0][:2], ['rclone', 'copy'])
                self.assertIn('--immutable', commands[0])
                self.assertEqual(commands[1][:2], ['rclone', 'check'])
                self.assertIn('process_recordings.py', commands[2][1])
                self.assertIn(runner.INTAKE_ID, commands[0])
                run.reset_mock()
                run.side_effect = subprocess.CalledProcessError(1, 'rclone')
                with self.assertRaises(subprocess.CalledProcessError):
                    runner.run_once(home)
                self.assertEqual(run.call_count, 1)
            source.rename(source.with_name('261008_보울게임즈_통화.m4a'))
            with self.assertRaisesRegex(ValueError, '라벨'):
                runner.upload_names(home / 'ready/clients/수집대기')

    def test_existing_notion_record_is_recovered_before_transcription(self):
        item = job()
        page = {'id': 'existing', 'url': 'https://notion.so/existing', 'properties': {
            '기업명': {'multi_select': [{'name': '위프코리아'}]},
            '일자': {'date': {'start': item['occurred_at']}},
            '소통형태': {'multi_select': [{'name': '유선'}]},
            '고객 공개': {'checkbox': True},
        }}
        with tempfile.TemporaryDirectory() as temporary, \
                patch('notion_talk_drafts.recording_drive_folder_for', return_value='1Xh_QjqM8Jletd1NG6fep7khsDN_Vc-p_'):
            store = RecordingJobStore(Path(temporary) / 'jobs.json')
            store.ensure_received(job_id=item['id'], source_relative_path=item['source_name'],
                source_name=item['source_name'], source_size=4, source_modified_at='',
                company_name=item['company_name'], company_slug=item['company_slug'],
                channel=item['channel'], occurred_at=item['occurred_at'], transcript_name='test.txt')
            client = FakeClient([page])
            self.assertTrue(recover_notion_record(store, item, client))
            self.assertEqual(store.get(item['id'])['notion_page_id'], 'existing')
            self.assertEqual(len(client.calls), 1)
            page['properties']['소통형태']['multi_select'] = [{'name': '미팅'}]
            with self.assertRaisesRegex(NotionDraftError, '소통형태'):
                recover_notion_record(store, item, client)

    def test_live_folder_index_refuses_duplicate_names_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            rows = [{'Name': '위프코리아', 'ID': 'whiff_folder_123', 'IsDir': True},
                    {'Name': '보울게임즈', 'ID': 'bowl_folder_456', 'IsDir': True}]
            with patch.object(runner.subprocess, 'run') as run:
                run.return_value.stdout = json.dumps(rows)
                path = runner.refresh_drive_folders(home)
                saved = path.read_bytes()
                self.assertEqual(json.loads(saved), {'위프코리아': 'whiff_folder_123', '보울게임즈': 'bowl_folder_456'})
                rows.append({'Name': '위프코리아', 'ID': 'other_folder_789', 'IsDir': True})
                run.return_value.stdout = json.dumps(rows)
                with self.assertRaisesRegex(ValueError, '하나로 확정'):
                    runner.refresh_drive_folders(home)
                self.assertEqual(path.read_bytes(), saved)

if __name__ == '__main__':
    unittest.main()
