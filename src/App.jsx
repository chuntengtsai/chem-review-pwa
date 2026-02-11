import { useEffect, useMemo, useState } from 'react';
import { SKILLS, getAllDiagnosticQuestions, getPracticeQuestionsForSkill } from './content/skills.js';

// eslint-disable-next-line no-undef
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

function formatBuildTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    return fmt.format(d);
  } catch {
    return String(iso);
  }
}

function cls(...xs) {
  return xs.filter(Boolean).join(' ');
}

function Badge({ children, tone = 'neutral' }) {
  const toneCls =
    tone === 'good'
      ? 'border-emerald-300/30 bg-emerald-500/10 text-emerald-50'
      : tone === 'warn'
        ? 'border-amber-300/30 bg-amber-500/10 text-amber-50'
        : tone === 'info'
          ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-50'
          : 'border-white/10 bg-white/5 text-white/80';
  return (
    <span className={cls('inline-flex items-center rounded-full border px-2 py-0.5 text-xs', toneCls)}>{children}</span>
  );
}

function StepPill({ label, state }) {
  // state: done|active|todo
  const s =
    state === 'done'
      ? { tone: 'good', text: '已完成' }
      : state === 'active'
        ? { tone: 'info', text: '進行中' }
        : { tone: 'neutral', text: '未開始' };
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
      <div className="text-xs text-white/75">{label}</div>
      <Badge tone={s.tone}>{s.text}</Badge>
    </div>
  );
}

function computeMastery(skills, answersByQid) {
  const perSkill = {};
  for (const s of skills) {
    const qs = s.diagnostic || [];
    if (qs.length === 0) {
      perSkill[s.id] = { correct: 0, total: 0, mastery: 0 };
      continue;
    }
    let correct = 0;
    for (const q of qs) {
      const a = answersByQid[q.id];
      if (a === undefined) continue;
      if (a === q.answer) correct += 1;
    }
    const total = qs.length;
    const mastery = Math.round((correct / total) * 100);
    perSkill[s.id] = { correct, total, mastery };
  }
  return perSkill;
}

function pickPlan(perSkill, days = 7) {
  const ranked = Object.entries(perSkill)
    .map(([skillId, v]) => ({ skillId, mastery: v.mastery }))
    .sort((a, b) => a.mastery - b.mastery);

  // simple: rotate through weakest skills
  const plan = [];
  for (let i = 0; i < days; i++) {
    plan.push(ranked[i % Math.max(1, ranked.length)]?.skillId);
  }
  return plan;
}

const STORAGE_KEY = 'chem-review-pwa.state.v1';

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export default function App() {
  const [view, setView] = useState('home'); // home|diagnostic|result|task
  const [diagIndex, setDiagIndex] = useState(0);
  const [answers, setAnswers] = useState({});

  const [plan, setPlan] = useState([]); // skillIds
  const [dayIndex, setDayIndex] = useState(0);

  // per day: { [dayIndex]: { conceptDone: boolean, practiceDone: boolean } }
  const [dayProgress, setDayProgress] = useState({});
  const diagnosticDone = useMemo(() => Object.keys(answers || {}).length > 0 && plan.length > 0, [answers, plan]);

  // load persisted state
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = safeParse(raw, null);
    if (!s || typeof s !== 'object') return;
    if (Array.isArray(s.plan)) setPlan(s.plan);
    if (typeof s.dayIndex === 'number') setDayIndex(s.dayIndex);
    if (s.answers && typeof s.answers === 'object') setAnswers(s.answers);
    if (s.dayProgress && typeof s.dayProgress === 'object') setDayProgress(s.dayProgress);
  }, []);

  // persist state
  useEffect(() => {
    const payload = {
      plan,
      dayIndex,
      answers,
      dayProgress,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [plan, dayIndex, answers, dayProgress]);

  const allQuestions = useMemo(() => getAllDiagnosticQuestions(), []);

  const perSkill = useMemo(() => computeMastery(SKILLS, answers), [answers]);
  const weakTop3 = useMemo(() => {
    const xs = Object.entries(perSkill)
      .map(([skillId, v]) => ({ skillId, mastery: v.mastery }))
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 3);
    return xs;
  }, [perSkill]);

  const currentQ = allQuestions[diagIndex];
  const currentSkill = useMemo(() => {
    const sid = plan[dayIndex];
    return SKILLS.find((s) => s.id === sid) || null;
  }, [plan, dayIndex]);

  const stepState = useMemo(() => {
    const answeredCount = Object.keys(answers || {}).length;
    const diagDone = plan.length > 0; // plan exists only after submit
    const inDiag = view === 'diagnostic';
    const inResult = view === 'result';
    const inTask = view === 'task';
    return {
      diag: diagDone ? 'done' : inDiag ? 'active' : answeredCount > 0 ? 'active' : 'todo',
      plan: diagDone ? (inResult ? 'active' : 'done') : 'todo',
      today: diagDone ? (inTask ? 'active' : 'todo') : 'todo'
    };
  }, [answers, plan.length, view]);

  const todayDone = useMemo(() => {
    const p = dayProgress?.[dayIndex] || {};
    return Boolean(p.conceptDone && p.practiceDone);
  }, [dayProgress, dayIndex]);

  function startDiagnostic() {
    setView('diagnostic');
    setDiagIndex(0);
    setAnswers({});
  }

  function submitDiagnostic() {
    const newPlan = pickPlan(perSkill, 7);
    setPlan(newPlan);
    setDayIndex(0);
    setView('result');
  }

  function goTodayTask() {
    setView('task');
  }

  const buildLabel = useMemo(() => formatBuildTime(BUILD_TIME), []);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs tracking-widest text-white/50">PWA MVP</div>
            <h1 className="mt-1 text-2xl font-semibold text-white/90">高一化學覆習（診斷 → 補洞）</h1>
            <p className="mt-2 text-sm text-white/70">
              先做出：診斷測驗、弱點排行、7 日補洞路徑（概念 + 題型混合）。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge>React</Badge>
            <Badge>Vite</Badge>
            <Badge>Tailwind</Badge>
          </div>
        </header>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-5 grid gap-2 md:grid-cols-3">
            <StepPill label="1. 診斷" state={stepState.diag} />
            <StepPill label="2. 路徑" state={stepState.plan} />
            <StepPill label="3. 今日任務" state={stepState.today} />
          </div>

          {view === 'home' ? (
            <div className="grid gap-4">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs tracking-widest text-white/50">START</div>
                <div className="mt-2 text-sm text-white/75">
                  做一份簡短診斷（約 2–5 分鐘，先用示範題），得到你的補洞路徑。
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                    type="button"
                    onClick={startDiagnostic}
                  >
                    開始診斷
                  </button>

                  {plan.length > 0 ? (
                    <>
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={() => setView('result')}
                      >
                        看我的路徑
                      </button>
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={() => setView('task')}
                      >
                        進入今日任務
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/10 p-4 text-sm text-white/65">
                MVP 註：目前題庫是示範（3 個技能點）。接下來會擴到 12 個技能點、至少 145 題（25 診斷 + 120 補洞）。
              </div>
            </div>
          ) : null}

          {view === 'diagnostic' ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3 text-xs text-white/55">
                <span>
                  題目 {diagIndex + 1} / {allQuestions.length}
                </span>
                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                  type="button"
                  onClick={() => setView('home')}
                >
                  退出
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-semibold text-white/90">{currentQ?.stem}</div>
                <div className="mt-3 grid gap-2">
                  {(currentQ?.choices || []).map((c, idx) => {
                    const chosen = answers[currentQ.id] === idx;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={cls(
                          'w-full text-left rounded-xl border px-4 py-3 text-sm',
                          chosen
                            ? 'border-cyan-300/40 bg-cyan-500/10 text-cyan-50'
                            : 'border-white/10 bg-black/10 text-white/80 hover:bg-black/20'
                        )}
                        onClick={() => {
                          setAnswers((p) => ({ ...p, [currentQ.id]: idx }));
                        }}
                      >
                        {String.fromCharCode(65 + idx)}. {c}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10 disabled:opacity-50"
                    type="button"
                    disabled={diagIndex === 0}
                    onClick={() => setDiagIndex((i) => Math.max(0, i - 1))}
                  >
                    上一題
                  </button>

                  {diagIndex < allQuestions.length - 1 ? (
                    <button
                      className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
                      type="button"
                      disabled={answers[currentQ.id] === undefined}
                      onClick={() => setDiagIndex((i) => Math.min(allQuestions.length - 1, i + 1))}
                    >
                      下一題
                    </button>
                  ) : (
                    <button
                      className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                      type="button"
                      onClick={submitDiagnostic}
                    >
                      送出診斷
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/10 p-4 text-xs text-white/55">
                設計目標：診斷題要能定位「技能點弱項」。MVP 先用每技能點 2 題做示範。
              </div>
            </div>
          ) : null}

          {view === 'result' ? (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="text-xs tracking-widest text-white/50">RESULT</div>
                <div className="mt-2 text-base font-semibold text-white/90">你的弱點 Top 3</div>
                <div className="mt-3 grid gap-2">
                  {weakTop3.map((w) => {
                    const s = SKILLS.find((x) => x.id === w.skillId);
                    return (
                      <div key={w.skillId} className="rounded-xl border border-white/10 bg-black/10 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white/90">{s?.name}</div>
                            <div className="mt-1 text-xs text-white/55">{s?.blurb}</div>
                          </div>
                          <Badge>{w.mastery}%</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-white/70">
                    7 日補洞路徑（示範）：第 1 天從最弱技能點開始。
                  </div>
                  <button
                    className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                    type="button"
                    onClick={goTodayTask}
                  >
                    進入今日任務
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="text-xs tracking-widest text-white/50">PLAN</div>
                <div className="mt-2 grid gap-2">
                  {plan.map((sid, idx) => {
                    const s = SKILLS.find((x) => x.id === sid);
                    const isToday = idx === dayIndex;
                    const p = dayProgress?.[idx] || {};
                    const done = Boolean(p.conceptDone && p.practiceDone);
                    return (
                      <div
                        key={`${sid}_${idx}`}
                        className={cls(
                          'rounded-xl border p-3 text-sm',
                          isToday
                            ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-50'
                            : done
                              ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50'
                              : 'border-white/10 bg-black/10 text-white/75'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            Day {idx + 1}: {s?.name || sid}
                          </div>
                          {done ? <Badge tone="good">已完成</Badge> : isToday ? <Badge tone="info">今天</Badge> : <Badge>未開始</Badge>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {view === 'task' ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs tracking-widest text-white/50">TODAY</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <div className="text-base font-semibold text-white/90">Day {dayIndex + 1}: {currentSkill?.name || '—'}</div>
                    {todayDone ? <Badge tone="good">今日完成</Badge> : <Badge tone="warn">未完成</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-white/65">{currentSkill?.blurb}</div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() => document.getElementById('concept')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      跳到概念
                    </button>
                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() => document.getElementById('practice')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      跳到練習
                    </button>
                  </div>
                </div>
                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/75 hover:bg-white/10"
                  type="button"
                  onClick={() => setView('result')}
                >
                  返回
                </button>
              </div>

              <div id="concept" className="scroll-mt-6 rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs tracking-widest text-white/50">CONCEPT</div>
                  <div className="flex items-center gap-2">
                    {dayProgress?.[dayIndex]?.conceptDone ? <Badge tone="good">已完成</Badge> : <Badge>未完成</Badge>}
                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() =>
                        setDayProgress((p) => ({
                          ...p,
                          [dayIndex]: { ...(p?.[dayIndex] || {}), conceptDone: !p?.[dayIndex]?.conceptDone }
                        }))
                      }
                    >
                      標記
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-sm leading-relaxed text-white/80">
                  先用 1 句話抓重點：把這個技能點的「定義」與「公式/關係式」背成一句話，然後用 8–12 題快速驗證。
                </div>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4 text-sm text-white/75">
                  MVP Demo：這裡之後會放「概念卡」內容（1–2 張）+ 範例。
                </div>
              </div>

              <div id="practice" className="scroll-mt-6 rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs tracking-widest text-white/50">PRACTICE</div>
                  <div className="flex items-center gap-2">
                    {dayProgress?.[dayIndex]?.practiceDone ? <Badge tone="good">已完成</Badge> : <Badge>未完成</Badge>}
                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() =>
                        setDayProgress((p) => ({
                          ...p,
                          [dayIndex]: { ...(p?.[dayIndex] || {}), practiceDone: !p?.[dayIndex]?.practiceDone }
                        }))
                      }
                    >
                      標記
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-sm text-white/65">
                  MVP Demo：暫用診斷題當練習題（之後每技能點會有 10 題練習）。
                </div>
                <div className="mt-3 grid gap-2">
                  {getPracticeQuestionsForSkill(currentSkill?.id || '').map((q) => (
                    <div key={q.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
                      <div className="text-sm font-semibold text-white/90">{q.stem}</div>
                      <div className="mt-2 text-xs text-white/55">
                        答案：{String.fromCharCode(65 + q.answer)} · {q.explanation}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10 disabled:opacity-50"
                    type="button"
                    disabled={dayIndex === 0}
                    onClick={() => setDayIndex((d) => Math.max(0, d - 1))}
                  >
                    前一天
                  </button>
                  <button
                    className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
                    type="button"
                    disabled={dayIndex >= plan.length - 1}
                    onClick={() => setDayIndex((d) => Math.min(plan.length - 1, d + 1))}
                  >
                    下一天
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <footer className="mt-8 text-xs text-white/45">
          設計原則：先做出「診斷 → 路徑 → 每日任務 → 回測」閉環，再逐步擴題庫與錯因分析。
        </footer>
      </div>

      {buildLabel ? (
        <div className="fixed bottom-3 right-3 z-50 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-white/65 backdrop-blur">
          最後部署：{buildLabel}
        </div>
      ) : null}
    </div>
  );
}
