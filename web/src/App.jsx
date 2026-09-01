import { useEffect, useMemo, useState } from "react";
import {
  approveGroupMember,
  createGroup,
  createResult,
  getGroupDetail,
  getGroups,
  getProfile,
  getRankHistory,
  getReferenceData,
  getResults,
  joinGroup,
  login,
  register,
  searchUsers,
} from "./api";

const emptyRegisterForm = {
  first_name: "",
  last_name: "",
  username: "",
  password: "",
  sex: "male",
};

const emptyLoginForm = {
  username: "",
  password: "",
};

const emptyReference = {
  rank_scope: "",
  ranks: [],
  disciplines: [],
  standards: [],
};

const emptyCreateGroupForm = {
  name: "",
  description: "",
};

const emptyJoinGroupForm = {
  access_code: "",
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function buildEmptyResultForm(reference) {
  const discipline = reference.disciplines[0];
  const variant = discipline?.variants?.[0];

  return {
    discipline_id: discipline?.id || "",
    performance: "",
    competition_name: "",
    result_date: todayString(),
    timing_type: variant?.timing_type || "auto",
    track_length_meters: variant?.track_length_meters ?? null,
    water_pit: variant?.water_pit ?? null,
    manual_rank_code: "",
    notes: "",
  };
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNullableBoolean(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function parsePerformance(value) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }

  const parts = normalized.split(":");
  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) {
    return null;
  }

  if (parts.length === 1) {
    return Number(numbers[0].toFixed(2));
  }
  if (parts.length === 2) {
    return Number((numbers[0] * 60 + numbers[1]).toFixed(2));
  }
  if (parts.length === 3) {
    return Number((numbers[0] * 3600 + numbers[1] * 60 + numbers[2]).toFixed(2));
  }
  return null;
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateValue));
}

function formatMonthDay(dateValue) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
  }).format(new Date(dateValue));
}

function formatSeconds(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return "0.00";
  }

  const totalHundredths = Math.round(Number(seconds) * 100);
  const hours = Math.floor(totalHundredths / 360000);
  const hoursRemainder = totalHundredths % 360000;
  const minutes = Math.floor(hoursRemainder / 6000);
  const minutesRemainder = hoursRemainder % 6000;
  const secs = Math.floor(minutesRemainder / 100);
  const hundredths = minutesRemainder % 100;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
  }
  if (minutes > 0) {
    return `${minutes}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
  }
  return `${secs}.${String(hundredths).padStart(2, "0")}`;
}

function formatProgress(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return "Нет базы";
  }
  if (Math.abs(seconds) < 0.01) {
    return "0.00";
  }

  return `${seconds > 0 ? "-" : "+"}${formatSeconds(Math.abs(seconds))}`;
}

function getProgressTone(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || Math.abs(seconds) < 0.01) {
    return "neutral";
  }

  return seconds > 0 ? "better" : "worse";
}

function getSexLabel(sex) {
  return sex === "female" ? "Женщина" : "Мужчина";
}

function getCategoryLabel(category) {
  const labels = {
    sprint: "Спринт",
    middle: "Средняя",
    long: "Длинная",
    hurdles: "Барьеры",
    steeple: "Стипль-чез",
  };

  return labels[category] || category;
}

function getMembershipLabel(role, status) {
  if (status === "pending") {
    return "Ожидает апрув";
  }
  return role === "coach" ? "Тренер" : "Участник";
}

function getResultContext(result) {
  const parts = [result.timing_type === "auto" ? "Авто" : "Ручной"];

  if (result.track_length_meters) {
    parts.push(`круг ${result.track_length_meters} м`);
  }

  if (result.water_pit === true) {
    parts.push("яма с водой");
  }
  if (result.water_pit === false) {
    parts.push("без ямы");
  }

  return parts.join(" • ");
}

function getResultDateValue(result) {
  return new Date(`${result.result_date}T00:00:00`).getTime();
}

function compareResultsChronologically(left, right) {
  const dateDifference = getResultDateValue(left) - getResultDateValue(right);
  if (dateDifference !== 0) {
    return dateDifference;
  }

  const createdDifference = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  if (createdDifference !== 0) {
    return createdDifference;
  }

  return left.id - right.id;
}

function buildDisciplineGroups(results, reference) {
  const sortOrderMap = new Map(reference.disciplines.map((item) => [item.id, item.sort_order]));
  const byDiscipline = new Map();

  results.forEach((result) => {
    if (!byDiscipline.has(result.discipline_id)) {
      byDiscipline.set(result.discipline_id, []);
    }
    byDiscipline.get(result.discipline_id).push(result);
  });

  return Array.from(byDiscipline.entries())
    .map(([disciplineId, items]) => {
      const sortedByDate = [...items].sort(compareResultsChronologically);
      const sortedByLatest = [...sortedByDate].reverse();
      const bestResult = [...items].sort((left, right) => (
        left.performance_seconds - right.performance_seconds
        || compareResultsChronologically(right, left)
      ))[0];
      const latestResult = sortedByLatest[0];
      const previousResult = sortedByLatest[1] || null;
      const recentDelta = previousResult
        ? Number((previousResult.performance_seconds - latestResult.performance_seconds).toFixed(2))
        : null;

      return {
        discipline_id: disciplineId,
        discipline_name: latestResult.discipline_name,
        category: latestResult.category,
        sort_order: sortOrderMap.get(disciplineId) || 9999,
        results: sortedByLatest,
        timeline: sortedByDate,
        bestResult,
        latestResult,
        previousResult,
        recentDelta,
      };
    })
    .sort((left, right) => (
      left.sort_order - right.sort_order
      || left.discipline_name.localeCompare(right.discipline_name, "ru")
    ));
}

function AuthTabs({ mode, onChange }) {
  return (
    <div className="tabs">
      <button
        type="button"
        className={mode === "login" ? "tab active" : "tab"}
        onClick={() => onChange("login")}
      >
        Вход
      </button>
      <button
        type="button"
        className={mode === "register" ? "tab active" : "tab"}
        onClick={() => onChange("register")}
      >
        Регистрация
      </button>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

function SelectField({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  );
}

function SegmentedControl({ label, value, options, onChange }) {
  if (options.length <= 1) {
    return null;
  }

  return (
    <div className="segmentedWrap">
      <span className="segmentLabel">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={value === option.value ? "segment active" : "segment"}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AuthScreen({
  mode,
  error,
  loading,
  loginForm,
  registerForm,
  onLoginChange,
  onRegisterChange,
  onModeChange,
  onSubmit,
}) {
  return (
    <main className="screen">
      <section className="shell">
        <div className="hero">
          <p className="eyebrow">Race Log</p>
          <h1>Беговые результаты без лишнего</h1>
          <p className="lead">Старты, прогресс и группа.</p>
        </div>

        <div className="card">
          <AuthTabs mode={mode} onChange={onModeChange} />

          <form className="form" onSubmit={onSubmit}>
            {mode === "register" ? (
              <>
                <Field
                  label="Имя"
                  name="first_name"
                  value={registerForm.first_name}
                  onChange={onRegisterChange}
                  placeholder="Иван"
                  autoComplete="given-name"
                />
                <Field
                  label="Фамилия"
                  name="last_name"
                  value={registerForm.last_name}
                  onChange={onRegisterChange}
                  placeholder="Петров"
                  autoComplete="family-name"
                />
                <Field
                  label="Логин"
                  name="username"
                  value={registerForm.username}
                  onChange={onRegisterChange}
                  placeholder="ivan.petrov"
                  autoComplete="username"
                />
                <Field
                  label="Пароль"
                  name="password"
                  type="password"
                  value={registerForm.password}
                  onChange={onRegisterChange}
                  placeholder="Минимум 6 символов"
                  autoComplete="new-password"
                />
                <SelectField
                  label="Пол"
                  name="sex"
                  value={registerForm.sex}
                  onChange={onRegisterChange}
                >
                  <option value="male">Мужчина</option>
                  <option value="female">Женщина</option>
                </SelectField>
              </>
            ) : (
              <>
                <Field
                  label="Логин"
                  name="username"
                  value={loginForm.username}
                  onChange={onLoginChange}
                  placeholder="ivan.petrov"
                  autoComplete="username"
                />
                <Field
                  label="Пароль"
                  name="password"
                  type="password"
                  value={loginForm.password}
                  onChange={onLoginChange}
                  placeholder="Введите пароль"
                  autoComplete="current-password"
                />
              </>
            )}

            {error ? <div className="error">{error}</div> : null}

            <button className="primaryButton" type="submit" disabled={loading}>
              {loading ? "Подождите..." : mode === "register" ? "Создать аккаунт" : "Войти"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function BottomNav({ view, onChange }) {
  return (
    <nav className="bottomNav">
      <button
        type="button"
        className={view === "results" ? "navItem active" : "navItem"}
        onClick={() => onChange("results")}
      >
        Результаты
      </button>
      <button
        type="button"
        className={view === "groups" ? "navItem active" : "navItem"}
        onClick={() => onChange("groups")}
      >
        Группы
      </button>
      <button
        type="button"
        className={view === "profile" ? "navItem active" : "navItem"}
        onClick={() => onChange("profile")}
      >
        Профиль
      </button>
    </nav>
  );
}

function TrendChart({ results, compact = false }) {
  const width = compact ? 240 : 320;
  const height = compact ? 72 : 164;
  const padding = compact ? 10 : 18;
  const timeline = [...results].sort(compareResultsChronologically);

  if (!timeline.length) {
    return <div className="chartEmpty">Нет точек для графика</div>;
  }

  const values = timeline.map((item) => item.performance_seconds);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue;
  const step = timeline.length > 1 ? (width - padding * 2) / (timeline.length - 1) : 0;

  const points = timeline.map((item, index) => {
    const x = padding + step * index;
    const normalizedValue = span === 0 ? 0.5 : (maxValue - item.performance_seconds) / span;
    const y = padding + normalizedValue * (height - padding * 2);
    return { x, y, item };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding / 2} L ${points[0].x} ${height - padding / 2} Z`;

  return (
    <div className={compact ? "trendChart compact" : "trendChart"}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="chartArea" d={areaPath} />
        <path className="chartLine" d={linePath} />
        {points.map((point) => (
          <circle key={point.item.id} className="chartPoint" cx={point.x} cy={point.y} r={compact ? 2.6 : 4} />
        ))}
      </svg>
      {!compact ? (
        <div className="chartLegend">
          <span>{formatMonthDay(timeline[0].result_date)}</span>
          <span>{formatMonthDay(timeline[timeline.length - 1].result_date)}</span>
        </div>
      ) : null}
    </div>
  );
}

function SearchPanel({
  currentUser,
  viewedUser,
  searchQuery,
  searchResults,
  searchLoading,
  onSearchChange,
  onSelectUser,
  onReset,
}) {
  return (
    <section className="searchCard">
      <div className="sectionHead">
        <div>
          <p className="eyebrow">Поиск</p>
          <h2>Спортсмен</h2>
        </div>
        {viewedUser?.id !== currentUser.id ? (
          <button type="button" className="inlineButton" onClick={onReset}>
            Сбросить
          </button>
        ) : null}
      </div>

      <Field
        label="Логин или имя + фамилия"
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Логин, имя или фамилия"
      />

      {searchLoading ? <p className="mutedText">Поиск...</p> : null}

      {searchResults.length ? (
        <div className="searchResults">
          {searchResults.map((item) => (
            <button
              key={item.id}
              type="button"
              className="searchItem"
              onClick={() => onSelectUser(item)}
            >
              <strong>{item.display_name}</strong>
              <span>@{item.username}</span>
            </button>
          ))}
        </div>
      ) : null}

      {viewedUser ? (
        <div className="selectedAthlete">
          <div>
            <p className="mutedText">Открыт</p>
            <strong>{viewedUser.first_name} {viewedUser.last_name}</strong>
          </div>
          <span className="rankBadge subtle">@{viewedUser.username}</span>
        </div>
      ) : null}
    </section>
  );
}

function DisciplineCard({ item, onOpen }) {
  const progressTone = getProgressTone(item.recentDelta);

  return (
    <article className="disciplineCard">
      <div className="disciplineTop">
        <div>
          <p className="resultDiscipline">{item.discipline_name}</p>
          <p className="resultMeta">{getCategoryLabel(item.category)} • {item.results.length} стартов</p>
        </div>
        <button type="button" className="inlineButton" onClick={onOpen}>
          Открыть
        </button>
      </div>

      <div className="disciplineStats">
        <div>
          <span className="metricLabel">Лучший</span>
          <strong>{item.bestResult.performance_label}</strong>
        </div>
        <div>
          <span className="metricLabel">Последний</span>
          <strong>{item.latestResult.performance_label}</strong>
        </div>
      </div>

      <TrendChart results={item.timeline} compact />

      <div className="disciplineFooter">
        <span className={`deltaPill ${progressTone}`}>
          {item.recentDelta !== null ? formatProgress(item.recentDelta) : "Нет базы"}
        </span>
        <span>{formatDate(item.latestResult.result_date)}</span>
      </div>
    </article>
  );
}

function DisciplineDetailSheet({ open, summary, athlete, onClose }) {
  if (!open || !summary || !athlete) {
    return null;
  }

  return (
    <div className="sheetOverlay" role="presentation" onClick={onClose}>
      <section className="sheet tallSheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheetHandle" />
        <div className="sheetHeader">
          <div>
            <p className="eyebrow">{athlete.first_name} {athlete.last_name}</p>
            <h2>{summary.discipline_name}</h2>
            <p className="mutedText">@{athlete.username}</p>
          </div>
          <button type="button" className="sheetClose" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="detailMetrics">
          <article className="statCard soft">
            <span>Лучший</span>
            <strong>{summary.bestResult.performance_label}</strong>
          </article>
          <article className={`statCard accent smallAccent progressCard ${getProgressTone(summary.recentDelta)}`}>
            <span>К прошлому старту</span>
            <strong>{formatProgress(summary.recentDelta)}</strong>
          </article>
        </div>

        <div className="card plainCard">
          <div className="sectionHead">
            <h2>Динамика</h2>
            <span className="mutedText">{summary.timeline.length} точек</span>
          </div>
          <TrendChart results={summary.timeline} />
        </div>

        <div className="sectionHead">
          <h2>Старты</h2>
        </div>

        <div className="resultsList">
          {summary.results.map((item) => (
            <article key={item.id} className="resultCard">
              <div className="resultHead">
                <div>
                  <p className="resultDiscipline">{item.performance_label}</p>
                  <p className="resultMeta">{formatDate(item.result_date)}</p>
                </div>
                {item.effective_rank_label ? <span className="rankBadge">{item.effective_rank_label}</span> : null}
              </div>
              <div className="resultMain">
                <strong>{item.competition_name || "Без названия старта"}</strong>
                <span>{getResultContext(item)}</span>
              </div>
              {item.notes ? <p className="mutedText">{item.notes}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ResultSheet({
  open,
  error,
  saving,
  previewRankLabel,
  rankOptions,
  reference,
  resultForm,
  onClose,
  onChange,
  onSubmit,
}) {
  if (!open) {
    return null;
  }

  const discipline = reference.disciplines.find((item) => item.id === Number(resultForm.discipline_id));
  const variants = discipline?.variants || [];
  const timingOptions = [...new Set(variants.map((item) => item.timing_type))].map((item) => ({
    value: item,
    label: item === "auto" ? "Авто" : "Ручной",
  }));
  const trackOptions = [...new Set(
    variants
      .filter((item) => item.timing_type === resultForm.timing_type)
      .map((item) => item.track_length_meters)
      .filter((item) => item !== null),
  )].map((item) => ({ value: item, label: `${item} м` }));
  const waterOptions = [...new Set(
    variants
      .filter((item) => item.timing_type === resultForm.timing_type)
      .filter((item) => item.track_length_meters === (resultForm.track_length_meters ?? item.track_length_meters))
      .map((item) => item.water_pit)
      .filter((item) => item !== null),
  )].map((item) => ({ value: item ? "true" : "false", label: item ? "С водой" : "Без воды" }));

  return (
    <div className="sheetOverlay" role="presentation" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheetHandle" />
        <div className="sheetHeader">
          <div>
            <p className="eyebrow">Новый старт</p>
            <h2>Результат</h2>
          </div>
          <button type="button" className="sheetClose" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <form className="form" onSubmit={onSubmit}>
          <SelectField
            label="Дисциплина"
            name="discipline_id"
            value={resultForm.discipline_id}
            onChange={onChange}
          >
            {reference.disciplines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>

          <Field
            label="Результат"
            name="performance"
            value={resultForm.performance}
            onChange={onChange}
            placeholder="11.24 или 2:01.34"
          />

          <Field
            label="Дата"
            name="result_date"
            type="date"
            value={resultForm.result_date}
            onChange={onChange}
          />

          <Field
            label="Соревнование"
            name="competition_name"
            value={resultForm.competition_name}
            onChange={onChange}
            placeholder="Первенство области"
          />

          <SegmentedControl
            label="Хронометраж"
            value={resultForm.timing_type}
            options={timingOptions}
            onChange={(value) => onChange({ target: { name: "timing_type", value } })}
          />

          <SegmentedControl
            label="Длина круга"
            value={resultForm.track_length_meters}
            options={trackOptions}
            onChange={(value) => onChange({ target: { name: "track_length_meters", value } })}
          />

          <SegmentedControl
            label="Препятствия"
            value={resultForm.water_pit === null ? "" : String(resultForm.water_pit)}
            options={waterOptions}
            onChange={(value) => onChange({ target: { name: "water_pit", value } })}
          />

          <SelectField
            label="Разряд вручную"
            name="manual_rank_code"
            value={resultForm.manual_rank_code}
            onChange={onChange}
          >
            <option value="">Определить автоматически</option>
            {rankOptions.map((rank) => (
              <option key={rank.code} value={rank.code}>
                {rank.label}
              </option>
            ))}
          </SelectField>

          <label className="field">
            <span>Заметка</span>
            <textarea
              name="notes"
              value={resultForm.notes}
              onChange={onChange}
              placeholder="Манеж, контрольный старт, ветер и т.д."
              rows={3}
            />
          </label>

          <div className="previewCard">
            <span>Разряд</span>
            <strong>
              {resultForm.manual_rank_code
                ? rankOptions.find((item) => item.code === resultForm.manual_rank_code)?.label || "Вручную"
                : previewRankLabel || "Пока не определяется"}
            </strong>
            <p>{reference.rank_scope}</p>
          </div>

          {error ? <div className="error">{error}</div> : null}

          <button className="primaryButton" type="submit" disabled={saving}>
            {saving ? "Сохраняю..." : "Сохранить результат"}
          </button>
        </form>
      </section>
    </div>
  );
}

function ResultsScreen({
  currentUser,
  viewedUser,
  results,
  rankHistory,
  reference,
  searchQuery,
  searchResults,
  searchLoading,
  dataLoading,
  onSearchChange,
  onSelectUser,
  onResetUser,
  onOpenCreate,
  onOpenDiscipline,
}) {
  const currentRanks = rankHistory.filter((item) => item.is_current);
  const groups = useMemo(() => buildDisciplineGroups(results, reference), [results, reference]);
  const isOwnProfile = viewedUser?.id === currentUser.id;

  return (
    <section className="tabScreen">
      <div className="heroCard">
        <div className="heroTop">
          <div>
            <p className="eyebrow">Race Log</p>
            <h1>{isOwnProfile ? "Твои старты" : `${viewedUser.first_name} ${viewedUser.last_name}`}</h1>
            <p className="lead">{isOwnProfile ? "Текущая форма по дисциплинам." : `@${viewedUser.username}`}</p>
          </div>
          {isOwnProfile ? (
            <button type="button" className="primaryButton smallButton" onClick={onOpenCreate}>
              Добавить
            </button>
          ) : null}
        </div>
        <div className="heroMeta">
          <span className="rankBadge subtle">{results.length} стартов</span>
          <span className="rankBadge subtle">{currentRanks.length} разрядов</span>
        </div>
      </div>

      <SearchPanel
        currentUser={currentUser}
        viewedUser={viewedUser}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
        onSearchChange={onSearchChange}
        onSelectUser={onSelectUser}
        onReset={onResetUser}
      />

      <div className="statsRow triple">
        <article className="statCard accent">
          <span>Стартов</span>
          <strong>{results.length}</strong>
        </article>
        <article className="statCard soft">
          <span>Разрядов</span>
          <strong>{currentRanks.length}</strong>
        </article>
        <article className="statCard soft">
          <span>Дисциплин</span>
          <strong>{groups.length}</strong>
        </article>
      </div>

      <div className="sectionHead">
        <div>
          <h2>Дисциплины</h2>
          <p className="mutedText">Прогресс считается по двум последним стартам.</p>
        </div>
      </div>

      {dataLoading ? (
        <div className="emptyState">
          <strong>Загрузка</strong>
          <p>Обновляю результаты.</p>
        </div>
      ) : groups.length ? (
        <div className="disciplineGrid">
          {groups.map((item) => (
            <DisciplineCard key={item.discipline_id} item={item} onOpen={() => onOpenDiscipline(viewedUser, item)} />
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <strong>Нет результатов</strong>
          <p>{isOwnProfile ? "Добавь первый старт." : "У спортсмена пока пусто."}</p>
        </div>
      )}
    </section>
  );
}

function GroupCard({ group, onOpen }) {
  return (
    <article className="groupCard">
      <div className="groupTop">
        <div>
          <p className="resultDiscipline">{group.name}</p>
          <p className="resultMeta">{group.description || "Без описания"}</p>
        </div>
        <span className={group.my_status === "approved" ? "statusPill approved" : "statusPill pending"}>
          {getMembershipLabel(group.my_role, group.my_status)}
        </span>
      </div>

      <div className="groupMetaRow">
        <span>{group.members_count} участников</span>
        <span>{group.pending_requests} заявок</span>
      </div>

      {group.access_code ? <p className="codeLine">Код доступа: <strong>{group.access_code}</strong></p> : null}

      <button
        type="button"
        className="primaryButton smallButton"
        onClick={onOpen}
        disabled={group.my_status !== "approved"}
      >
        {group.my_status === "approved" ? "Открыть группу" : "Ожидает апрув"}
      </button>
    </article>
  );
}

function GroupDetailSheet({
  open,
  loading,
  detail,
  error,
  approvingId,
  onClose,
  onApprove,
  onViewMember,
  onOpenDiscipline,
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="sheetOverlay" role="presentation" onClick={onClose}>
      <section className="sheet tallSheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheetHandle" />
        <div className="sheetHeader">
          <div>
            <p className="eyebrow">Группа</p>
            <h2>{detail?.group?.name || "Загрузка..."}</h2>
            {detail?.group?.description ? <p className="mutedText">{detail.group.description}</p> : null}
          </div>
          <button type="button" className="sheetClose" onClick={onClose}>
            Закрыть
          </button>
        </div>

        {loading ? <div className="card loadingCard">Загрузка...</div> : null}
        {error ? <div className="error">{error}</div> : null}

        {detail ? (
          <>
            <div className="detailMetrics">
              <article className="statCard soft">
                <span>Код доступа</span>
                <strong>{detail.group.access_code || "Недоступен"}</strong>
              </article>
              <article className="statCard accent smallAccent">
                <span>Участников</span>
                <strong>{detail.members.length}</strong>
              </article>
            </div>

            {detail.pending_members.length ? (
              <>
                <div className="sectionHead">
                  <h2>Заявки</h2>
                </div>
                <div className="memberList">
                  {detail.pending_members.map((item) => (
                    <article key={item.membership_id} className="memberCard">
                      <div>
                        <strong>{item.user.first_name} {item.user.last_name}</strong>
                        <p className="resultMeta">@{item.user.username}</p>
                      </div>
                      <button
                        type="button"
                        className="primaryButton smallButton"
                        onClick={() => onApprove(item.membership_id)}
                        disabled={approvingId === item.membership_id}
                      >
                        {approvingId === item.membership_id ? "Апрув..." : "Одобрить"}
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ) : null}

            <div className="sectionHead">
              <h2>Участники</h2>
            </div>
            <div className="memberList">
              {detail.members.map((item) => (
                <article key={item.membership_id} className="memberCard">
                  <div>
                    <strong>{item.user.first_name} {item.user.last_name}</strong>
                    <p className="resultMeta">
                      @{item.user.username} • {getMembershipLabel(item.role, item.status)}
                    </p>
                    <p className="mutedText">
                      {item.result_count} результатов • {item.active_rank_count} активных разрядов
                    </p>
                  </div>
                  <button type="button" className="inlineButton" onClick={() => onViewMember(item.user)}>
                    Открыть результаты
                  </button>
                </article>
              ))}
            </div>

            <div className="sectionHead">
              <div>
                <h2>Лидеры</h2>
                <p className="mutedText">По лучшему результату в дисциплине.</p>
              </div>
            </div>

            <div className="leaderboardList">
              {detail.discipline_leaderboards.length ? detail.discipline_leaderboards.map((board) => (
                <article key={board.discipline_id} className="leaderboardCard">
                  <div className="leaderboardHead">
                    <div>
                      <p className="resultDiscipline">{board.discipline_name}</p>
                      <p className="resultMeta">{getCategoryLabel(board.category)}</p>
                    </div>
                    <span className="rankBadge subtle">{board.entries.length} участников</span>
                  </div>

                  <div className="leaderboardEntries">
                    {board.entries.map((entry, index) => (
                      <button
                        key={`${board.discipline_id}-${entry.user.id}`}
                        type="button"
                        className="leaderboardEntry"
                        onClick={() => onOpenDiscipline(entry.user, board.discipline_id)}
                      >
                        <span className="positionBadge">{index + 1}</span>
                        <div className="leaderboardMain">
                          <strong>{entry.user.first_name} {entry.user.last_name}</strong>
                          <p className="resultMeta">@{entry.user.username} • {entry.total_results} стартов</p>
                        </div>
                        <div className="leaderboardScore">
                          <strong>{entry.best_result.performance_label}</strong>
                          <span>{entry.best_result.effective_rank_label || getResultContext(entry.best_result)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </article>
              )) : (
                <div className="emptyState">
                  <strong>Нет рейтинга</strong>
                  <p>Добавьте результаты.</p>
                </div>
              )}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function GroupsScreen({
  groups,
  loading,
  createForm,
  joinForm,
  error,
  success,
  submitting,
  onCreateChange,
  onJoinChange,
  onCreateSubmit,
  onJoinSubmit,
  onOpenGroup,
}) {
  return (
    <section className="tabScreen">
      <div className="heroCard altHero">
        <p className="eyebrow">Группы</p>
        <h1>Команды и доступ</h1>
        <p className="lead">Создание, вступление, лидеры.</p>
      </div>

      <div className="groupActions">
        <article className="card">
          <div className="sectionHead">
            <h2>Создать группу</h2>
          </div>
          <form className="form" onSubmit={onCreateSubmit}>
            <Field
              label="Название"
              name="name"
              value={createForm.name}
              onChange={onCreateChange}
              placeholder="Сибирский темп"
            />
            <label className="field">
              <span>Описание</span>
              <textarea
                name="description"
                value={createForm.description}
                onChange={onCreateChange}
                placeholder="Коротко о группе и целях"
                rows={3}
              />
            </label>
            <button className="primaryButton" type="submit" disabled={submitting}>
              {submitting ? "Создаю..." : "Создать"}
            </button>
          </form>
        </article>

        <article className="card">
          <div className="sectionHead">
            <h2>Вступить по коду</h2>
          </div>
          <form className="form" onSubmit={onJoinSubmit}>
            <Field
              label="Код доступа"
              name="access_code"
              value={joinForm.access_code}
              onChange={onJoinChange}
              placeholder="NORD2026"
            />
            <button className="primaryButton" type="submit" disabled={submitting}>
              {submitting ? "Отправляю..." : "Подать заявку"}
            </button>
          </form>
        </article>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <div className="sectionHead">
        <h2>Мои группы</h2>
      </div>

      {loading ? (
        <div className="card loadingCard">Загрузка...</div>
      ) : groups.length ? (
        <div className="groupList">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} onOpen={() => onOpenGroup(group)} />
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <strong>Нет групп</strong>
          <p>Создай группу или вступи по коду.</p>
        </div>
      )}
    </section>
  );
}

function ProfileScreen({ user, rankHistory, onLogout }) {
  const initials = `${user.first_name[0] || ""}${user.last_name[0] || ""}`.toUpperCase();
  const currentRanks = rankHistory.filter((item) => item.is_current);

  return (
    <section className="tabScreen">
      <div className="profileTop">
        <div>
          <p className="eyebrow">Профиль</p>
          <h1>{user.first_name} {user.last_name}</h1>
          <p className="lead">@{user.username}</p>
        </div>
        <button type="button" className="ghostButton" onClick={onLogout}>
          Выйти
        </button>
      </div>

      <div className="profileCard">
        <div className="avatar">{initials}</div>
        <div className="profileMeta">
          <p className="profileName">{user.first_name} {user.last_name}</p>
          <p className="profileLogin">@{user.username}</p>
          <p className="profileLogin">{getSexLabel(user.sex)}</p>
        </div>
      </div>

      <div className="sectionHead">
        <h2>Текущие разряды</h2>
      </div>

      <div className="chipRow">
        {currentRanks.length ? currentRanks.map((item) => (
          <span key={item.id} className="rankBadge">{item.discipline_name}: {item.rank_label}</span>
        )) : <p className="mutedText">Пока нет присвоенных разрядов.</p>}
      </div>

      <div className="sectionHead">
        <h2>История разрядов</h2>
      </div>

      <div className="historyList">
        {rankHistory.length ? rankHistory.map((item) => (
          <article key={item.id} className="historyCard">
            <span>{item.rank_label}</span>
            <strong>{item.discipline_name}</strong>
            <p>{formatDate(item.achieved_at)} • {item.source_type === "manual" ? "Вручную" : "Авто"}</p>
          </article>
        )) : <p className="mutedText">История появится после первого результата.</p>}
      </div>
    </section>
  );
}

export default function App() {
  const [mode, setMode] = useState("login");
  const [view, setView] = useState("results");
  const [token, setToken] = useState(() => localStorage.getItem("race-log-token") || "");
  const [user, setUser] = useState(null);
  const [reference, setReference] = useState(emptyReference);
  const [ownResults, setOwnResults] = useState([]);
  const [ownRankHistory, setOwnRankHistory] = useState([]);
  const [viewedUser, setViewedUser] = useState(null);
  const [viewedResults, setViewedResults] = useState([]);
  const [viewedRankHistory, setViewedRankHistory] = useState([]);
  const [resultsCache, setResultsCache] = useState({});
  const [groups, setGroups] = useState([]);
  const [groupDetail, setGroupDetail] = useState(null);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [groupDetailLoading, setGroupDetailLoading] = useState(false);
  const [groupDetailError, setGroupDetailError] = useState("");
  const [approvingMembershipId, setApprovingMembershipId] = useState(null);
  const [detailSheet, setDetailSheet] = useState({ open: false, athlete: null, summary: null });
  const [loading, setLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [resultError, setResultError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm);
  const [loginForm, setLoginForm] = useState(emptyLoginForm);
  const [resultForm, setResultForm] = useState(buildEmptyResultForm(emptyReference));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultsState, setSearchResultsState] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [createGroupForm, setCreateGroupForm] = useState(emptyCreateGroupForm);
  const [joinGroupForm, setJoinGroupForm] = useState(emptyJoinGroupForm);
  const [groupError, setGroupError] = useState("");
  const [groupSuccess, setGroupSuccess] = useState("");
  const [groupSubmitting, setGroupSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setBootstrapping(false);
      return;
    }

    getProfile(token)
      .then((profile) => {
        setUser(profile);
        setError("");
      })
      .catch(() => {
        localStorage.removeItem("race-log-token");
        setToken("");
        setUser(null);
      })
      .finally(() => setBootstrapping(false));
  }, [token]);

  useEffect(() => {
    if (!token || !user) {
      return;
    }

    setAppLoading(true);
    setGroupsLoading(true);

    Promise.all([
      getReferenceData(token),
      getResults(token),
      getRankHistory(token),
      getGroups(token),
    ])
      .then(([referenceData, resultsData, rankHistoryData, groupsData]) => {
        setReference(referenceData);
        setOwnResults(resultsData);
        setOwnRankHistory(rankHistoryData);
        setViewedUser(user);
        setViewedResults(resultsData);
        setViewedRankHistory(rankHistoryData);
        setResultsCache({ [user.id]: resultsData });
        setGroups(groupsData);
        setResultForm(buildEmptyResultForm(referenceData));
      })
      .catch(() => {
        setViewedResults([]);
        setViewedRankHistory([]);
        setGroups([]);
      })
      .finally(() => {
        setAppLoading(false);
        setGroupsLoading(false);
      });
  }, [token, user]);

  useEffect(() => {
    if (!reference.disciplines.length || !resultForm.discipline_id) {
      return;
    }

    const discipline = reference.disciplines.find((item) => item.id === Number(resultForm.discipline_id));
    if (!discipline) {
      return;
    }

    const timingType = discipline.variants.some((item) => item.timing_type === resultForm.timing_type)
      ? resultForm.timing_type
      : discipline.variants[0].timing_type;

    const timingVariants = discipline.variants.filter((item) => item.timing_type === timingType);
    const selectedVariant = timingVariants.find(
      (item) =>
        item.track_length_meters === resultForm.track_length_meters &&
        item.water_pit === resultForm.water_pit,
    ) || timingVariants[0];

    if (
      timingType === resultForm.timing_type &&
      (selectedVariant.track_length_meters ?? null) === resultForm.track_length_meters &&
      (selectedVariant.water_pit ?? null) === resultForm.water_pit
    ) {
      return;
    }

    setResultForm((current) => ({
      ...current,
      timing_type: timingType,
      track_length_meters: selectedVariant.track_length_meters ?? null,
      water_pit: selectedVariant.water_pit ?? null,
    }));
  }, [
    reference,
    resultForm.discipline_id,
    resultForm.timing_type,
    resultForm.track_length_meters,
    resultForm.water_pit,
  ]);

  useEffect(() => {
    if (!token || !user) {
      return undefined;
    }

    if (searchQuery.trim().length < 2) {
      setSearchResultsState([]);
      setSearchLoading(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true);
      searchUsers(token, searchQuery.trim())
        .then((items) => setSearchResultsState(items))
        .catch(() => setSearchResultsState([]))
        .finally(() => setSearchLoading(false));
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [token, user, searchQuery]);

  const previewRankLabel = useMemo(() => {
    const seconds = parsePerformance(resultForm.performance);
    if (seconds === null) {
      return "";
    }

    const relevant = reference.standards
      .filter((item) => item.discipline_id === Number(resultForm.discipline_id))
      .filter((item) => item.timing_type === resultForm.timing_type)
      .filter((item) => item.track_length_meters === resultForm.track_length_meters)
      .filter((item) => item.water_pit === resultForm.water_pit)
      .sort((left, right) => left.rank_order - right.rank_order);

    const matched = relevant.find((item) => seconds <= item.result_seconds);
    return matched?.rank_label || "";
  }, [reference, resultForm]);

  function persistAuth(authResponse) {
    localStorage.setItem("race-log-token", authResponse.access_token);
    setToken(authResponse.access_token);
    setUser(authResponse.user);
    setError("");
  }

  async function loadViewedUser(targetUser) {
    if (!token) {
      return;
    }

    if (targetUser.id === user.id) {
      setViewedUser(user);
      setViewedResults(ownResults);
      setViewedRankHistory(ownRankHistory);
      return;
    }

    setResultsLoading(true);
    try {
      const [resultsData, rankHistoryData] = await Promise.all([
        getResults(token, targetUser.id),
        getRankHistory(token, targetUser.id),
      ]);
      setViewedUser(targetUser);
      setViewedResults(resultsData);
      setViewedRankHistory(rankHistoryData);
      setResultsCache((current) => ({ ...current, [targetUser.id]: resultsData }));
    } finally {
      setResultsLoading(false);
    }
  }

  async function loadGroups() {
    if (!token) {
      return;
    }

    setGroupsLoading(true);
    try {
      const groupsData = await getGroups(token);
      setGroups(groupsData);
    } finally {
      setGroupsLoading(false);
    }
  }

  async function openGroup(group) {
    if (!token || group.my_status !== "approved") {
      return;
    }

    setGroupSheetOpen(true);
    setGroupDetail(null);
    setGroupDetailLoading(true);
    setGroupDetailError("");

    try {
      const detail = await getGroupDetail(token, group.id);
      setGroupDetail(detail);
    } catch (fetchError) {
      setGroupDetailError(fetchError.message);
    } finally {
      setGroupDetailLoading(false);
    }
  }

  async function openDisciplineForUser(athlete, disciplineRef) {
    if (!token) {
      return;
    }

    try {
      const disciplineId = typeof disciplineRef === "number" ? disciplineRef : disciplineRef.discipline_id;
      let resultsData = resultsCache[athlete.id];

      if (!resultsData) {
        const fetched = await getResults(token, athlete.id);
        resultsData = fetched;
        setResultsCache((current) => ({ ...current, [athlete.id]: fetched }));
      }

      const summary = buildDisciplineGroups(resultsData, reference).find((item) => item.discipline_id === disciplineId);
      if (!summary) {
        return;
      }

      setDetailSheet({
        open: true,
        athlete,
        summary,
      });
    } catch {
      setDetailSheet({ open: false, athlete: null, summary: null });
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (mode === "register") {
        const authResponse = await register(registerForm);
        persistAuth(authResponse);
      } else {
        const authResponse = await login(loginForm);
        persistAuth(authResponse);
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  function handleRegisterChange(event) {
    const { name, value } = event.target;
    setRegisterForm((current) => ({ ...current, [name]: value }));
  }

  function handleLoginChange(event) {
    const { name, value } = event.target;
    setLoginForm((current) => ({ ...current, [name]: value }));
  }

  function handleLogout() {
    localStorage.removeItem("race-log-token");
    setToken("");
    setUser(null);
    setViewedUser(null);
    setViewedResults([]);
    setViewedRankHistory([]);
    setGroups([]);
    setGroupDetail(null);
    setMode("login");
    setLoginForm(emptyLoginForm);
  }

  function handleResultChange(event) {
    const { name, value } = event.target;
    setResultForm((current) => ({
      ...current,
      [name]:
        name === "discipline_id"
          ? Number(value)
          : name === "track_length_meters"
            ? normalizeNullableNumber(value)
            : name === "water_pit"
              ? normalizeNullableBoolean(value)
              : value,
    }));
  }

  async function handleResultSubmit(event) {
    event.preventDefault();
    setSavingResult(true);
    setResultError("");

    try {
      const payload = {
        ...resultForm,
        track_length_meters: normalizeNullableNumber(resultForm.track_length_meters),
        water_pit: normalizeNullableBoolean(resultForm.water_pit),
        manual_rank_code: resultForm.manual_rank_code || null,
        competition_name: resultForm.competition_name || null,
        notes: resultForm.notes || null,
      };
      const created = await createResult(token, payload);
      const nextOwnResults = [created, ...ownResults];
      setOwnResults(nextOwnResults);
      setResultsCache((current) => ({ ...current, [user.id]: nextOwnResults }));
      if (viewedUser?.id === user.id) {
        setViewedResults(nextOwnResults);
      }

      const history = await getRankHistory(token);
      setOwnRankHistory(history);
      if (viewedUser?.id === user.id) {
        setViewedRankHistory(history);
      }

      setSheetOpen(false);
      setResultForm(buildEmptyResultForm(reference));
    } catch (submitError) {
      setResultError(submitError.message);
    } finally {
      setSavingResult(false);
    }
  }

  async function handleCreateGroupSubmit(event) {
    event.preventDefault();
    setGroupSubmitting(true);
    setGroupError("");
    setGroupSuccess("");

    try {
      const created = await createGroup(token, createGroupForm);
      setCreateGroupForm(emptyCreateGroupForm);
      setGroupSuccess(`Группа "${created.name}" создана. Код доступа: ${created.access_code}`);
      await loadGroups();
      await openGroup(created);
    } catch (submitError) {
      setGroupError(submitError.message);
    } finally {
      setGroupSubmitting(false);
    }
  }

  async function handleJoinGroupSubmit(event) {
    event.preventDefault();
    setGroupSubmitting(true);
    setGroupError("");
    setGroupSuccess("");

    try {
      const joined = await joinGroup(token, joinGroupForm);
      setJoinGroupForm(emptyJoinGroupForm);
      setGroupSuccess(`Заявка в группу "${joined.name}" отправлена и ждет апрув тренера.`);
      await loadGroups();
    } catch (submitError) {
      setGroupError(submitError.message);
    } finally {
      setGroupSubmitting(false);
    }
  }

  async function handleApproveMembership(membershipId) {
    if (!token || !groupDetail?.group) {
      return;
    }

    setApprovingMembershipId(membershipId);
    setGroupDetailError("");
    try {
      const detail = await approveGroupMember(token, groupDetail.group.id, membershipId);
      setGroupDetail(detail);
      await loadGroups();
    } catch (approveError) {
      setGroupDetailError(approveError.message);
    } finally {
      setApprovingMembershipId(null);
    }
  }

  async function handleSelectSearchUser(nextUser) {
    setSearchQuery(nextUser.username);
    setSearchResultsState([]);
    await loadViewedUser(nextUser);
  }

  async function handleViewMemberFromGroup(member) {
    setGroupSheetOpen(false);
    setView("results");
    setSearchQuery(member.username);
    await loadViewedUser(member);
  }

  async function handleResetViewedUser() {
    setSearchQuery("");
    setSearchResultsState([]);
    await loadViewedUser(user);
  }

  if (bootstrapping) {
    return (
      <main className="screen">
        <section className="shell loadingShell">
          <div className="card loadingCard">Загрузка профиля...</div>
        </section>
      </main>
    );
  }

  if (user) {
    return (
      <main className="screen">
        <section className="shell appShell">
          {appLoading ? (
            <div className="card loadingCard">Загружаю результаты, группы и аналитику...</div>
          ) : (
            <>
              {view === "results" ? (
                <ResultsScreen
                  currentUser={user}
                  viewedUser={viewedUser || user}
                  results={viewedResults}
                  rankHistory={viewedRankHistory}
                  reference={reference}
                  searchQuery={searchQuery}
                  searchResults={searchResultsState}
                  searchLoading={searchLoading}
                  dataLoading={resultsLoading}
                  onSearchChange={setSearchQuery}
                  onSelectUser={handleSelectSearchUser}
                  onResetUser={handleResetViewedUser}
                  onOpenCreate={() => setSheetOpen(true)}
                  onOpenDiscipline={openDisciplineForUser}
                />
              ) : null}

              {view === "groups" ? (
                <GroupsScreen
                  groups={groups}
                  loading={groupsLoading}
                  createForm={createGroupForm}
                  joinForm={joinGroupForm}
                  error={groupError}
                  success={groupSuccess}
                  submitting={groupSubmitting}
                  onCreateChange={(event) => {
                    const { name, value } = event.target;
                    setCreateGroupForm((current) => ({ ...current, [name]: value }));
                  }}
                  onJoinChange={(event) => {
                    const { name, value } = event.target;
                    setJoinGroupForm((current) => ({ ...current, [name]: value.toUpperCase() }));
                  }}
                  onCreateSubmit={handleCreateGroupSubmit}
                  onJoinSubmit={handleJoinGroupSubmit}
                  onOpenGroup={openGroup}
                />
              ) : null}

              {view === "profile" ? (
                <ProfileScreen user={user} rankHistory={ownRankHistory} onLogout={handleLogout} />
              ) : null}
            </>
          )}

          <BottomNav view={view} onChange={setView} />

          <ResultSheet
            open={sheetOpen}
            error={resultError}
            saving={savingResult}
            previewRankLabel={previewRankLabel}
            rankOptions={reference.ranks}
            reference={reference}
            resultForm={resultForm}
            onClose={() => {
              setSheetOpen(false);
              setResultError("");
            }}
            onChange={handleResultChange}
            onSubmit={handleResultSubmit}
          />

          <GroupDetailSheet
            open={groupSheetOpen}
            loading={groupDetailLoading}
            detail={groupDetail}
            error={groupDetailError}
            approvingId={approvingMembershipId}
            onClose={() => {
              setGroupSheetOpen(false);
              setGroupDetailError("");
            }}
            onApprove={handleApproveMembership}
            onViewMember={handleViewMemberFromGroup}
            onOpenDiscipline={openDisciplineForUser}
          />

          <DisciplineDetailSheet
            open={detailSheet.open}
            athlete={detailSheet.athlete}
            summary={detailSheet.summary}
            onClose={() => setDetailSheet({ open: false, athlete: null, summary: null })}
          />
        </section>
      </main>
    );
  }

  return (
    <AuthScreen
      mode={mode}
      error={error}
      loading={loading}
      loginForm={loginForm}
      registerForm={registerForm}
      onLoginChange={handleLoginChange}
      onRegisterChange={handleRegisterChange}
      onModeChange={(nextMode) => {
        setMode(nextMode);
        setError("");
      }}
      onSubmit={handleSubmit}
    />
  );
}
