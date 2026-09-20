"""한 기업의 공개 승인된 데이터만 메모리로 수집한다. 저장은 별도 D1 도구가 한다."""
import argparse
import base64
import contextlib
import io
import json
import os
import sys
import time
import uuid

import build_client as builder


def collect(slug):
    builder.load_dotenv(builder.ROOT / ".env")
    if not os.environ.get("NOTION_TOKEN") or not os.environ.get("BUILD_TOKEN"):
        raise ValueError("missing_local_configuration")
    started = int(time.time() * 1000)
    # 기존 빌더 로그에는 기업 정보가 있다. 파이프에는 승인된 결과만 보내며 로그는 폐기한다.
    with contextlib.redirect_stdout(io.StringIO()):
        nt = builder.Notion(os.environ["NOTION_TOKEN"])
        clients, names = builder.fetch_clients(nt, slug)
        if len(clients) != 1:
            raise ValueError("expected_one_client")
        assets = {}
        result = builder.build_one(nt, clients[0], False, True, True, names, private_assets=assets)
    if result["warns"]:
        raise ValueError("incomplete_projection")
    return {"slug": slug, "buildKey": str(uuid.uuid4()), "startedAt": started,
            "payload": result["payload"], "assets": {path: {"type": item["type"],
            "data": base64.b64encode(item["data"]).decode("ascii")} for path, item in assets.items()}}


if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--client", required=True)
        args = parser.parse_args()
        print(json.dumps(collect(args.client), ensure_ascii=False, separators=(",", ":")))
    except Exception:
        print("비공개 데이터 수집 실패: 이전 정상 결과와 기존 운영 페이지는 유지합니다.", file=sys.stderr)
        sys.exit(1)
