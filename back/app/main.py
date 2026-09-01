from collections import defaultdict
import secrets
import string
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
import psycopg

from app.config import settings
from app.db import get_db
from app.results import find_matching_rank, normalize_performance_label, parse_performance_to_seconds
from app.schemas import (
    AuthResponse,
    CreateGroupRequest,
    DisciplineReferenceResponse,
    DisciplineVariantResponse,
    GroupDetailResponse,
    GroupDisciplineLeaderboardResponse,
    GroupLeaderboardEntryResponse,
    GroupMemberResponse,
    GroupResponse,
    JoinGroupRequest,
    LoginRequest,
    RankHistoryResponse,
    RankOptionResponse,
    RankStandardResponse,
    ReferenceDataResponse,
    RegisterRequest,
    ResultCreateRequest,
    ResultResponse,
    UserResponse,
    UserSearchResponse,
)
from app.security import create_access_token, decode_access_token, hash_password, verify_password

app = FastAPI(title="Race Log API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

auth_scheme = HTTPBearer()


def build_display_name(user: dict[str, Any]) -> str:
    return f"{user['first_name']} {user['last_name']}".strip()


def serialize_user(user: dict[str, Any]) -> UserResponse:
    return UserResponse(
        id=user["id"],
        first_name=user["first_name"],
        last_name=user["last_name"],
        username=user["username"],
        sex=user["sex"],
    )


def serialize_user_search(user: dict[str, Any]) -> UserSearchResponse:
    return UserSearchResponse(
        **serialize_user(user).model_dump(),
        display_name=build_display_name(user),
    )


def serialize_result(row: dict[str, Any]) -> ResultResponse:
    return ResultResponse(
        id=row["id"],
        user_id=row["user_id"],
        discipline_id=row["discipline_id"],
        discipline_name=row["discipline_name"],
        category=row["category"],
        result_date=row["result_date"],
        competition_name=row["competition_name"],
        performance_label=row["performance_label"],
        performance_seconds=float(row["performance_seconds"]),
        timing_type=row["timing_type"],
        track_length_meters=row["track_length_meters"],
        water_pit=row["water_pit"],
        detected_rank_code=row["detected_rank_code"],
        detected_rank_label=row["detected_rank_label"],
        effective_rank_code=row["effective_rank_code"],
        effective_rank_label=row["effective_rank_label"],
        manual_rank_code=row["manual_rank_code"],
        notes=row["notes"],
        created_at=row["created_at"],
    )


def serialize_group_row(row: dict[str, Any]) -> GroupResponse:
    return GroupResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        access_code=row["access_code"] if row["my_status"] == "approved" else None,
        created_at=row["created_at"],
        created_by=row["created_by"],
        my_role=row["my_role"],
        my_status=row["my_status"],
        members_count=int(row["members_count"] or 0),
        pending_requests=int(row["pending_requests"] or 0),
    )


def serialize_group_member(row: dict[str, Any]) -> GroupMemberResponse:
    user = {
        "id": row["user_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "username": row["username"],
        "sex": row["sex"],
    }
    return GroupMemberResponse(
        membership_id=row["membership_id"],
        role=row["role"],
        status=row["status"],
        joined_at=row["joined_at"],
        user=serialize_user(user),
        result_count=int(row["result_count"] or 0),
        active_rank_count=int(row["active_rank_count"] or 0),
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
    db: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    token = credentials.credentials

    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (KeyError, ValueError, jwt.InvalidTokenError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        ) from exc

    user = fetch_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


def fetch_user_by_id(db: psycopg.Connection, user_id: int) -> dict[str, Any] | None:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, first_name, last_name, username, sex
            FROM users
            WHERE id = %s
            """,
            (user_id,),
        )
        return cursor.fetchone()


def get_target_user(
    db: psycopg.Connection,
    current_user: dict[str, Any],
    requested_user_id: int | None,
) -> dict[str, Any]:
    if requested_user_id is None or requested_user_id == current_user["id"]:
        return current_user

    user = fetch_user_by_id(db, requested_user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def fetch_rank_catalog(db: psycopg.Connection) -> list[dict[str, Any]]:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT code, label, rank_order
            FROM rank_catalog
            ORDER BY rank_order
            """
        )
        return cursor.fetchall()


def fetch_standards(
    db: psycopg.Connection,
    sex: str,
    discipline_id: int | None = None,
) -> list[dict[str, Any]]:
    query = """
        SELECT
            rs.discipline_id,
            rs.rank_code,
            rc.label AS rank_label,
            rc.rank_order,
            rs.timing_type,
            rs.track_length_meters,
            rs.water_pit,
            rs.result_seconds,
            rs.mark_display
        FROM rank_standards rs
        JOIN rank_catalog rc ON rc.code = rs.rank_code
        WHERE rs.sex = %s
          AND rs.age_group = 'adult'
    """
    params: list[object] = [sex]

    if discipline_id is not None:
        query += " AND rs.discipline_id = %s"
        params.append(discipline_id)

    query += " ORDER BY rs.discipline_id, rs.timing_type, rs.track_length_meters NULLS FIRST, rc.rank_order"

    with db.cursor() as cursor:
        cursor.execute(query, tuple(params))
        return cursor.fetchall()


def maybe_record_rank_history(
    db: psycopg.Connection,
    *,
    user_id: int,
    discipline_id: int,
    result_id: int,
    effective_rank_code: str | None,
    source_type: str,
) -> None:
    if effective_rank_code is None:
        return

    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT rh.id, rh.rank_code, rc.rank_order
            FROM user_rank_history rh
            JOIN rank_catalog rc ON rc.code = rh.rank_code
            WHERE rh.user_id = %s
              AND rh.discipline_id = %s
              AND rh.is_current = TRUE
            """,
            (user_id, discipline_id),
        )
        current_history = cursor.fetchone()

        cursor.execute(
            "SELECT rank_order FROM rank_catalog WHERE code = %s",
            (effective_rank_code,),
        )
        new_rank = cursor.fetchone()

        if new_rank is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown rank code")

        if current_history and int(new_rank["rank_order"]) >= int(current_history["rank_order"]):
            return

        if current_history:
            cursor.execute(
                """
                UPDATE user_rank_history
                SET is_current = FALSE
                WHERE id = %s
                """,
                (current_history["id"],),
            )

        cursor.execute(
            """
            INSERT INTO user_rank_history (user_id, discipline_id, result_id, rank_code, source_type, is_current)
            VALUES (%s, %s, %s, %s, %s, TRUE)
            """,
            (user_id, discipline_id, result_id, effective_rank_code, source_type),
        )


def get_reference_data(current_user: dict[str, Any], db: psycopg.Connection) -> ReferenceDataResponse:
    ranks = fetch_rank_catalog(db)
    standards = fetch_standards(db, current_user["sex"])

    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, code, name, category, distance_meters, sort_order
            FROM disciplines
            WHERE is_active = TRUE
            ORDER BY sort_order, id
            """
        )
        disciplines = cursor.fetchall()

    variants_by_discipline: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for standard in standards:
        variant = {
            "timing_type": standard["timing_type"],
            "track_length_meters": standard["track_length_meters"],
            "water_pit": standard["water_pit"],
        }
        if variant not in variants_by_discipline[standard["discipline_id"]]:
            variants_by_discipline[standard["discipline_id"]].append(variant)

    return ReferenceDataResponse(
        rank_scope="Авторазряд считается по взрослым нормам ЕВСК для мужчин и женщин, действующим с 26 ноября 2024 года.",
        ranks=[RankOptionResponse(**rank) for rank in ranks],
        disciplines=[
            DisciplineReferenceResponse(
                id=discipline["id"],
                code=discipline["code"],
                name=discipline["name"],
                category=discipline["category"],
                distance_meters=discipline["distance_meters"],
                sort_order=discipline["sort_order"],
                variants=[
                    DisciplineVariantResponse(**variant)
                    for variant in variants_by_discipline[discipline["id"]]
                ],
            )
            for discipline in disciplines
            if variants_by_discipline.get(discipline["id"])
        ],
        standards=[RankStandardResponse(**standard) for standard in standards],
    )


def fetch_results_for_user(db: psycopg.Connection, user_id: int) -> list[ResultResponse]:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                r.id,
                r.user_id,
                r.discipline_id,
                d.name AS discipline_name,
                d.category,
                r.result_date,
                r.competition_name,
                r.performance_label,
                r.performance_seconds,
                r.timing_type,
                r.track_length_meters,
                r.water_pit,
                r.detected_rank_code,
                detected.label AS detected_rank_label,
                r.effective_rank_code,
                effective.label AS effective_rank_label,
                r.manual_rank_code,
                r.notes,
                r.created_at
            FROM results r
            JOIN disciplines d ON d.id = r.discipline_id
            LEFT JOIN rank_catalog detected ON detected.code = r.detected_rank_code
            LEFT JOIN rank_catalog effective ON effective.code = r.effective_rank_code
            WHERE r.user_id = %s
            ORDER BY r.result_date DESC, r.created_at DESC
            """,
            (user_id,),
        )
        return [serialize_result(row) for row in cursor.fetchall()]


def fetch_rank_history_for_user(db: psycopg.Connection, user_id: int) -> list[RankHistoryResponse]:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                rh.id,
                rh.discipline_id,
                d.name AS discipline_name,
                rh.rank_code,
                rc.label AS rank_label,
                rh.source_type,
                rh.achieved_at,
                rh.result_id,
                rh.is_current
            FROM user_rank_history rh
            JOIN disciplines d ON d.id = rh.discipline_id
            JOIN rank_catalog rc ON rc.code = rh.rank_code
            WHERE rh.user_id = %s
            ORDER BY rh.achieved_at DESC, rc.rank_order
            """,
            (user_id,),
        )
        return [RankHistoryResponse(**row) for row in cursor.fetchall()]


def generate_access_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


def create_unique_access_code(db: psycopg.Connection) -> str:
    for _ in range(12):
        access_code = generate_access_code()
        with db.cursor() as cursor:
            cursor.execute("SELECT 1 FROM athlete_groups WHERE access_code = %s", (access_code,))
            if cursor.fetchone() is None:
                return access_code
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not generate access code")


def fetch_group_summaries(db: psycopg.Connection, user_id: int) -> list[GroupResponse]:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                g.id,
                g.name,
                g.description,
                g.access_code,
                g.created_at,
                g.created_by,
                gm.role AS my_role,
                gm.status AS my_status,
                COALESCE(stats.members_count, 0) AS members_count,
                COALESCE(stats.pending_requests, 0) AS pending_requests
            FROM group_memberships gm
            JOIN athlete_groups g ON g.id = gm.group_id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE status = 'approved') AS members_count,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending_requests
                FROM group_memberships inner_gm
                WHERE inner_gm.group_id = g.id
            ) stats ON TRUE
            WHERE gm.user_id = %s
            ORDER BY
                CASE gm.status WHEN 'approved' THEN 0 ELSE 1 END,
                g.created_at DESC
            """,
            (user_id,),
        )
        return [serialize_group_row(row) for row in cursor.fetchall()]


def fetch_group_membership(db: psycopg.Connection, group_id: int, user_id: int) -> dict[str, Any] | None:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, group_id, user_id, role, status, joined_at, approved_at, approved_by
            FROM group_memberships
            WHERE group_id = %s AND user_id = %s
            """,
            (group_id, user_id),
        )
        return cursor.fetchone()


def require_group_access(
    db: psycopg.Connection,
    group_id: int,
    current_user_id: int,
    *,
    coach_only: bool = False,
) -> dict[str, Any]:
    membership = fetch_group_membership(db, group_id, current_user_id)
    if membership is None or membership["status"] != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Group access denied")
    if coach_only and membership["role"] != "coach":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Coach access required")
    return membership


def fetch_single_group_summary(db: psycopg.Connection, group_id: int, user_id: int) -> GroupResponse:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                g.id,
                g.name,
                g.description,
                g.access_code,
                g.created_at,
                g.created_by,
                gm.role AS my_role,
                gm.status AS my_status,
                COALESCE(stats.members_count, 0) AS members_count,
                COALESCE(stats.pending_requests, 0) AS pending_requests
            FROM athlete_groups g
            JOIN group_memberships gm ON gm.group_id = g.id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE status = 'approved') AS members_count,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending_requests
                FROM group_memberships inner_gm
                WHERE inner_gm.group_id = g.id
            ) stats ON TRUE
            WHERE g.id = %s AND gm.user_id = %s
            """,
            (group_id, user_id),
        )
        row = cursor.fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return serialize_group_row(row)


def fetch_group_members(db: psycopg.Connection, group_id: int, status_filter: str) -> list[GroupMemberResponse]:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                gm.id AS membership_id,
                gm.role,
                gm.status,
                gm.joined_at,
                u.id AS user_id,
                u.first_name,
                u.last_name,
                u.username,
                u.sex,
                COALESCE(result_stats.result_count, 0) AS result_count,
                COALESCE(rank_stats.active_rank_count, 0) AS active_rank_count
            FROM group_memberships gm
            JOIN users u ON u.id = gm.user_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS result_count
                FROM results r
                WHERE r.user_id = gm.user_id
            ) result_stats ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS active_rank_count
                FROM user_rank_history rh
                WHERE rh.user_id = gm.user_id
                  AND rh.is_current = TRUE
            ) rank_stats ON TRUE
            WHERE gm.group_id = %s
              AND gm.status = %s
            ORDER BY
                CASE gm.role WHEN 'coach' THEN 0 ELSE 1 END,
                u.first_name,
                u.last_name
            """,
            (group_id, status_filter),
        )
        return [serialize_group_member(row) for row in cursor.fetchall()]


def fetch_group_leaderboards(db: psycopg.Connection, group_id: int) -> list[GroupDisciplineLeaderboardResponse]:
    with db.cursor() as cursor:
        cursor.execute(
            """
            WITH approved_members AS (
                SELECT user_id
                FROM group_memberships
                WHERE group_id = %s
                  AND status = 'approved'
            ),
            ranked_results AS (
                SELECT
                    r.id,
                    r.user_id,
                    r.discipline_id,
                    d.name AS discipline_name,
                    d.category,
                    r.result_date,
                    r.competition_name,
                    r.performance_label,
                    r.performance_seconds,
                    r.timing_type,
                    r.track_length_meters,
                    r.water_pit,
                    r.detected_rank_code,
                    detected.label AS detected_rank_label,
                    r.effective_rank_code,
                    effective.label AS effective_rank_label,
                    r.manual_rank_code,
                    r.notes,
                    r.created_at,
                    u.first_name,
                    u.last_name,
                    u.username,
                    u.sex,
                    COUNT(*) OVER (PARTITION BY r.user_id, r.discipline_id) AS total_results,
                    ROW_NUMBER() OVER (
                        PARTITION BY r.user_id, r.discipline_id
                        ORDER BY r.performance_seconds ASC, r.result_date DESC, r.created_at DESC
                    ) AS row_num
                FROM results r
                JOIN approved_members am ON am.user_id = r.user_id
                JOIN disciplines d ON d.id = r.discipline_id
                JOIN users u ON u.id = r.user_id
                LEFT JOIN rank_catalog detected ON detected.code = r.detected_rank_code
                LEFT JOIN rank_catalog effective ON effective.code = r.effective_rank_code
            )
            SELECT *
            FROM ranked_results
            WHERE row_num = 1
            ORDER BY discipline_name, performance_seconds ASC, result_date DESC
            """,
            (group_id,),
        )
        rows = cursor.fetchall()

    grouped: dict[int, dict[str, Any]] = {}
    for row in rows:
        if row["discipline_id"] not in grouped:
            grouped[row["discipline_id"]] = {
                "discipline_id": row["discipline_id"],
                "discipline_name": row["discipline_name"],
                "category": row["category"],
                "entries": [],
            }

        user = {
            "id": row["user_id"],
            "first_name": row["first_name"],
            "last_name": row["last_name"],
            "username": row["username"],
            "sex": row["sex"],
        }
        grouped[row["discipline_id"]]["entries"].append(
            GroupLeaderboardEntryResponse(
                user=serialize_user(user),
                best_result=serialize_result(row),
                total_results=int(row["total_results"] or 0),
            )
        )

    leaderboards = [
        GroupDisciplineLeaderboardResponse(
            discipline_id=item["discipline_id"],
            discipline_name=item["discipline_name"],
            category=item["category"],
            entries=item["entries"],
        )
        for item in grouped.values()
    ]
    leaderboards.sort(key=lambda item: (item.discipline_name.lower(), item.discipline_id))
    return leaderboards


@app.post("/api/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: psycopg.Connection = Depends(get_db)) -> AuthResponse:
    username = payload.username.lower().strip()

    with db.cursor() as cursor:
        cursor.execute("SELECT 1 FROM users WHERE username = %s", (username,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already exists",
            )

        cursor.execute(
            """
            INSERT INTO users (first_name, last_name, username, password_hash, sex)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, first_name, last_name, username, sex
            """,
            (
                payload.first_name.strip(),
                payload.last_name.strip(),
                username,
                hash_password(payload.password),
                payload.sex,
            ),
        )
        user = cursor.fetchone()
        db.commit()

    token = create_access_token(user["id"])
    return AuthResponse(access_token=token, user=serialize_user(user))


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: psycopg.Connection = Depends(get_db)) -> AuthResponse:
    username = payload.username.lower().strip()

    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, first_name, last_name, username, password_hash, sex
            FROM users
            WHERE username = %s
            """,
            (username,),
        )
        user = cursor.fetchone()

    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = create_access_token(user["id"])
    return AuthResponse(access_token=token, user=serialize_user(user))


@app.get("/api/users/me", response_model=UserResponse)
def me(current_user: dict[str, Any] = Depends(get_current_user)) -> UserResponse:
    return serialize_user(current_user)


@app.get("/api/users/search", response_model=list[UserSearchResponse])
def search_users(
    q: str = Query(min_length=2, max_length=100),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> list[UserSearchResponse]:
    normalized = q.strip()
    if not normalized:
        return []

    prefix = f"{normalized.lower()}%"
    contains = f"%{normalized.lower()}%"

    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, first_name, last_name, username, sex
            FROM users
            WHERE id <> %s
              AND (
                LOWER(username) LIKE %s
                OR LOWER(first_name) LIKE %s
                OR LOWER(last_name) LIKE %s
                OR LOWER(CONCAT(first_name, ' ', last_name)) LIKE %s
              )
            ORDER BY
                CASE
                    WHEN LOWER(username) = LOWER(%s) THEN 0
                    WHEN LOWER(username) LIKE %s THEN 1
                    WHEN LOWER(CONCAT(first_name, ' ', last_name)) LIKE %s THEN 2
                    ELSE 3
                END,
                first_name,
                last_name
            LIMIT 12
            """,
            (
                current_user["id"],
                contains,
                contains,
                contains,
                contains,
                normalized,
                prefix,
                contains,
            ),
        )
        return [serialize_user_search(row) for row in cursor.fetchall()]


@app.get("/api/reference-data", response_model=ReferenceDataResponse)
def reference_data(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> ReferenceDataResponse:
    return get_reference_data(current_user, db)


@app.get("/api/results", response_model=list[ResultResponse])
def list_results(
    user_id: int | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> list[ResultResponse]:
    target_user = get_target_user(db, current_user, user_id)
    return fetch_results_for_user(db, target_user["id"])


@app.get("/api/rank-history", response_model=list[RankHistoryResponse])
def list_rank_history(
    user_id: int | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> list[RankHistoryResponse]:
    target_user = get_target_user(db, current_user, user_id)
    return fetch_rank_history_for_user(db, target_user["id"])


@app.post("/api/results", response_model=ResultResponse, status_code=status.HTTP_201_CREATED)
def create_result(
    payload: ResultCreateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> ResultResponse:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, code, name, category
            FROM disciplines
            WHERE id = %s AND is_active = TRUE
            """,
            (payload.discipline_id,),
        )
        discipline = cursor.fetchone()

    if discipline is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discipline not found")

    try:
        performance_seconds = parse_performance_to_seconds(payload.performance)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    standards = fetch_standards(db, current_user["sex"], payload.discipline_id)
    matching_rank = find_matching_rank(
        standards,
        performance_seconds,
        payload.timing_type,
        payload.track_length_meters,
        payload.water_pit,
    )

    available_variant = any(
        standard["timing_type"] == payload.timing_type
        and standard["track_length_meters"] == payload.track_length_meters
        and standard["water_pit"] == payload.water_pit
        for standard in standards
    )
    if not available_variant:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selected timing or track variant is not available for this discipline",
        )

    detected_rank_code = matching_rank["rank_code"] if matching_rank else None
    effective_rank_code = payload.manual_rank_code or detected_rank_code
    source_type = "manual" if payload.manual_rank_code else "auto"

    with db.cursor() as cursor:
        if payload.manual_rank_code:
            cursor.execute(
                "SELECT code FROM rank_catalog WHERE code = %s",
                (payload.manual_rank_code,),
            )
            if cursor.fetchone() is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Manual rank code is invalid",
                )

        cursor.execute(
            """
            INSERT INTO results (
                user_id,
                discipline_id,
                result_date,
                competition_name,
                performance_label,
                performance_seconds,
                timing_type,
                track_length_meters,
                water_pit,
                detected_rank_code,
                manual_rank_code,
                effective_rank_code,
                notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                current_user["id"],
                discipline["id"],
                payload.result_date,
                payload.competition_name.strip() if payload.competition_name else None,
                normalize_performance_label(payload.performance, performance_seconds),
                performance_seconds,
                payload.timing_type,
                payload.track_length_meters,
                payload.water_pit,
                detected_rank_code,
                payload.manual_rank_code,
                effective_rank_code,
                payload.notes.strip() if payload.notes else None,
            ),
        )
        result_id = cursor.fetchone()["id"]

        maybe_record_rank_history(
            db,
            user_id=current_user["id"],
            discipline_id=discipline["id"],
            result_id=result_id,
            effective_rank_code=effective_rank_code,
            source_type=source_type,
        )

        db.commit()

    created_results = fetch_results_for_user(db, current_user["id"])
    created = next((item for item in created_results if item.id == result_id), None)
    if created is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Result was not returned")
    return created


@app.get("/api/groups", response_model=list[GroupResponse])
def list_groups(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> list[GroupResponse]:
    return fetch_group_summaries(db, current_user["id"])


@app.post("/api/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: CreateGroupRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> GroupResponse:
    access_code = create_unique_access_code(db)

    with db.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO athlete_groups (name, description, access_code, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (payload.name, payload.description, access_code, current_user["id"]),
        )
        group_id = cursor.fetchone()["id"]

        cursor.execute(
            """
            INSERT INTO group_memberships (group_id, user_id, role, status, approved_at, approved_by)
            VALUES (%s, %s, 'coach', 'approved', NOW(), %s)
            """,
            (group_id, current_user["id"], current_user["id"]),
        )
        db.commit()

    return fetch_single_group_summary(db, group_id, current_user["id"])


@app.post("/api/groups/join", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
def join_group(
    payload: JoinGroupRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> GroupResponse:
    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM athlete_groups
            WHERE access_code = %s
            """,
            (payload.access_code,),
        )
        group = cursor.fetchone()

        if group is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group with this code was not found")

        cursor.execute(
            """
            SELECT id, status
            FROM group_memberships
            WHERE group_id = %s AND user_id = %s
            """,
            (group["id"], current_user["id"]),
        )
        membership = cursor.fetchone()
        if membership:
            if membership["status"] == "approved":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You are already a group member")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your join request is already pending")

        cursor.execute(
            """
            INSERT INTO group_memberships (group_id, user_id, role, status)
            VALUES (%s, %s, 'athlete', 'pending')
            """,
            (group["id"], current_user["id"]),
        )
        db.commit()

    return fetch_single_group_summary(db, group["id"], current_user["id"])


@app.get("/api/groups/{group_id}", response_model=GroupDetailResponse)
def group_detail(
    group_id: int,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> GroupDetailResponse:
    membership = fetch_group_membership(db, group_id, current_user["id"])
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    if membership["status"] != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your join request is still pending")

    group = fetch_single_group_summary(db, group_id, current_user["id"])
    members = fetch_group_members(db, group_id, "approved")
    pending_members = fetch_group_members(db, group_id, "pending") if membership["role"] == "coach" else []
    leaderboards = fetch_group_leaderboards(db, group_id)

    return GroupDetailResponse(
        group=group,
        members=members,
        pending_members=pending_members,
        discipline_leaderboards=leaderboards,
    )


@app.post("/api/groups/{group_id}/members/{membership_id}/approve", response_model=GroupDetailResponse)
def approve_group_member(
    group_id: int,
    membership_id: int,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: psycopg.Connection = Depends(get_db),
) -> GroupDetailResponse:
    require_group_access(db, group_id, current_user["id"], coach_only=True)

    with db.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, status
            FROM group_memberships
            WHERE id = %s AND group_id = %s
            """,
            (membership_id, group_id),
        )
        membership = cursor.fetchone()

        if membership is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
        if membership["status"] == "approved":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Membership is already approved")

        cursor.execute(
            """
            UPDATE group_memberships
            SET status = 'approved',
                approved_at = NOW(),
                approved_by = %s
            WHERE id = %s
            """,
            (current_user["id"], membership_id),
        )
        db.commit()

    group = fetch_single_group_summary(db, group_id, current_user["id"])
    members = fetch_group_members(db, group_id, "approved")
    pending_members = fetch_group_members(db, group_id, "pending")
    leaderboards = fetch_group_leaderboards(db, group_id)
    return GroupDetailResponse(
        group=group,
        members=members,
        pending_members=pending_members,
        discipline_leaderboards=leaderboards,
    )
