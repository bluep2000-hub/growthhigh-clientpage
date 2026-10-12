"""PM이 명시적으로 붙인 라벨만 접수한다. AI/폴더명으로 보완하지 않는다."""

import re
from dataclasses import dataclass
from datetime import date

from client_mapping import COMPANY_SLUGS, client_slug_for, load_registered_clients


LABEL_PATTERN = r"([0-9]{6})_([^_\\/:*?\"<>|\x00-\x1f]+)_(오전미팅|마감미팅|통화|미팅)(?:_([0-9]{4}|[1-9][0-9]{0,2}))?(?: \(([1-9][0-9]{0,2})\))?\.(?:m4a|mp3|wav|aac|amr|ogg|opus|flac|3gp|mp4|m4v|mov|webm)"


@dataclass(frozen=True)
class RecordingLabel:
    day: str
    company: str
    channel: str
    clock: str | None

    @property
    def internal(self) -> bool:
        return self.company == "내부"

    @property
    def occurred_at(self) -> str:
        return date(2000 + int(self.day[:2]), int(self.day[2:4]), int(self.day[4:])).isoformat()


def parse_label(name: str) -> RecordingLabel | None:
    match = re.fullmatch(LABEL_PATTERN, name, re.IGNORECASE)
    if not match:
        return None
    day, company, channel, suffix, duplicate = match.groups()
    # 이전 HHMM 라벨도 계속 읽되 새 라벨에는 시간 입력을 요구하지 않는다.
    clock = suffix if suffix and len(suffix) == 4 else None
    if company != company.strip():
        return None
    label = RecordingLabel(day, company, channel, clock)
    try:
        label.occurred_at
    except ValueError:
        return None
    if clock and (int(clock[:2]) > 23 or int(clock[2:]) > 59):
        return None
    if label.internal:
        return label if (channel in {"오전미팅", "마감미팅"} and not suffix and not duplicate
                         and name.rsplit('.', 1)[-1].lower() in {'m4a', 'mp3', 'wav', 'aac', 'flac'}) else None
    return label if channel in {"통화", "미팅"} else None


def validate_customer_job(job: dict) -> RecordingLabel:
    """외부 게시 직전에도 원본 라벨과 장부의 고객/유형/날짜를 대조한다."""
    label = parse_label(str(job.get("source_name") or ""))
    if not label or label.internal:
        raise ValueError("고객 공개용 녹음 라벨이 없다")
    if (job.get("company_name") != label.company
            or job.get("company_slug") != client_slug_for(label.company)
            or job.get("channel") != label.channel
            or job.get("occurred_at") != label.occurred_at):
        raise ValueError("녹음 라벨과 고객/유형/날짜가 일치하지 않는다")
    return label


def phone_filter() -> str:
    """FolderSync 파일명 포함 RegEx. 갤럭시 기본 녹음 형식 m4a만 허용."""
    companies = '|'.join(re.escape(name) for name in sorted(COMPANY_SLUGS | load_registered_clients()) if name != '내부')
    day = r'[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])'
    clock = r'(?:[01][0-9]|2[0-3])[0-5][0-9]'
    return rf'(?i)^{day}_(?:내부_(?:오전미팅|마감미팅)|(?:{companies})_(?:통화|미팅)(?:_(?:{clock}|[1-9][0-9]{{0,2}}))?(?: \([1-9][0-9]{{0,2}}\))?)\.m4a$'


if __name__ == '__main__':
    print(phone_filter())
