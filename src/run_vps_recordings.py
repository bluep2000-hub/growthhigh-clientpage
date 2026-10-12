"""한 회차: 원본 보존 → 고객 Drive 복사·검증 → 기존 전사/Notion 처리."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from route_recordings import copy_routes, plan_routes
from recording_labels import parse_label
from client_mapping import client_slug_for, COMPANY_SLUGS, load_registered_clients

INTAKE_ID = '1VBAI2L_qBHLu1iJ5P4610AauGJAHUIXB'


def refresh_drive_folders(home: Path) -> Path:
    result = subprocess.run(['rclone', 'lsjson', 'recordings:', '--dirs-only',
        '--config', str(home / 'rclone.conf'), '--drive-root-folder-id', INTAKE_ID,
        '--retries', '1', '--contimeout', '10s', '--timeout', '60s'],
        check=True, capture_output=True, text=True)
    folders = {}
    known = COMPANY_SLUGS | load_registered_clients()
    rows = json.loads(result.stdout)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError('Drive 폴더 조회 응답 형식 오류')
    for folder in rows:
        name, folder_id = folder.get('Name'), folder.get('ID')
        if name not in known:
            continue
        if (folder.get('IsDir') is not True or name in folders
                or not isinstance(folder_id, str)
                or not re.fullmatch(r'[A-Za-z0-9_-]{10,200}', folder_id)
                or folder_id in folders.values()):
            raise ValueError('고객 Drive 접수 폴더를 하나로 확정할 수 없습니다')
        folders[name] = folder_id
    path = home / 'state/drive-folders.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                     delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(folders, stream, ensure_ascii=False)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def upload_names(inbox: Path) -> list[str]:
    names = []
    for path in sorted(inbox.rglob('*')):
        if path.is_symlink():
            raise ValueError('접수함에 심볼릭 링크가 있습니다')
        if not path.is_file():
            continue
        label = parse_label(path.name)
        if not label or label.internal:
            continue
        parts = path.relative_to(inbox).parts
        if len(parts) != 2 or parts[0] != label.company:
            raise ValueError('고객 폴더와 라벨이 다릅니다')
        client_slug_for(label.company)
        names.append(path.relative_to(inbox).as_posix())
    return names


def run_once(home: Path, *, dry_run=False) -> None:
    ready = home / 'ready'
    clients = ready / 'clients'
    inbox = clients / '수집대기'
    if dry_run:
        print('분류 후보:', len(plan_routes(home / 'inbox', ready)))
        print('고객 Drive 후보:', len(upload_names(inbox)))
        print('처리 인증:', '설정됨' if (home / 'pipeline/.env').is_file() else '미설정')
        return
    print('새 보관본:', copy_routes(home / 'inbox', ready), flush=True)
    inbox.mkdir(parents=True, exist_ok=True)
    names = upload_names(inbox)
    manifest = home / 'drive-files.txt'
    manifest.write_text('\n'.join(names) + ('\n' if names else ''), encoding='utf-8')
    if names:
        common = [str(inbox), 'recordings:', '--config', str(home / 'rclone.conf'),
                  '--drive-root-folder-id', INTAKE_ID, '--files-from-raw', str(manifest),
                  '--checkers', '1', '--retries', '1', '--contimeout', '10s', '--timeout', '60s']
        subprocess.run(['rclone', 'copy', *common, '--checksum', '--immutable',
                        '--transfers', '1', '--bwlimit', '2M'], check=True)
        subprocess.run(['rclone', 'check', *common, '--one-way'], check=True)
    if not (home / 'pipeline/.env').is_file():
        print('Drive 전송 완료. 전사/Notion 서버 인증 연결 대기.', flush=True)
        return
    folders_file = refresh_drive_folders(home)
    environment = dict(os.environ, TALKS_DIR=str(clients),
                       RECORDING_DRIVE_FOLDERS_FILE=str(folders_file),
                       RECORDING_JOBS_FILE=str(home / 'state/recording-jobs.json'))
    subprocess.run([sys.executable, str(Path(__file__).with_name('process_recordings.py')),
                    '--limit', '3'], env=environment, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, default=Path('/srv/growthhigh-recordings'))
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run_once(args.home.resolve(), dry_run=args.dry_run)
