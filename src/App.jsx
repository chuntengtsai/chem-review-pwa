import { useCallback, useEffect, useMemo, useState } from 'react';
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

function storageGet(key) {
  try {
    // localStorage can throw in some privacy modes / if disabled
    return window?.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window?.localStorage?.setItem(key, value);
  } catch {
    // ignore write failures (quota, disabled storage)
  }
}

function storageRemove(key) {
  try {
    window?.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}

async function copyToClipboard(text) {
  try {
    await navigator?.clipboard?.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / stricter permissions.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }
}

function loadPersistedState() {
  const raw = storageGet(STORAGE_KEY);
  if (!raw) return null;
  const s = safeParse(raw, null);
  if (!s || typeof s !== 'object') return null;
  return s;
}

export default function App() {
  const [view, setView] = useState('home'); // home|diagnostic|result|task
  const [diagIndex, setDiagIndex] = useState(0);

  // diagnostic UX
  const [autoNext, setAutoNext] = useState(() => {
    const s = loadPersistedState();
    return typeof s?.autoNext === 'boolean' ? s.autoNext : true;
  });

  // practice: revealed answers per question id
  const [revealed, setRevealed] = useState(() => {
    const s = loadPersistedState();
    return s?.revealed && typeof s.revealed === 'object' ? s.revealed : {};
  });

  const [answers, setAnswers] = useState(() => {
    const s = loadPersistedState();
    return s?.answers && typeof s.answers === 'object' ? s.answers : {};
  });

  const [plan, setPlan] = useState(() => {
    const s = loadPersistedState();
    return Array.isArray(s?.plan) ? s.plan : [];
  }); // skillIds

  const [dayIndex, setDayIndex] = useState(() => {
    const s = loadPersistedState();
    return typeof s?.dayIndex === 'number' ? s.dayIndex : 0;
  });

  // per day: { [dayIndex]: { conceptDone: boolean, practiceDone: boolean } }
  const [dayProgress, setDayProgress] = useState(() => {
    const s = loadPersistedState();
    return s?.dayProgress && typeof s.dayProgress === 'object' ? s.dayProgress : {};
  });

  // PWA install button (supported on Chromium-based browsers)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(() => {
    try {
      // iOS uses navigator.standalone; others use display-mode media query
      return Boolean(window?.navigator?.standalone) || window?.matchMedia?.('(display-mode: standalone)')?.matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    function updateStandalone() {
      try {
        setIsStandalone(Boolean(window?.navigator?.standalone) || window?.matchMedia?.('(display-mode: standalone)')?.matches);
      } catch {
        setIsStandalone(false);
      }
    }

    /** @param {Event} e */
    function onBeforeInstallPrompt(e) {
      // Prevent the mini-infobar from appearing.
      e.preventDefault();
      setDeferredInstallPrompt(e);
    }

    function onAppInstalled() {
      setDeferredInstallPrompt(null);
      updateStandalone();
    }

    updateStandalone();
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    // Some browsers update display-mode via media query changes.
    const mq = window?.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', updateStandalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      mq?.removeEventListener?.('change', updateStandalone);
    };
  }, []);

  async function requestInstall() {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent?.prompt) return;

    try {
      await promptEvent.prompt();
      // Some browsers expose userChoice; ignore if absent.
      await promptEvent.userChoice?.catch?.(() => null);
    } finally {
      // The prompt can only be used once.
      setDeferredInstallPrompt(null);
    }
  }

  // persist state
  useEffect(() => {
    const payload = {
      plan,
      dayIndex,
      answers,
      dayProgress,
      revealed,
      autoNext,
      savedAt: new Date().toISOString()
    };
    storageSet(STORAGE_KEY, JSON.stringify(payload));
  }, [plan, dayIndex, answers, dayProgress, revealed, autoNext]);

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

  const answeredCount = useMemo(() => Object.keys(answers || {}).length, [answers]);

  const stepState = useMemo(() => {
    const diagDone = plan.length > 0; // plan exists only after submit
    const inDiag = view === 'diagnostic';
    const inResult = view === 'result';
    const inTask = view === 'task';
    return {
      diag: diagDone ? 'done' : inDiag ? 'active' : answeredCount > 0 ? 'active' : 'todo',
      plan: diagDone ? (inResult ? 'active' : 'done') : 'todo',
      today: diagDone ? (inTask ? 'active' : 'todo') : 'todo'
    };
  }, [answeredCount, plan.length, view]);

  const todayDone = useMemo(() => {
    const p = dayProgress?.[dayIndex] || {};
    return Boolean(p.conceptDone && p.practiceDone);
  }, [dayProgress, dayIndex]);

  const chooseDiagnosticAnswer = useCallback(
    (qid, idx) => {
      setAnswers((p) => ({ ...p, [qid]: idx }));

      if (!autoNext) return;

      // advance after selection (small delay to show highlight)
      window.setTimeout(() => {
        setDiagIndex((i) => Math.min(allQuestions.length - 1, i + 1));
      }, 120);
    },
    [autoNext, allQuestions.length]
  );


  function startDiagnostic({ reset = false } = {}) {
    setView('diagnostic');

    if (reset) {
      setAnswers({});
      setDiagIndex(0);
      return;
    }

    // resume at first unanswered question (if any)
    const firstUnanswered = allQuestions.findIndex((q) => answers?.[q.id] === undefined);
    setDiagIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
  }

  const submitDiagnostic = useCallback(() => {
    // Guard: ensure the diagnostic is actually complete.
    const firstUnanswered = allQuestions.findIndex((q) => answers?.[q.id] === undefined);
    if (firstUnanswered >= 0) {
      window.alert(`你還有題目沒作答（第 ${firstUnanswered + 1} 題）。先完成診斷再產生路徑。`);
      setDiagIndex(firstUnanswered);
      return;
    }

    const newPlan = pickPlan(perSkill, 7);
    setPlan(newPlan);
    setDayIndex(0);
    setView('result');
  }, [allQuestions, answers, perSkill]);
  // Keyboard shortcuts (desktop-friendly):
  // - 1-4 or A-D: choose option
  // - ←/→: prev/next (→ requires current answered)
  // - Enter: next/submit
  useEffect(() => {
    if (view !== 'diagnostic') return;

    function onKeyDown(e) {
      // avoid interfering with browser/OS shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const q = currentQ;
      if (!q) return;

      const choicesLen = Array.isArray(q.choices) ? q.choices.length : 0;
      const k = String(e.key || '').toLowerCase();

      // A-D
      if (k.length === 1 && k >= 'a' && k <= 'd') {
        const idx = k.charCodeAt(0) - 'a'.charCodeAt(0);
        if (idx >= 0 && idx < choicesLen) {
          e.preventDefault();
          chooseDiagnosticAnswer(q.id, idx);
        }
        return;
      }

      // 1-4
      if (k.length === 1 && k >= '1' && k <= '4') {
        const idx = Number(k) - 1;
        if (idx >= 0 && idx < choicesLen) {
          e.preventDefault();
          chooseDiagnosticAnswer(q.id, idx);
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setDiagIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (e.key === 'ArrowRight') {
        if (answers?.[q.id] === undefined) return;
        e.preventDefault();
        setDiagIndex((i) => Math.min(allQuestions.length - 1, i + 1));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (diagIndex < allQuestions.length - 1) {
          if (answers?.[q.id] === undefined) return;
          setDiagIndex((i) => Math.min(allQuestions.length - 1, i + 1));
        } else {
          submitDiagnostic();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, currentQ, answers, diagIndex, allQuestions.length, chooseDiagnosticAnswer, submitDiagnostic]);

  function goTodayTask() {
    setView('task');
  }

  async function exportProgress() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      plan,
      dayIndex,
      answers,
      dayProgress,
      revealed,
      autoNext
    };
    const text = JSON.stringify(payload, null, 2);
    const ok = await copyToClipboard(text);
    if (!ok) {
      window.prompt('你的瀏覽器不允許自動複製。請手動複製以下文字：', text);
    } else {
      window.alert('已複製進度 JSON 到剪貼簿。');
    }
  }

  function importProgress() {
    const raw = window.prompt('貼上先前匯出的進度 JSON（會覆蓋目前進度）');
    if (!raw) return;

    const parsed = safeParse(raw, null);
    if (!parsed || typeof parsed !== 'object') {
      window.alert('格式不正確：不是 JSON 物件');
      return;
    }

    // Minimal validation (keep it permissive)
    const nextPlan = Array.isArray(parsed.plan) ? parsed.plan : null;
    const nextDayIndex = typeof parsed.dayIndex === 'number' ? parsed.dayIndex : 0;
    const nextAnswers = parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {};
    const nextDayProgress = parsed.dayProgress && typeof parsed.dayProgress === 'object' ? parsed.dayProgress : {};
    const nextRevealed = parsed.revealed && typeof parsed.revealed === 'object' ? parsed.revealed : {};
    const nextAutoNext = typeof parsed.autoNext === 'boolean' ? parsed.autoNext : true;

    if (!nextPlan) {
      window.alert('格式不正確：plan 必須是陣列');
      return;
    }

    setPlan(nextPlan);
    setDayIndex(Math.max(0, Math.min(nextPlan.length - 1, nextDayIndex)));
    setAnswers(nextAnswers);
    setDayProgress(nextDayProgress);
    setRevealed(nextRevealed);
    setAutoNext(nextAutoNext);

    // Persist immediately
    storageSet(
      STORAGE_KEY,
      JSON.stringify({
        plan: nextPlan,
        dayIndex: nextDayIndex,
        answers: nextAnswers,
        dayProgress: nextDayProgress,
        revealed: nextRevealed,
        autoNext: nextAutoNext,
        savedAt: new Date().toISOString()
      })
    );

    setView(nextPlan.length > 0 ? 'result' : 'home');
    window.alert('已匯入進度。');
  }

  function resetProgress() {
    // keep minimal: clear persisted state + reset in-memory state
    const ok = window.confirm('確定要重置進度？這會清除你的診斷結果與 7 日路徑。');
    if (!ok) return;
    storageRemove(STORAGE_KEY);
    setView('home');
    setDiagIndex(0);
    setAnswers({});
    setPlan([]);
    setDayIndex(0);
    setDayProgress({});
    setRevealed({});
    setAutoNext(true);
  }

  const buildLabel = useMemo(() => formatBuildTime(BUILD_TIME), []);

  const practiceQs = useMemo(() => getPracticeQuestionsForSkill(currentSkill?.id || ''), [currentSkill?.id]);
  const allPracticeRevealed = useMemo(() => practiceQs.length > 0 && practiceQs.every((q) => Boolean(revealed?.[q.id])), [practiceQs, revealed]);

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
                  {plan.length === 0 && answeredCount > 0 ? (
                    <>
                      <button
                        className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                        type="button"
                        onClick={() => startDiagnostic()}
                      >
                        繼續診斷（已答 {answeredCount} 題）
                      </button>
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={() => startDiagnostic({ reset: true })}
                      >
                        重新開始
                      </button>
                    </>
                  ) : (
                    <button
                      className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                      type="button"
                      onClick={() => startDiagnostic({ reset: true })}
                    >
                      開始診斷
                    </button>
                  )}

                  {!isStandalone && deferredInstallPrompt ? (
                    <button
                      className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-50 hover:bg-emerald-500/15"
                      type="button"
                      onClick={requestInstall}
                      title="把 App 安裝到主畫面（支援的瀏覽器才會出現）"
                    >
                      安裝 App
                    </button>
                  ) : null}

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
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={exportProgress}
                        title="把進度匯出成 JSON（可備份/換裝置）"
                      >
                        匯出進度
                      </button>
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={importProgress}
                        title="從 JSON 匯入進度（會覆蓋目前進度）"
                      >
                        匯入進度
                      </button>
                      <button
                        className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/15"
                        type="button"
                        onClick={resetProgress}
                      >
                        重置進度
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
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/55">
                <span>
                  題目 {diagIndex + 1} / {allQuestions.length} · 已作答 {answeredCount} / {allQuestions.length}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    className={cls(
                      'rounded-lg border px-3 py-1.5 text-xs hover:bg-white/10',
                      autoNext ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-50' : 'border-white/10 bg-white/5 text-white/75'
                    )}
                    type="button"
                    onClick={() => setAutoNext((v) => !v)}
                    title="選完答案自動跳到下一題"
                  >
                    自動下一題：{autoNext ? '開' : '關'}
                  </button>

                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                    type="button"
                    onClick={() => setView('home')}
                  >
                    退出
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-white/60">
                  <span>技能點：</span>
                  <Badge tone="info">{SKILLS.find((s) => s.id === currentQ?.skillId)?.name || currentQ?.skillId || '—'}</Badge>
                </div>
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
                        onClick={() => chooseDiagnosticAnswer(currentQ.id, idx)}
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
                設計目標：診斷題要能定位「技能點弱項」。MVP 先用每技能點 2 題做示範。小技巧：可用 1–4 或 A–D 作答、←/→ 換題、Enter 下一題。
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
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                      type="button"
                      onClick={goTodayTask}
                    >
                      進入今日任務
                    </button>
                    <button
                      className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/15"
                      type="button"
                      onClick={resetProgress}
                    >
                      重置進度
                    </button>
                  </div>
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
                      <button
                        key={`${sid}_${idx}`}
                        type="button"
                        className={cls(
                          'w-full text-left rounded-xl border p-3 text-sm hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-cyan-400/40',
                          isToday
                            ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-50'
                            : done
                              ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50'
                              : 'border-white/10 bg-black/10 text-white/75'
                        )}
                        onClick={() => {
                          setDayIndex(idx);
                          setView('task');
                        }}
                        aria-label={`前往 Day ${idx + 1}: ${s?.name || sid}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            Day {idx + 1}: {s?.name || sid}
                          </div>
                          {done ? <Badge tone="good">已完成</Badge> : isToday ? <Badge tone="info">今天</Badge> : <Badge>未開始</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-white/45">點一下可直接進入該天任務</div>
                      </button>
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
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-white/65">MVP Demo：暫用診斷題當練習題（之後每技能點會有 10 題練習）。</div>
                  {practiceQs.length > 0 ? (
                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() =>
                        setRevealed((p) => {
                          const next = { ...(p || {}) };
                          for (const q of practiceQs) next[q.id] = !allPracticeRevealed;
                          return next;
                        })
                      }
                    >
                      {allPracticeRevealed ? '全部隱藏' : '全部顯示'}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2">
                  {practiceQs.map((q) => {
                    const isRevealed = Boolean(revealed?.[q.id]);
                    return (
                      <div key={q.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-semibold text-white/90">{q.stem}</div>
                          <button
                            className={cls(
                              'shrink-0 rounded-lg border px-3 py-1.5 text-xs',
                              isRevealed
                                ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50 hover:bg-emerald-500/15'
                                : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10'
                            )}
                            type="button"
                            onClick={() => setRevealed((p) => ({ ...p, [q.id]: !p?.[q.id] }))}
                          >
                            {isRevealed ? '隱藏答案' : '顯示答案'}
                          </button>
                        </div>

                        {isRevealed ? (
                          <div className="mt-2 text-xs text-white/55">
                            答案：{String.fromCharCode(65 + q.answer)} · {q.explanation}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-white/45">先自己做 30–60 秒，再按「顯示答案」對答案與錯因。</div>
                        )}
                      </div>
                    );
                  })}
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
