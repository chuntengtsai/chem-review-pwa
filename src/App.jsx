import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SKILLS, getAllDiagnosticQuestions, getPracticeQuestionsForSkill } from './content/skills.js';

// eslint-disable-next-line no-undef
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
// eslint-disable-next-line no-undef
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

function formatBuildTime(iso) {
  if (!iso) return '';
  return formatLocalTime(iso);
}

function formatLocalTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      // Prefer 24-hour time to avoid 上午/下午 ambiguity in tiny badges/exports.
      hourCycle: 'h23'
    });
    return fmt.format(d);
  } catch {
    return String(iso);
  }
}

function cls(...xs) {
  return xs.filter(Boolean).join(' ');
}

function safeDomId(x) {
  return String(x || '').replace(/[^a-zA-Z0-9_-]/g, '_');
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
    const total = qs.length;
    if (total === 0) {
      perSkill[s.id] = { correct: 0, answered: 0, total: 0, mastery: 0 };
      continue;
    }

    let correct = 0;
    let answered = 0;
    for (const q of qs) {
      const a = answersByQid[q.id];
      if (a === undefined) continue;
      answered += 1;
      if (a === q.answer) correct += 1;
    }

    // Use answered questions as denominator so partial diagnostics don't look artificially low.
    const mastery = answered > 0 ? Math.round((correct / answered) * 100) : 0;
    perSkill[s.id] = { correct, answered, total, mastery };
  }
  return perSkill;
}

function pickPlan(perSkill, days = 7) {
  const ranked = Object.entries(perSkill)
    .map(([skillId, v]) => ({ skillId, mastery: v.mastery }))
    .sort((a, b) => a.mastery - b.mastery);

  // Simple: rotate through weakest skills.
  // Guard: if we somehow have no skills, return an empty plan instead of [undefined...].
  if (!ranked.length) return [];

  const plan = [];
  for (let i = 0; i < days; i++) {
    plan.push(ranked[i % ranked.length].skillId);
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

async function tryNativeShare({ title, text }) {
  try {
    // Mobile-friendly share sheet (iOS/Android). Requires a user gesture.
    if (!navigator?.share) return false;
    await navigator.share({ title, text });
    return true;
  } catch {
    return false;
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

function downloadText({ filename, text }) {
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
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

  const importFileRef = useRef(null);
  const didAutoJumpToNextIncompleteRef = useRef(false);
  const skipNextPersistRef = useRef(false);

  // diagnostic UX
  const [autoNext, setAutoNext] = useState(() => {
    const s = loadPersistedState();
    return typeof s?.autoNext === 'boolean' ? s.autoNext : true;
  });

  // tiny "autosave" indicator (helps users trust that progress won't vanish)
  const [savedAt, setSavedAt] = useState(() => {
    const s = loadPersistedState();
    return typeof s?.savedAt === 'string' ? s.savedAt : '';
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

  // iOS Safari doesn't support `beforeinstallprompt`.
  // Detect iOS so we can show a tiny "Add to Home Screen" hint.
  const [isIOS] = useState(() => {
    try {
      const ua = String(navigator?.userAgent || '');
      const isAppleTouch = /iPad|iPhone|iPod/.test(ua);
      const isIpadOS13Plus = ua.includes('Macintosh') && Boolean(navigator?.maxTouchPoints) && navigator.maxTouchPoints > 1;
      return Boolean(isAppleTouch || isIpadOS13Plus);
    } catch {
      return false;
    }
  });

  // PWA update hints
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const updateSWRef = useRef(null);

  // Network status (useful for PWA/offline usage)
  const [isOnline, setIsOnline] = useState(() => {
    try {
      return typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true;
    } catch {
      return true;
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

    function updateOnline() {
      try {
        setIsOnline(typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true);
      } catch {
        setIsOnline(true);
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
    updateOnline();
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    // Some browsers update display-mode via media query changes.
    const mq = window?.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', updateStandalone);

    function onNeedRefresh(e) {
      // event: CustomEvent<{ updateSW: (reloadPage?: boolean) => Promise<void> }>
      try {
        updateSWRef.current = e?.detail?.updateSW || null;
      } catch {
        updateSWRef.current = null;
      }
      setNeedRefresh(true);
    }

    function onOfflineReady() {
      setOfflineReady(true);
      // auto-hide after a bit (keep it subtle)
      window.setTimeout?.(() => setOfflineReady(false), 3500);
    }

    window.addEventListener('pwa:need-refresh', onNeedRefresh);
    window.addEventListener('pwa:offline-ready', onOfflineReady);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      mq?.removeEventListener?.('change', updateStandalone);
      window.removeEventListener('pwa:need-refresh', onNeedRefresh);
      window.removeEventListener('pwa:offline-ready', onOfflineReady);
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
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

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
    setSavedAt(payload.savedAt);
  }, [plan, dayIndex, answers, dayProgress, revealed, autoNext]);

  const allQuestions = useMemo(() => getAllDiagnosticQuestions(), []);

  const perSkill = useMemo(() => computeMastery(SKILLS, answers), [answers]);
  const weakTop3 = useMemo(() => {
    const xs = Object.entries(perSkill)
      .map(([skillId, v]) => ({
        skillId,
        mastery: v.mastery,
        correct: v.correct,
        answered: v.answered,
        total: v.total
      }))
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
  const answeredPct = useMemo(() => {
    if (!allQuestions.length) return 0;
    return Math.round((answeredCount / allQuestions.length) * 100);
  }, [answeredCount, allQuestions.length]);

  const firstUnansweredIndex = useMemo(() => {
    if (!allQuestions.length) return -1;
    return allQuestions.findIndex((q) => answers?.[q.id] === undefined);
  }, [allQuestions, answers]);

  const unansweredCount = useMemo(() => {
    if (!allQuestions.length) return 0;
    let n = 0;
    for (const q of allQuestions) if (answers?.[q.id] === undefined) n += 1;
    return n;
  }, [allQuestions, answers]);

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

  const completedDays = useMemo(() => {
    const total = plan.length || 0;
    if (!total) return 0;
    let done = 0;
    for (let i = 0; i < total; i++) {
      const p = dayProgress?.[i] || {};
      if (p.conceptDone && p.practiceDone) done += 1;
    }
    return done;
  }, [plan.length, dayProgress]);

  const completedPctPlan = useMemo(() => {
    const total = plan.length || 0;
    if (!total) return 0;
    return Math.round((completedDays / total) * 100);
  }, [completedDays, plan.length]);

  const nextIncompleteDay = useMemo(() => {
    const total = plan.length || 0;
    if (!total) return null;
    for (let i = 0; i < total; i++) {
      const p = dayProgress?.[i] || {};
      if (!(p.conceptDone && p.practiceDone)) return i;
    }
    return null;
  }, [plan.length, dayProgress]);

  // Small QoL: if the user previously left the app on a completed day,
  // snap "today" to the next incomplete day when the app loads.
  useEffect(() => {
    if (didAutoJumpToNextIncompleteRef.current) return;
    if (!plan?.length) return;
    if (nextIncompleteDay === null) return;

    const cur = dayProgress?.[dayIndex] || {};
    const curDone = Boolean(cur.conceptDone && cur.practiceDone);
    if (curDone && nextIncompleteDay !== dayIndex) {
      didAutoJumpToNextIncompleteRef.current = true;
      setDayIndex(nextIncompleteDay);
      return;
    }

    // Mark as checked so we don't fight the user's navigation.
    didAutoJumpToNextIncompleteRef.current = true;
  }, [plan?.length, nextIncompleteDay, dayIndex, dayProgress]);

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
    if (!newPlan.length) {
      window.alert('目前無法產生路徑：找不到任何技能點。請重新整理或更新題庫設定。');
      return;
    }
    setPlan(newPlan);
    setDayIndex(0);
    // Ensure a clean slate for the new 7-day path (avoid carrying over any old progress/reveals).
    setDayProgress({});
    setRevealed({});
    setView('result');
  }, [allQuestions, answers, perSkill]);

  const regeneratePlan = useCallback(() => {
    if (!plan?.length) return;
    const ok = window.confirm('要用目前的診斷結果重新產生 7 日路徑嗎？（會重置路徑進度）');
    if (!ok) return;
    const newPlan = pickPlan(perSkill, 7);
    setPlan(newPlan);
    setDayIndex(0);
    setDayProgress({});
    setRevealed({});
    setView('result');
  }, [plan?.length, perSkill]);

  const chooseDiagnosticAnswer = useCallback(
    (qid, idx, atIndex) => {
      setAnswers((p) => ({ ...p, [qid]: idx }));

      if (!autoNext) return;

      // advance after selection (small delay to show highlight)
      window.setTimeout(() => {
        const isLast = Number(atIndex) >= allQuestions.length - 1;
        if (isLast) {
          submitDiagnostic();
          return;
        }
        setDiagIndex((i) => Math.min(allQuestions.length - 1, i + 1));
      }, 120);
    },
    [autoNext, allQuestions.length, submitDiagnostic]
  );

  // Small UX: when switching views, scroll to top so users don't get "stuck" mid-page.
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // ignore
    }
  }, [view]);

  // When browsing different days in the task view, snap back to the concept section.
  useEffect(() => {
    if (view !== 'task') return;
    try {
      document.getElementById('concept')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      // ignore
    }
  }, [view, dayIndex]);

  // Keyboard shortcuts (desktop-friendly):
  // - 1-4 or A-D: choose option
  // - ←/→: prev/next (→ requires current answered)
  // - Enter: next/submit
  useEffect(() => {
    if (view !== 'diagnostic') return;

    function onKeyDown(e) {
      // avoid interfering with browser/OS shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // don't hijack keystrokes when user is typing in a form element
      const t = e.target;
      const tag = String(t?.tagName || '').toUpperCase();
      if (t?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const q = currentQ;
      if (!q) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setView('home');
        return;
      }

      const choicesLen = Array.isArray(q.choices) ? q.choices.length : 0;
      const k = String(e.key || '').toLowerCase();

      // A-D
      if (k.length === 1 && k >= 'a' && k <= 'd') {
        const idx = k.charCodeAt(0) - 'a'.charCodeAt(0);
        if (idx >= 0 && idx < choicesLen) {
          e.preventDefault();
          chooseDiagnosticAnswer(q.id, idx, diagIndex);
        }
        return;
      }

      // 1-4
      if (k.length === 1 && k >= '1' && k <= '4') {
        const idx = Number(k) - 1;
        if (idx >= 0 && idx < choicesLen) {
          e.preventDefault();
          chooseDiagnosticAnswer(q.id, idx, diagIndex);
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

  function buildShareSummary() {
    const lines = [];
    lines.push('高一化學覆習（診斷 → 補洞）進度摘要');
    lines.push(`匯出時間（台北）：${formatLocalTime(new Date().toISOString())}`);
    const deployedAt = formatBuildTime(BUILD_TIME);
    if (deployedAt) lines.push(`最後部署：${deployedAt}`);
    if (APP_VERSION) lines.push(`版本：v${APP_VERSION}`);

    if (!plan?.length) {
      lines.push('尚未產生 7 日路徑（請先完成診斷）。');
      return lines.join('\n');
    }

    const ranked = Object.entries(perSkill)
      .map(([skillId, v]) => ({
        skillId,
        mastery: v.mastery,
        correct: v.correct,
        answered: v.answered,
        total: v.total
      }))
      .sort((a, b) => a.mastery - b.mastery);

    const topWeak = ranked.slice(0, 3);
    lines.push('');
    lines.push('弱點 Top 3：');
    for (const w of topWeak) {
      const s = SKILLS.find((x) => x.id === w.skillId);
      const denom = w.answered ?? 0;
      const suffix = denom > 0 ? `${w.correct}/${denom}` : `0/0`;
      lines.push(`- ${s?.name || w.skillId}: ${w.mastery}%（${suffix}，共 ${w.total} 題）`);
    }

    lines.push('');
    lines.push(`7 日路徑進度：已完成 ${completedDays}/${plan.length} 天`);

    const todaySid = plan?.[dayIndex];
    const todaySkill = SKILLS.find((x) => x.id === todaySid);
    const todayP = dayProgress?.[dayIndex] || {};
    const todayIsDone = Boolean(todayP.conceptDone && todayP.practiceDone);
    lines.push(`今天：Day ${dayIndex + 1} ${todaySkill?.name || todaySid || '—'} ${todayIsDone ? '✅' : '⬜'}`);

    if (nextIncompleteDay !== null) {
      lines.push(`下一個未完成：Day ${nextIncompleteDay + 1}`);
    }

    lines.push('');
    lines.push('路徑：');
    for (let i = 0; i < plan.length; i++) {
      const sid = plan[i];
      const s = SKILLS.find((x) => x.id === sid);
      const p = dayProgress?.[i] || {};
      const done = Boolean(p.conceptDone && p.practiceDone);
      const tag = done ? '✅' : i === dayIndex ? '🟦' : '⬜';
      lines.push(`- Day ${i + 1}: ${s?.name || sid} ${tag}`);
    }

    return lines.join('\n');
  }

  async function exportProgress() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION || undefined,
      buildTime: BUILD_TIME || undefined,
      plan,
      dayIndex,
      answers,
      dayProgress,
      revealed,
      autoNext
    };
    const text = JSON.stringify(payload, null, 2);

    // Prefer native share sheet on mobile; fall back to clipboard / download.
    const shared = await tryNativeShare({ title: '化學覆習進度（JSON）', text });
    if (shared) return;

    const ok = await copyToClipboard(text);
    if (ok) {
      window.alert('已複製進度 JSON 到剪貼簿。');
      return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const downloaded = downloadText({ filename: `chem-review-progress_${ts}.json`, text });
    if (downloaded) {
      window.alert('你的瀏覽器不允許自動複製。我已改用「下載檔案」備份進度（JSON）。');
      return;
    }

    window.prompt('你的瀏覽器不允許自動複製/下載。請手動複製以下文字：', text);
  }

  async function exportShareSummary() {
    const text = buildShareSummary();

    // Prefer native share sheet on mobile; fall back to clipboard / download.
    const shared = await tryNativeShare({ title: '化學覆習進度摘要', text });
    if (shared) return;

    const ok = await copyToClipboard(text);
    if (ok) {
      window.alert('已複製摘要到剪貼簿。');
      return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const downloaded = downloadText({ filename: `chem-review-summary_${ts}.txt`, text });
    if (downloaded) {
      window.alert('你的瀏覽器不允許自動複製。我已改用「下載檔案」匯出摘要（txt）。');
      return;
    }

    window.prompt('你的瀏覽器不允許自動複製/下載。請手動複製以下文字：', text);
  }

  function applyImportedProgress(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      window.alert('格式不正確：不是 JSON 物件');
      return false;
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
      return false;
    }

    const clampedDayIndex = Math.max(0, Math.min(nextPlan.length - 1, nextDayIndex));

    setPlan(nextPlan);
    setDayIndex(clampedDayIndex);
    setAnswers(nextAnswers);
    setDayProgress(nextDayProgress);
    setRevealed(nextRevealed);
    setAutoNext(nextAutoNext);

    // Persist immediately (keep storage consistent with the clamped in-memory state)
    storageSet(
      STORAGE_KEY,
      JSON.stringify({
        plan: nextPlan,
        dayIndex: clampedDayIndex,
        answers: nextAnswers,
        dayProgress: nextDayProgress,
        revealed: nextRevealed,
        autoNext: nextAutoNext,
        savedAt: new Date().toISOString()
      })
    );

    setView(nextPlan.length > 0 ? 'result' : 'home');
    return true;
  }

  function importProgress() {
    const raw = window.prompt('貼上先前匯出的進度 JSON（會覆蓋目前進度）');
    if (!raw) return;

    const confirmOverwrite = window.confirm('要用匯入的進度覆蓋目前進度嗎？（此操作無法復原）');
    if (!confirmOverwrite) return;

    const parsed = safeParse(raw, null);
    const ok = applyImportedProgress(parsed);
    if (ok) window.alert('已匯入進度。');
  }

  function triggerImportFile() {
    try {
      importFileRef.current?.click?.();
    } catch {
      // ignore
    }
  }

  async function importProgressFromFile(e) {
    try {
      const file = e?.target?.files?.[0];
      if (!file) return;

      const confirmOverwrite = window.confirm(
        `要用「${file.name}」的進度覆蓋目前進度嗎？（此操作無法復原）`
      );
      if (!confirmOverwrite) return;

      const text = await file.text();
      const parsed = safeParse(text, null);
      const ok = applyImportedProgress(parsed);
      if (ok) window.alert('已從檔案匯入進度。');
    } catch {
      window.alert('匯入失敗：請確認檔案是先前匯出的 JSON。');
    } finally {
      // allow re-selecting the same file
      try {
        if (e?.target) e.target.value = '';
      } catch {
        // ignore
      }
    }
  }

  function resetProgress() {
    // keep minimal: clear persisted state + reset in-memory state
    const ok = window.confirm('確定要重置進度？這會清除你的診斷結果與 7 日路徑。');
    if (!ok) return;

    // Prevent the reactive "persist" effect from immediately re-writing an empty state
    // right after we remove localStorage (so reset truly clears).
    skipNextPersistRef.current = true;

    storageRemove(STORAGE_KEY);
    setSavedAt('');
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

  // If a skill has 0 practice questions (e.g., during MVP expansion), don't block users from marking practice as done.
  // Treat "all revealed" as true when there is nothing to reveal.
  const allPracticeRevealed = useMemo(() => practiceQs.every((q) => Boolean(revealed?.[q.id])), [practiceQs, revealed]);
  const practiceRevealedCount = useMemo(() => practiceQs.filter((q) => Boolean(revealed?.[q.id])).length, [practiceQs, revealed]);

  const firstUnrevealedPractice = useMemo(() => practiceQs.find((q) => !revealed?.[q.id]) || null, [practiceQs, revealed]);

  return (
    <div className="min-h-screen">
      <input
        ref={importFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={importProgressFromFile}
      />

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
            {!isOnline ? <Badge tone="warn">離線</Badge> : null}
            {savedAt ? <Badge tone="neutral">已儲存 {formatLocalTime(savedAt)}</Badge> : null}
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
              {plan.length > 0 && nextIncompleteDay !== null ? (
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-4">
                  <div className="text-xs tracking-widest text-emerald-100/80">CONTINUE</div>
                  <div className="mt-2 text-sm text-emerald-50/90">
                    你還有未完成的任務：Day {nextIncompleteDay + 1}。
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border border-emerald-300/20 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-50 hover:bg-emerald-500/20"
                      type="button"
                      onClick={() => {
                        setDayIndex(nextIncompleteDay);
                        setView('task');
                      }}
                    >
                      繼續下一個未完成
                    </button>
                    <button
                      className="rounded-lg border border-emerald-300/20 bg-black/10 px-4 py-2 text-sm text-emerald-50/90 hover:bg-black/20"
                      type="button"
                      onClick={() => setView('result')}
                    >
                      看路徑總覽
                    </button>
                  </div>
                </div>
              ) : null}

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
                  ) : !isStandalone && isIOS ? (
                    <button
                      className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-50 hover:bg-emerald-500/15"
                      type="button"
                      onClick={() => {
                        window.alert(
                          'iPhone/iPad 安裝方式：\n1) 用 Safari 開啟本頁\n2) 點「分享」按鈕\n3) 選「加入主畫面」\n\n（iOS Safari 目前不支援自動跳出安裝提示，所以這裡改用提示說明。）'
                        );
                      }}
                      title="iOS Safari 不支援自動安裝提示；點這裡看加入主畫面的方式"
                    >
                      加入主畫面（iOS）
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
                        onClick={exportShareSummary}
                        title="把弱點 Top 3 + 7 日路徑摘要複製到剪貼簿（可分享給老師/同學）"
                      >
                        匯出摘要
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
                        title="貼上 JSON 匯入進度（會覆蓋目前進度）"
                      >
                        匯入進度
                      </button>
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={triggerImportFile}
                        title="從先前匯出的 JSON 檔案匯入進度（會覆蓋目前進度）"
                      >
                        從檔案匯入
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
                MVP 註：目前題庫是示範（{SKILLS.length} 個技能點、診斷共 {allQuestions.length} 題）。接下來會擴到 12 個技能點、至少 145 題（25 診斷 + 120 補洞）。
              </div>
            </div>
          ) : null}

          {view === 'diagnostic' ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/55">
                <span>
                  題目 {diagIndex + 1} / {allQuestions.length} · 已作答 {answeredCount} / {allQuestions.length}（{answeredPct}%）
                  {unansweredCount > 0 ? ` · 未答 ${unansweredCount}` : ''}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    className={cls(
                      'rounded-lg border px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-50',
                      'border-white/10 bg-white/5 text-white/75'
                    )}
                    type="button"
                    disabled={firstUnansweredIndex < 0}
                    onClick={() => {
                      if (firstUnansweredIndex >= 0) setDiagIndex(firstUnansweredIndex);
                    }}
                    title={firstUnansweredIndex < 0 ? '全部題目已作答' : '跳到第一個未作答的題目'}
                  >
                    跳到未答
                  </button>

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
                    className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-500/15"
                    type="button"
                    onClick={() => {
                      const ok = window.confirm('要重置診斷作答嗎？（會清除目前已作答的診斷答案）');
                      if (!ok) return;
                      startDiagnostic({ reset: true });
                    }}
                    title="清除目前診斷作答，從第 1 題重新開始"
                  >
                    重置診斷
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

              <div className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-black/10">
                <div className="h-full bg-cyan-400/40" style={{ width: `${answeredPct}%` }} />
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
                          'focus:outline-none focus:ring-2 focus:ring-cyan-400/40',
                          chosen
                            ? 'border-cyan-300/40 bg-cyan-500/10 text-cyan-50'
                            : 'border-white/10 bg-black/10 text-white/80 hover:bg-black/20'
                        )}
                        aria-pressed={chosen}
                        aria-label={`選擇 ${String.fromCharCode(65 + idx)}：${c}`}
                        onClick={() => chooseDiagnosticAnswer(currentQ.id, idx, diagIndex)}
                      >
                        {String.fromCharCode(65 + idx)}. {c}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
                    type="button"
                    disabled={diagIndex === 0}
                    onClick={() => setDiagIndex((i) => Math.max(0, i - 1))}
                  >
                    上一題
                  </button>

                  {diagIndex < allQuestions.length - 1 ? (
                    <button
                      className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
                      type="button"
                      disabled={answers[currentQ.id] === undefined}
                      onClick={() => setDiagIndex((i) => Math.min(allQuestions.length - 1, i + 1))}
                    >
                      下一題
                    </button>
                  ) : (
                    <button
                      className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      type="button"
                      onClick={submitDiagnostic}
                    >
                      送出診斷
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/10 p-4 text-xs text-white/55">
                設計目標：診斷題要能定位「技能點弱項」。MVP 先用每技能點 2 題做示範。小技巧：可用 1–4 或 A–D 作答、←/→ 換題、Enter 下一題、Esc 退出。
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
                            <div className="mt-2 text-xs text-white/55">
                              {w.answered > 0 ? `答對 ${w.correct}/${w.answered}（共 ${w.total} 題）` : `尚未作答（共 ${w.total} 題）`}
                            </div>
                          </div>
                          <Badge>{w.mastery}%</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-white/70">7 日補洞路徑（示範）：第 1 天從最弱技能點開始。</div>
                    {plan.length > 0 ? (
                      <div className="mt-1 grid gap-2">
                        <div className="text-xs text-white/55">
                          進度：已完成 {completedDays}/{plan.length} 天（{completedPctPlan}%）
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-black/10">
                          <div className="h-full bg-emerald-400/40" style={{ width: `${completedPctPlan}%` }} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border border-white/10 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                      type="button"
                      onClick={goTodayTask}
                    >
                      進入今日任務
                    </button>

                    {nextIncompleteDay !== null ? (
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={() => {
                          setDayIndex(nextIncompleteDay);
                          setView('task');
                        }}
                        title="跳到下一個未完成的 Day"
                      >
                        下一個未完成
                      </button>
                    ) : null}

                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={regeneratePlan}
                      title="用目前的診斷結果重新產生 7 日路徑（會重置路徑進度）"
                    >
                      重新產生路徑
                    </button>

                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={exportShareSummary}
                      title="把弱點 Top 3 + 7 日路徑摘要複製到剪貼簿（可分享給老師/同學）"
                    >
                      匯出摘要
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
                      title="貼上 JSON 匯入進度（會覆蓋目前進度）"
                    >
                      匯入進度
                    </button>

                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={triggerImportFile}
                      title="從先前匯出的 JSON 檔案匯入進度（會覆蓋目前進度）"
                    >
                      從檔案匯入
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

                    <button
                      className={cls(
                        'rounded-lg border px-3 py-1.5 text-xs hover:bg-white/10',
                        todayDone ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50' : 'border-white/10 bg-white/5 text-white/75'
                      )}
                      type="button"
                      onClick={() =>
                        setDayProgress((p) => ({
                          ...p,
                          [dayIndex]: {
                            ...(p?.[dayIndex] || {}),
                            conceptDone: !todayDone,
                            practiceDone: !todayDone
                          }
                        }))
                      }
                      title={todayDone ? '把今天標記回未完成' : '一鍵把概念與練習都標記為已完成'}
                    >
                      {todayDone ? '取消今日完成' : '一鍵完成今日'}
                    </button>

                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() => {
                        const ok = window.confirm('要重置「今天」的進度嗎？（會把概念/練習標記清掉，並把本日練習題答案改回未顯示）');
                        if (!ok) return;

                        setDayProgress((p) => ({
                          ...p,
                          [dayIndex]: { ...(p?.[dayIndex] || {}), conceptDone: false, practiceDone: false }
                        }));

                        setRevealed((p) => {
                          const next = { ...(p || {}) };
                          for (const q of practiceQs) next[q.id] = false;
                          return next;
                        });
                      }}
                      title="重置今天的概念/練習完成狀態，並把本日練習題答案全部改回未顯示"
                    >
                      重置今日
                    </button>

                    {nextIncompleteDay !== null && nextIncompleteDay !== dayIndex ? (
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={() => setDayIndex(nextIncompleteDay)}
                        title="跳到下一個未完成的 Day"
                      >
                        下一個未完成
                      </button>
                    ) : null}

                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={exportShareSummary}
                      title="把弱點 Top 3 + 7 日路徑摘要複製到剪貼簿（可分享給老師/同學）"
                    >
                      匯出摘要
                    </button>

                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={exportProgress}
                      title="把進度匯出成 JSON（可備份/換裝置）"
                    >
                      匯出進度
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
                      onClick={() => {
                        const cur = Boolean(dayProgress?.[dayIndex]?.practiceDone);
                        if (cur) {
                          setDayProgress((p) => ({
                            ...p,
                            [dayIndex]: { ...(p?.[dayIndex] || {}), practiceDone: false }
                          }));
                          return;
                        }

                        if (!allPracticeRevealed) {
                          window.alert('先把本日練習題答案都看過/對過（可用「全部顯示」），再標記完成。');
                          return;
                        }

                        setDayProgress((p) => ({
                          ...p,
                          [dayIndex]: { ...(p?.[dayIndex] || {}), practiceDone: true }
                        }));
                      }}
                      title={
                        dayProgress?.[dayIndex]?.practiceDone
                          ? '把練習標記回未完成'
                          : !allPracticeRevealed
                            ? '先把本日練習題答案都看過/對過（可用「全部顯示」），再標記完成'
                            : '把練習標記為完成'
                      }
                    >
                      標記
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="grid gap-1">
                    <div className="text-sm text-white/65">MVP Demo：暫用診斷題當練習題（之後每技能點會有 10 題練習）。</div>
                    {practiceQs.length > 0 ? (
                      <div className="text-xs text-white/50">已顯示答案 {practiceRevealedCount}/{practiceQs.length}</div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
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

                    {practiceQs.length > 0 ? (
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={() => {
                          const ok = window.confirm('要把本日練習題的「顯示答案」全部重置嗎？（也會把「練習完成」標記改回未完成）');
                          if (!ok) return;

                          setRevealed((p) => {
                            const next = { ...(p || {}) };
                            for (const q of practiceQs) next[q.id] = false;
                            return next;
                          });

                          setDayProgress((p) => ({
                            ...p,
                            [dayIndex]: { ...(p?.[dayIndex] || {}), practiceDone: false }
                          }));
                        }}
                        title="把本日練習題全部改回未顯示（方便重新自我測驗）"
                      >
                        重置本日練習
                      </button>
                    ) : null}

                    {firstUnrevealedPractice ? (
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={() => {
                          try {
                            document
                              .getElementById(`pq_${safeDomId(firstUnrevealedPractice.id)}`)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          } catch {
                            // ignore
                          }
                        }}
                        title="跳到第一題尚未顯示答案的練習題"
                      >
                        跳到未顯示
                      </button>
                    ) : null}

                    <button
                      className="rounded-lg border border-white/10 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-50 hover:bg-emerald-500/15 disabled:opacity-50"
                      type="button"
                      disabled={!allPracticeRevealed || Boolean(dayProgress?.[dayIndex]?.practiceDone)}
                      onClick={() =>
                        setDayProgress((p) => ({
                          ...p,
                          [dayIndex]: { ...(p?.[dayIndex] || {}), practiceDone: true }
                        }))
                      }
                      title={!allPracticeRevealed ? '先把本日練習題答案都看過/對過，再標記完成' : '把練習標記為完成'}
                    >
                      練習完成
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {practiceQs.map((q) => {
                    const isRevealed = Boolean(revealed?.[q.id]);
                    return (
                      <div id={`pq_${safeDomId(q.id)}`} key={q.id} className="rounded-xl border border-white/10 bg-black/10 p-4">
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
                          <div className="mt-2 grid gap-2 text-xs text-white/55">
                            <div>
                              答案：{String.fromCharCode(65 + q.answer)} · {q.explanation}
                            </div>

                            {Array.isArray(q?.wrongReasonTags) && q.wrongReasonTags.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1 text-white/50">
                                <span className="mr-1">常見錯因：</span>
                                {q.wrongReasonTags.map((t) => (
                                  <Badge key={t} tone="warn">
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
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

      {offlineReady && !needRefresh ? (
        <div className="fixed bottom-3 left-3 z-50 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-50/90 backdrop-blur">
          已可離線使用
        </div>
      ) : null}

      {needRefresh ? (
        <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-50/90 backdrop-blur">
          <span>有新版本可用</span>
          <button
            type="button"
            className="rounded-full border border-cyan-200/20 bg-cyan-500/20 px-2 py-0.5 text-[11px] text-cyan-50 hover:bg-cyan-500/30"
            onClick={async () => {
              try {
                const fn = updateSWRef.current;
                setNeedRefresh(false);
                await fn?.(true);
              } catch {
                // if update fails, keep the hint so user can try again
                setNeedRefresh(true);
              }
            }}
          >
            重新整理更新
          </button>
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
            onClick={() => setNeedRefresh(false)}
          >
            稍後
          </button>
        </div>
      ) : null}

      {buildLabel ? (
        <div className="fixed bottom-3 right-3 z-40 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-white/65 backdrop-blur">
          最後部署：{buildLabel}
          {APP_VERSION ? ` · v${APP_VERSION}` : ''}
        </div>
      ) : null}
    </div>
  );
}
