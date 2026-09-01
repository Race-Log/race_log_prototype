from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Sex = Literal["male", "female"]
TimingType = Literal["manual", "auto"]
RankSourceType = Literal["auto", "manual"]
GroupRole = Literal["coach", "athlete"]
MembershipStatus = Literal["pending", "approved"]


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=2, max_length=100)
    last_name: str = Field(min_length=2, max_length=100)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=128)
    sex: Sex


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str
    last_name: str
    username: str
    sex: Sex


class UserSearchResponse(UserResponse):
    display_name: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class RankOptionResponse(BaseModel):
    code: str
    label: str
    rank_order: int


class DisciplineVariantResponse(BaseModel):
    timing_type: TimingType
    track_length_meters: int | None = None
    water_pit: bool | None = None


class DisciplineReferenceResponse(BaseModel):
    id: int
    code: str
    name: str
    category: str
    distance_meters: int
    sort_order: int
    variants: list[DisciplineVariantResponse]


class RankStandardResponse(BaseModel):
    discipline_id: int
    rank_code: str
    rank_label: str
    rank_order: int
    timing_type: TimingType
    track_length_meters: int | None = None
    water_pit: bool | None = None
    result_seconds: float
    mark_display: str


class ReferenceDataResponse(BaseModel):
    rank_scope: str
    ranks: list[RankOptionResponse]
    disciplines: list[DisciplineReferenceResponse]
    standards: list[RankStandardResponse]


class ResultCreateRequest(BaseModel):
    discipline_id: int
    performance: str = Field(min_length=1, max_length=32)
    competition_name: str | None = Field(default=None, max_length=200)
    result_date: date
    timing_type: TimingType
    track_length_meters: int | None = None
    water_pit: bool | None = None
    manual_rank_code: str | None = None
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("track_length_meters", mode="before")
    @classmethod
    def normalize_track_length(cls, value: object) -> int | None:
        if value in (None, "", 0, "0"):
            return None
        return int(value)

    @field_validator("water_pit", mode="before")
    @classmethod
    def normalize_water_pit(cls, value: object) -> bool | None:
        if value in (None, ""):
            return None
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized == "true":
                return True
            if normalized == "false":
                return False
            if normalized == "null":
                return None
        raise ValueError("water_pit must be true, false or null")

    @field_validator("manual_rank_code", "competition_name", "notes", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: object) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return str(value)


class ResultResponse(BaseModel):
    id: int
    user_id: int
    discipline_id: int
    discipline_name: str
    category: str
    result_date: date
    competition_name: str | None = None
    performance_label: str
    performance_seconds: float
    timing_type: TimingType
    track_length_meters: int | None = None
    water_pit: bool | None = None
    detected_rank_code: str | None = None
    detected_rank_label: str | None = None
    effective_rank_code: str | None = None
    effective_rank_label: str | None = None
    manual_rank_code: str | None = None
    notes: str | None = None
    created_at: datetime


class RankHistoryResponse(BaseModel):
    id: int
    discipline_id: int
    discipline_name: str
    rank_code: str
    rank_label: str
    source_type: RankSourceType
    achieved_at: datetime
    result_id: int
    is_current: bool


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("name", "description", mode="before")
    @classmethod
    def normalize_group_strings(cls, value: object) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return str(value)


class JoinGroupRequest(BaseModel):
    access_code: str = Field(min_length=4, max_length=24)

    @field_validator("access_code", mode="before")
    @classmethod
    def normalize_access_code(cls, value: object) -> str:
        if isinstance(value, str):
            normalized = value.strip().upper()
            if normalized:
                return normalized
        raise ValueError("Access code is required")


class GroupResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    access_code: str | None = None
    created_at: datetime
    created_by: int
    my_role: GroupRole
    my_status: MembershipStatus
    members_count: int
    pending_requests: int


class GroupMemberResponse(BaseModel):
    membership_id: int
    role: GroupRole
    status: MembershipStatus
    joined_at: datetime
    user: UserResponse
    result_count: int
    active_rank_count: int


class GroupLeaderboardEntryResponse(BaseModel):
    user: UserResponse
    best_result: ResultResponse
    total_results: int


class GroupDisciplineLeaderboardResponse(BaseModel):
    discipline_id: int
    discipline_name: str
    category: str
    entries: list[GroupLeaderboardEntryResponse]


class GroupDetailResponse(BaseModel):
    group: GroupResponse
    members: list[GroupMemberResponse]
    pending_members: list[GroupMemberResponse]
    discipline_leaderboards: list[GroupDisciplineLeaderboardResponse]
