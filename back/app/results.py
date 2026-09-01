from typing import Any

RANK_CODE_ORDER = {
    "msmk": 1,
    "ms": 2,
    "kms": 3,
    "first": 4,
    "second": 5,
    "third": 6,
    "junior_first": 7,
    "junior_second": 8,
    "junior_third": 9,
}


def parse_performance_to_seconds(value: str) -> float:
    normalized = value.strip().replace(",", ".")
    if not normalized:
        raise ValueError("Result value is required")

    parts = normalized.split(":")

    try:
        if len(parts) == 1:
            return round(float(parts[0]), 2)
        if len(parts) == 2:
            minutes = int(parts[0])
            seconds = float(parts[1])
            return round(minutes * 60 + seconds, 2)
        if len(parts) == 3:
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            return round(hours * 3600 + minutes * 60 + seconds, 2)
    except ValueError as exc:
        raise ValueError("Invalid result format") from exc

    raise ValueError("Invalid result format")


def format_seconds(seconds: float) -> str:
    total_hundredths = round(seconds * 100)
    hours, remainder = divmod(total_hundredths, 360000)
    minutes, remainder = divmod(remainder, 6000)
    secs, hundredths = divmod(remainder, 100)

    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}.{hundredths:02d}"
    if minutes:
        return f"{minutes}:{secs:02d}.{hundredths:02d}"
    return f"{secs}.{hundredths:02d}"


def normalize_performance_label(value: str, seconds: float) -> str:
    normalized = value.strip().replace(",", ".")
    return normalized or format_seconds(seconds)


def find_matching_rank(
    standards: list[dict[str, Any]],
    performance_seconds: float,
    timing_type: str,
    track_length_meters: int | None,
    water_pit: bool | None,
) -> dict[str, Any] | None:
    applicable = [
        standard
        for standard in standards
        if standard["timing_type"] == timing_type
        and standard["track_length_meters"] == track_length_meters
        and standard["water_pit"] == water_pit
    ]

    applicable.sort(key=lambda item: item["rank_order"])

    for standard in applicable:
        if performance_seconds <= float(standard["result_seconds"]):
            return standard

    return None
