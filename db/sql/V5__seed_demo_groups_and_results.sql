INSERT INTO users (first_name, last_name, username, password_hash, sex)
VALUES
    ('Роман', 'Романов', 'coach.romanov', 'salt_demo_coach$f210fafa51b5e11361daf6a54c64ecc9019b537acf1af4637128d420319a8377', 'male'),
    ('Анна', 'Соколова', 'anna.sokolova', 'salt_demo_athlete$2437d654f1b175abfe2d0cae2b3674f4255ef0f17944b9c4c589a8d6c1bc1c47', 'female'),
    ('Иван', 'Петров', 'ivan.petrov', 'salt_demo_member$af453d2c00272f66023a6e7bedfaab99010a69693d737f8bf50ab8f0e05d6061', 'male'),
    ('Дарья', 'Лебедева', 'daria.lebedeva', 'salt_demo_sprinter$f8917f56132b919f949e04e1e661fe5a308d91748ee834303aaa790ab77338e5', 'female'),
    ('Егор', 'Волков', 'egor.volkov', 'salt_demo_runner$7aa13cd1f9ba72c04e6f80195eb969611d295f02a7a6d17dc2fa4f5546e4467c', 'male'),
    ('Никита', 'Фролов', 'nikita.frolov', 'salt_demo_member$af453d2c00272f66023a6e7bedfaab99010a69693d737f8bf50ab8f0e05d6061', 'male')
ON CONFLICT (username) DO NOTHING;

INSERT INTO athlete_groups (name, description, access_code, created_by)
SELECT
    'Сибирский темп',
    'Основная тренировочная группа с доступом к общему просмотру результатов и дисциплинарным рейтингам.',
    'NORD2026',
    id
FROM users
WHERE username = 'coach.romanov'
ON CONFLICT (access_code) DO NOTHING;

INSERT INTO athlete_groups (name, description, access_code, created_by)
SELECT
    'Утренняя работа',
    'Небольшая группа для скоростной работы и контроля личного прогресса.',
    'MORNING7',
    id
FROM users
WHERE username = 'anna.sokolova'
ON CONFLICT (access_code) DO NOTHING;

WITH memberships (group_code, username, role, status, approved_by_username) AS (
    VALUES
        ('NORD2026', 'coach.romanov', 'coach', 'approved', 'coach.romanov'),
        ('NORD2026', 'anna.sokolova', 'athlete', 'approved', 'coach.romanov'),
        ('NORD2026', 'ivan.petrov', 'athlete', 'approved', 'coach.romanov'),
        ('NORD2026', 'daria.lebedeva', 'athlete', 'approved', 'coach.romanov'),
        ('NORD2026', 'egor.volkov', 'athlete', 'approved', 'coach.romanov'),
        ('NORD2026', 'nikita.frolov', 'athlete', 'pending', NULL),
        ('MORNING7', 'anna.sokolova', 'coach', 'approved', 'anna.sokolova'),
        ('MORNING7', 'daria.lebedeva', 'athlete', 'approved', 'anna.sokolova'),
        ('MORNING7', 'ivan.petrov', 'athlete', 'pending', NULL)
)
INSERT INTO group_memberships (group_id, user_id, role, status, approved_at, approved_by)
SELECT
    g.id,
    u.id,
    memberships.role,
    memberships.status,
    CASE WHEN memberships.status = 'approved' THEN NOW() ELSE NULL END,
    approver.id
FROM memberships
JOIN athlete_groups g ON g.access_code = memberships.group_code
JOIN users u ON u.username = memberships.username
LEFT JOIN users approver ON approver.username = memberships.approved_by_username
ON CONFLICT (group_id, user_id) DO NOTHING;

WITH seed_results (
    username,
    discipline_code,
    result_date,
    competition_name,
    performance_label,
    timing_type,
    track_length_meters,
    water_pit,
    notes
) AS (
    VALUES
        ('coach.romanov', 'run_100', DATE '2026-05-18', 'Контрольный старт', '11.62', 'auto', NULL, NULL::BOOLEAN, 'Показ тренера на открытии сезона'),
        ('anna.sokolova', 'run_100', DATE '2026-02-02', 'Зимний спринт', '13.90', 'auto', NULL, NULL::BOOLEAN, 'Первые старты сезона'),
        ('anna.sokolova', 'run_100', DATE '2026-04-11', 'Весенний кубок', '13.48', 'auto', NULL, NULL::BOOLEAN, 'Уверенный разгон'),
        ('anna.sokolova', 'run_100', DATE '2026-06-20', 'Летний первенство', '13.12', 'auto', NULL, NULL::BOOLEAN, 'Личный рекорд'),
        ('anna.sokolova', 'run_200', DATE '2026-03-15', 'Манежный старт', '28.90', 'auto', NULL, NULL::BOOLEAN, 'Работа после объема'),
        ('anna.sokolova', 'run_200', DATE '2026-05-18', 'Кубок города', '28.24', 'auto', NULL, NULL::BOOLEAN, 'Улучшение на финише'),
        ('anna.sokolova', 'run_200', DATE '2026-07-08', 'Региональный турнир', '27.70', 'auto', NULL, NULL::BOOLEAN, 'Самый ровный забег'),
        ('anna.sokolova', 'run_400', DATE '2026-04-01', 'Открытие сезона', '1:03.10', 'auto', 200, NULL::BOOLEAN, 'Манеж 200 м'),
        ('anna.sokolova', 'run_400', DATE '2026-07-19', 'Летняя серия', '1:00.50', 'auto', 200, NULL::BOOLEAN, 'Быстрый второй круг'),
        ('ivan.petrov', 'run_800', DATE '2026-02-21', 'Февральский старт', '2:07.50', 'auto', 400, NULL::BOOLEAN, 'Без подвода'),
        ('ivan.petrov', 'run_800', DATE '2026-05-02', 'Майский кубок', '2:03.20', 'auto', 400, NULL::BOOLEAN, 'Контроль в группе'),
        ('ivan.petrov', 'run_800', DATE '2026-07-12', 'Летний чемпионат', '1:58.80', 'auto', 400, NULL::BOOLEAN, 'Новый PB'),
        ('ivan.petrov', 'run_1500', DATE '2026-03-01', 'Открытый манеж', '4:28.50', 'auto', 400, NULL::BOOLEAN, 'Начало цикла'),
        ('ivan.petrov', 'run_1500', DATE '2026-06-05', 'Кубок федерации', '4:15.60', 'auto', 400, NULL::BOOLEAN, 'Хороший тактический бег'),
        ('ivan.petrov', 'run_1500', DATE '2026-08-01', 'Первенство округа', '4:03.90', 'auto', 400, NULL::BOOLEAN, 'Сильный последний круг'),
        ('ivan.petrov', 'run_3000', DATE '2026-04-10', 'Весенний контроль', '10:12.00', 'auto', 400, NULL::BOOLEAN, 'После сбора'),
        ('ivan.petrov', 'run_3000', DATE '2026-06-28', 'Тест перед чемпионатом', '9:40.20', 'auto', 400, NULL::BOOLEAN, 'Ровный темп'),
        ('ivan.petrov', 'run_3000', DATE '2026-08-14', 'Чемпионат области', '9:05.50', 'auto', 400, NULL::BOOLEAN, 'Лучший результат сезона'),
        ('daria.lebedeva', 'run_60', DATE '2026-01-25', 'Манежная встреча', '8.34', 'auto', NULL, NULL::BOOLEAN, 'Разбег после болезни'),
        ('daria.lebedeva', 'run_60', DATE '2026-03-14', 'Юниорский старт', '8.12', 'auto', NULL, NULL::BOOLEAN, 'Стабильная серия'),
        ('daria.lebedeva', 'run_60', DATE '2026-05-01', 'Спринтерский день', '7.98', 'auto', NULL, NULL::BOOLEAN, 'Лучший старт из колодок'),
        ('daria.lebedeva', 'hurdles_60', DATE '2026-02-08', 'Барьерный контроль', '9.25', 'auto', NULL, NULL::BOOLEAN, 'Срыв на первом барьере'),
        ('daria.lebedeva', 'hurdles_60', DATE '2026-04-04', 'Весенний барьер', '8.95', 'auto', NULL, NULL::BOOLEAN, 'Чистая техника'),
        ('daria.lebedeva', 'hurdles_60', DATE '2026-06-22', 'Региональный кубок', '8.42', 'auto', NULL, NULL::BOOLEAN, 'Лучший ход по дистанции'),
        ('daria.lebedeva', 'run_200', DATE '2026-03-21', 'Манежный кубок', '29.50', 'auto', NULL, NULL::BOOLEAN, 'После силовой недели'),
        ('daria.lebedeva', 'run_200', DATE '2026-05-30', 'Кубок региона', '28.60', 'auto', NULL, NULL::BOOLEAN, 'Сильный вираж'),
        ('daria.lebedeva', 'run_200', DATE '2026-07-26', 'Летняя лига', '27.95', 'auto', NULL, NULL::BOOLEAN, 'Лучший выход на прямую'),
        ('egor.volkov', 'run_1500', DATE '2026-03-18', 'Манежный турнир', '4:12.40', 'auto', 400, NULL::BOOLEAN, 'Рабочий старт'),
        ('egor.volkov', 'run_1500', DATE '2026-06-15', 'Кубок Сибири', '4:00.80', 'auto', 400, NULL::BOOLEAN, 'Хороший финиш'),
        ('egor.volkov', 'run_1500', DATE '2026-08-09', 'Чемпионат округа', '3:52.10', 'auto', 400, NULL::BOOLEAN, 'Лучший темп сезона'),
        ('egor.volkov', 'run_5000', DATE '2026-04-26', 'Весенний полумарафон', '15:58.00', 'auto', NULL, NULL::BOOLEAN, 'Контрольный старт'),
        ('egor.volkov', 'run_5000', DATE '2026-06-29', 'Кубок выносливости', '15:12.40', 'auto', NULL, NULL::BOOLEAN, 'Стабильный темп'),
        ('egor.volkov', 'run_5000', DATE '2026-08-18', 'Финал серии', '14:39.80', 'auto', NULL, NULL::BOOLEAN, 'Личный рекорд'),
        ('egor.volkov', 'run_10000', DATE '2026-05-11', 'Контроль 10 000', '32:50.00', 'auto', NULL, NULL::BOOLEAN, 'Первые 10 000 летом'),
        ('egor.volkov', 'run_10000', DATE '2026-07-06', 'Кубок области', '31:35.00', 'auto', NULL, NULL::BOOLEAN, 'Ровная раскладка'),
        ('egor.volkov', 'run_10000', DATE '2026-08-23', 'Закрытие сезона', '30:58.40', 'auto', NULL, NULL::BOOLEAN, 'Максимально зрелый бег')
),
prepared AS (
    SELECT
        u.id AS user_id,
        u.sex,
        d.id AS discipline_id,
        d.name AS discipline_name,
        d.category,
        sr.result_date,
        sr.competition_name,
        sr.performance_label,
        parse_mark_to_seconds(sr.performance_label) AS performance_seconds,
        sr.timing_type,
        sr.track_length_meters,
        sr.water_pit,
        sr.notes
    FROM seed_results sr
    JOIN users u ON u.username = sr.username
    JOIN disciplines d ON d.code = sr.discipline_code
),
inserted AS (
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
    SELECT
        prepared.user_id,
        prepared.discipline_id,
        prepared.result_date,
        prepared.competition_name,
        prepared.performance_label,
        prepared.performance_seconds,
        prepared.timing_type,
        prepared.track_length_meters,
        prepared.water_pit,
        matched.rank_code,
        NULL,
        matched.rank_code,
        prepared.notes
    FROM prepared
    LEFT JOIN LATERAL (
        SELECT rs.rank_code
        FROM rank_standards rs
        JOIN rank_catalog rc ON rc.code = rs.rank_code
        WHERE rs.discipline_id = prepared.discipline_id
          AND rs.sex = prepared.sex
          AND rs.age_group = 'adult'
          AND rs.timing_type = prepared.timing_type
          AND rs.track_length_meters IS NOT DISTINCT FROM prepared.track_length_meters
          AND rs.water_pit IS NOT DISTINCT FROM prepared.water_pit
          AND prepared.performance_seconds <= rs.result_seconds
        ORDER BY rc.rank_order
        LIMIT 1
    ) matched ON TRUE
    RETURNING id, user_id, discipline_id, effective_rank_code, created_at, result_date
)
INSERT INTO user_rank_history (
    user_id,
    discipline_id,
    result_id,
    rank_code,
    source_type,
    achieved_at,
    is_current
)
SELECT
    ranked.user_id,
    ranked.discipline_id,
    ranked.id,
    ranked.effective_rank_code,
    'auto',
    ranked.created_at,
    TRUE
FROM (
    SELECT
        inserted.*,
        rc.rank_order,
        ROW_NUMBER() OVER (
            PARTITION BY inserted.user_id, inserted.discipline_id
            ORDER BY rc.rank_order ASC, inserted.result_date DESC, inserted.id DESC
        ) AS row_num
    FROM inserted
    JOIN rank_catalog rc ON rc.code = inserted.effective_rank_code
) ranked
WHERE ranked.row_num = 1;
