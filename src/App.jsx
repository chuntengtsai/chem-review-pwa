import { useMemo, useState } from 'react';
import { SKILLS, getAllDiagnosticQuestions, getPracticeQuestionsForSkill } from './content/skills.js';

function cls(...xs) {
  return xs.filter(Boolean).join(' ');
}

function Badge({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/80">
      {children}
    </span>
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

export default function App() {
  const [view, setView] = useState('home'); // home|diagnostic|result|task
  const [diagIndex, setDiagIndex] = useState(0);
  const [answers, setAnswers] = useState({});

  const [plan, setPlan] = useState([]); // skillIds
  const [dayIndex, setDayIndex] = useState(0);

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
                    return (
                      <div
                        key={`${sid}_${idx}`}
                        className={cls(
                          'rounded-xl border p-3 text-sm',
                          isToday
                            ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-50'
                            : 'border-white/10 bg-black/10 text-white/75'
                        )}
                      >
                        Day {idx + 1}: {s?.name || sid}
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
                  <div className="mt-1 text-base font-semibold text-white/90">
                    Day {dayIndex + 1}: {currentSkill?.name || '—'}
                  </div>
                  <div className="mt-1 text-sm text-white/65">{currentSkill?.blurb}</div>
                </div>
                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/75 hover:bg-white/10"
                  type="button"
                  onClick={() => setView('result')}
                >
                  返回
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="text-xs tracking-widest text-white/50">CONCEPT</div>
                <div className="mt-2 text-sm leading-relaxed text-white/80">
                  先用 1 句話抓重點：把這個技能點的「定義」與「公式/關係式」背成一句話，然後用 8–12 題快速驗證。
                </div>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4 text-sm text-white/75">
                  MVP Demo：這裡之後會放「概念卡」內容（1–2 張）+ 範例。
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="text-xs tracking-widest text-white/50">PRACTICE</div>
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
    </div>
  );
}
