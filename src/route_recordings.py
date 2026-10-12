"""VPS 수신 폴더를 내부/고객 접수함으로 복사한다. 기본은 읽기 전용 미리보기.

공유 Drive 전송기는 이 출력 폴더만 복사해야 한다. 원본은 삭제하지 않는다.
SFTP는 .partial 업로드 후 rename을 사용하고 이 명령은 전송 완료 후 실행한다.
"""

import argparse
import hashlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
import shutil
import tempfile
import time

from client_mapping import client_slug_for
from recording_labels import parse_label


def digest(path: Path) -> str:
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def plan_routes(source: Path, output: Path, *, now=None) -> list[tuple[Path, Path]]:
    source, output = source.resolve(), output.resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('수신 폴더와 출력 폴더는 서로 분리해야 합니다')
    if not source.is_dir():
        raise ValueError('수신 폴더가 없습니다')
    now = time.time() if now is None else now
    routes = []
    # FolderSync 수정시각 정렬: 같은 파일명도 별도 수신 경로에서 보존한다.
    paths = []
    for entry in source.iterdir():
        if entry.is_symlink():
            raise ValueError('수신 경로에 심볼릭 링크가 있습니다')
        if entry.is_file():
            paths.append(entry)  # 기존 평면 접수함과 호환.
        elif entry.is_dir() and re.fullmatch(r'[0-9]{8}_[0-9]{6}_[0-9]{3}', entry.name):
            datetime.strptime(entry.name, '%Y%m%d_%H%M%S_%f')
            paths.extend(entry.iterdir())
    for path in sorted(paths):
        if path.is_symlink() or not path.is_file():
            if path.is_symlink():
                raise ValueError('수신 경로에 심볼릭 링크가 있습니다')
            continue
        label = parse_label(path.name)
        if not label:
            continue
        stat = path.stat()
        if not 0 < stat.st_size <= 512 * 1024 * 1024 or now - stat.st_mtime < 120:
            continue
        if label.internal:
            target = output / 'internal' / path.name
        else:
            client_slug_for(label.company)  # 알 수 없는 고객은 출력 폴더도 만들지 않는다.
            target = output / 'clients' / '수집대기' / label.company / path.name
        if not target.resolve().is_relative_to(output):
            raise ValueError('출력 경로가 저장 폴더 밖입니다')
        routes.append((path, target))
    return routes


def copy_routes(source: Path, output: Path) -> int:
    routes = plan_routes(source, output)
    output.mkdir(parents=True, exist_ok=True)
    lock = output / '.route.lock'
    # ponytail: 한 워커만 허용. 비정상 종료의 잠금은 프로세스 확인 뒤 수동 해제한다.
    with lock.open('x') as handle:
        handle.write(str(os.getpid()))
    try:
        state_path = output / '.route-state.json'
        state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
        if not isinstance(state, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in state.items()):
            raise ValueError('분류 장부 형식 오류')
        prepared = []
        batch = dict(state)
        reserved = {name: sha for sha, name in batch.items()}
        # 다른 고객/내부·외부/유형으로 바뀐 동일 녹음은 첫 복사 전에 중단한다.
        for path, target in routes:
            before = path.stat()
            sha = digest(path)
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('업로드 중인 파일입니다')
            label = parse_label(path.name)
            if sha in batch:
                previous = output / batch[sha]
                previous_label = parse_label(previous.name)
                if (not previous.resolve().is_relative_to(output.resolve())
                        or previous.parent != target.parent or not previous_label
                        or (previous_label.day, previous_label.company, previous_label.channel)
                        != (label.day, label.company, label.channel)):
                    raise ValueError('같은 녹음에 다른 라벨이 붙어 있습니다')
                target = previous
                if target.is_symlink() or (target.exists() and digest(target) != sha):
                    raise ValueError('보존한 녹음이 변경되었습니다')
            else:
                # 사용자 입력은 그대로 두고 보관본만 자동으로 구분한다.
                base = f'{label.day}_{label.company}_{label.channel}'
                for number in range(2, 1001):
                    key = target.relative_to(output).as_posix()
                    if target.is_symlink():
                        raise ValueError('출력 파일이 심볼릭 링크입니다')
                    if (reserved.get(key, sha) == sha
                            and (not target.exists() or digest(target) == sha)):
                        break
                    if label.internal or number == 1000:
                        raise ValueError('같은 이름의 다른 녹음이 이미 있습니다')
                    target = target.with_name(f'{base}_{number}{path.suffix}')
            key = target.relative_to(output).as_posix()
            batch[sha] = key
            reserved[key] = sha
            prepared.append((path, target, sha))
        # 복사 전 목적지를 예약해 중간 종료 후 다른 고객으로 재접수되지 않게 한다.
        temp_state = state_path.with_suffix('.tmp')
        temp_state.write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temp_state, state_path)
        copied = 0
        for path, target, sha in prepared:
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.partial', delete=False) as handle:
                temporary = Path(handle.name)
            try:
                shutil.copyfile(path, temporary)
                if digest(temporary) != sha or digest(path) != sha:
                    raise ValueError('복사 중 원본이 변경되었습니다')
                # link는 원자적으로 공개하며 기존 파일을 덮어쓰지 않는다.
                os.link(temporary, target)
                copied += 1
            finally:
                temporary.unlink(missing_ok=True)
        return copied
    finally:
        lock.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--apply', action='store_true', help='검증된 대상만 실제 복사')
    args = parser.parse_args()
    if args.apply:
        print(f'복사 완료: {copy_routes(args.source.resolve(), args.output.resolve())}개')
    else:
        for origin, target in plan_routes(args.source, args.output):
            print(f'{origin.name} → {target}')
        print('미리보기 완료. 파일 전송/전사/공개 없음.')
