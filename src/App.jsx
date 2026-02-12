import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SKILLS, getAllDiagnosticQuestions, getPracticeQuestionsForSkill } from './content/skills.js';

const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
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

function formatFilenameTimestamp(d = new Date()) {
  // Use local time (Asia/Taipei) to generate filenames that are easier to find/compare on-device.
  // Include seconds to avoid collisions when exporting multiple times within the same minute.
  // Format: YYYYMMDD_HHmmss
  try {
    const parts = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(d)
      .reduce((acc, p) => {
        if (p.type && p.value) acc[p.type] = p.value;
        return acc;
      }, /** @type {Record<string,string>} */ ({}));

    const y = parts.year || '0000';
    const m = parts.month || '00';
    const day = parts.day || '00';
    const hh = parts.hour || '00';
    const mm = parts.minute || '00';
    const ss = parts.second || '00';

    return `${y}${m}${day}_${hh}${mm}${ss}`;
  } catch {
    // Fall back to ISO-ish (no colons) to keep filenames safe.
    // Use the provided date to keep callers deterministic (tests, replays).
    return d.toISOString().replace(/[:.]/g, '-');
  }
}

function cls(...xs) {
  return xs.filter(Boolean).join(' ');
}

function prefersReducedMotion() {
  try {
    return Boolean(window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

function scrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

function safeDomId(x) {
  return String(x || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Deterministic shuffle (for practice question order)
function hashStringToUint32(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledCopy(arr, seedStr) {
  const xs = Array.isArray(arr) ? [...arr] : [];
  if (xs.length <= 1) return xs;
  const rng = mulberry32(hashStringToUint32(seedStr));
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = xs[i];
    xs[i] = xs[j];
    xs[j] = tmp;
  }
  return xs;
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
  const allRanked = Object.entries(perSkill)
    .map(([skillId, v]) => ({ skillId, mastery: v.mastery, total: v.total ?? 0 }))
    .sort((a, b) => a.mastery - b.mastery);

  // Prefer skills that have at least 1 diagnostic question.
  // Otherwise "0%" can come from "no data" (total=0), which would incorrectly dominate the plan.
  const ranked = allRanked.filter((x) => (x.total ?? 0) > 0);

  // Simple: rotate through weakest skills.
  // Guard: if we somehow have no skills, return an empty plan instead of [undefined...].
  const pool = ranked.length ? ranked : allRanked;
  if (!pool.length) return [];

  const plan = [];
  for (let i = 0; i < days; i++) {
    plan.push(pool[i % pool.length].skillId);
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

// Some apps wrap shared JSON in extra text or code fences.
// Try to recover by stripping fences and extracting the first JSON object/array block.
function safeParsePossiblyWrappedJson(raw, fallback) {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;

  const direct = safeParse(s, null);
  if (direct !== null) return direct;

  // Strip common Markdown fences: ```json ... ```
  const unfenced = s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const unfencedDirect = safeParse(unfenced, null);
  if (unfencedDirect !== null) return unfencedDirect;

  // Last-chance recovery: find the first balanced {...} or [...] block.
  // This makes imports more tolerant to chat apps that prepend/append explanations.
  const text = unfenced;
  const openers = [
    { open: '{', close: '}' },
    { open: '[', close: ']' }
  ];

  for (const pair of openers) {
    const start = text.indexOf(pair.open);
    if (start < 0) continue;

    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === pair.open) depth += 1;
      else if (ch === pair.close) depth -= 1;

      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        const parsed = safeParse(slice, null);
        if (parsed !== null) return parsed;
        break;
      }

      // Avoid pathological scans on gigantic clipboard contents.
      if (i - start > 2_000_000) break;
    }
  }

  return fallback;
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
    return true;
  } catch {
    // ignore write failures (quota, disabled storage)
    return false;
  }
}

function storageRemove(key) {
  try {
    window?.localStorage?.removeItem(key);
    return true;
  } catch {
    // ignore
    return false;
  }
}

async function tryNativeShare({ title, text, filename, mimeType }) {
  try {
    // Mobile-friendly share sheet (iOS/Android). Requires a user gesture.
    if (!navigator?.share) return false;

    // Prefer sharing as a file when supported (avoids huge text payloads getting truncated by some targets).
    if (filename && typeof File !== 'undefined') {
      try {
        const file = new File([text], filename, { type: mimeType || 'text/plain;charset=utf-8' });
        const can = navigator?.canShare?.({ files: [file] });
        if (can) {
          await navigator.share({ title, files: [file] });
          return true;
        }
      } catch {
        // fall back to plain text share
      }
    }

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

      // iOS Safari is picky: focus + explicit selection range is more reliable than select() alone.
      ta.focus?.();
      ta.select();
      try {
        ta.setSelectionRange?.(0, ta.value.length);
      } catch {
        // ignore
      }

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
  // Read persisted state once on initial mount (avoids repeated localStorage reads/JSON parses).
  const persisted = useMemo(() => loadPersistedState(), []);

  const [view, setView] = useState('home'); // home|diagnostic|result|task
  const [diagIndex, setDiagIndex] = useState(0);

  const [showShortcuts, setShowShortcuts] = useState(false);

  // QoL: allow importing an exported progress JSON by drag & drop (desktop)
  const [dragImportActive, setDragImportActive] = useState(false);

  const importFileRef = useRef(null);
  const didAutoJumpToNextIncompleteRef = useRef(false);
  const skipNextPersistRef = useRef(false);

  // Keep global shortcut handlers fresh without re-registering listeners on every render.
  const shortcutFnsRef = useRef(
    /** @type {{ exportProgress?: Function, exportShareSummary?: Function, importProgressFromClipboard?: Function }} */ ({})
  );

  // Keep a stable seed basis so practice shuffles don't change just because we auto-save.
  const initialSavedAtRef = useRef(typeof persisted?.savedAt === 'string' ? persisted.savedAt : '');

  // diagnostic UX
  const [autoNext, setAutoNext] = useState(() => {
    const s = persisted;
    return typeof s?.autoNext === 'boolean' ? s.autoNext : true;
  });

  // practice UX
  const [shufflePractice, setShufflePractice] = useState(() => {
    const s = persisted;
    return typeof s?.shufflePractice === 'boolean' ? s.shufflePractice : false;
  });

  // tiny "autosave" indicator (helps users trust that progress won't vanish)
  const [savedAt, setSavedAt] = useState(() => {
    const s = persisted;
    return typeof s?.savedAt === 'string' ? s.savedAt : '';
  });

  // backup hygiene: track when the user last exported progress (JSON)
  const [lastExportedAt, setLastExportedAt] = useState(() => {
    const s = persisted;
    return typeof s?.lastExportedAt === 'string' ? s.lastExportedAt : '';
  });

  // localStorage might be disabled (Safari private mode / strict privacy settings).
  // Track whether we can actually persist so we can warn the user.
  // Default to true but probe on mount to give immediate feedback.
  const [storageWritable, setStorageWritable] = useState(true);

  // practice: revealed answers per question id
  const [revealed, setRevealed] = useState(() => {
    const s = persisted;
    return s?.revealed && typeof s.revealed === 'object' ? s.revealed : {};
  });

  const [answers, setAnswers] = useState(() => {
    const s = persisted;
    return s?.answers && typeof s.answers === 'object' ? s.answers : {};
  });

  const [plan, setPlan] = useState(() => {
    const s = persisted;
    return Array.isArray(s?.plan) ? s.plan : [];
  }); // skillIds

  const [dayIndex, setDayIndex] = useState(() => {
    const s = persisted;
    return typeof s?.dayIndex === 'number' ? s.dayIndex : 0;
  });

  // per day: { [dayIndex]: { conceptDone: boolean, practiceDone: boolean } }
  const [dayProgress, setDayProgress] = useState(() => {
    const s = persisted;
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
  const offlineReadyTimerRef = useRef(0);

  // Tiny QoL: allow copying version/build info (useful for bug reports)
  const [buildInfoCopied, setBuildInfoCopied] = useState(false);
  const buildInfoCopiedTimerRef = useRef(0);

  // Network status (useful for PWA/offline usage)
  const [isOnline, setIsOnline] = useState(() => {
    try {
      return typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true;
    } catch {
      return true;
    }
  });

  // Small UX: when the user goes offline then returns online, show a tiny confirmation toast.
  const [backOnline, setBackOnline] = useState(false);
  const prevOnlineRef = useRef(isOnline);
  const backOnlineTimerRef = useRef(0);

  // Small UX: show a floating "scroll to top" button on long pages.
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Small UX: non-blocking toast for common actions (copy/export/import).
  const [toast, setToast] = useState(null); // { msg: string, tone?: 'neutral'|'good'|'warn'|'info' }
  const toastTimerRef = useRef(0);
  const notify = useCallback((msg, tone = 'neutral', ms = 2200) => {
    try {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    } catch {
      // ignore
    }

    setToast({ msg: String(msg || ''), tone });

    try {
      toastTimerRef.current = window.setTimeout(() => setToast(null), ms);
    } catch {
      // ignore
    }
  }, []);


  useEffect(() => {
    return () => {
      try {
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      } catch {
        // ignore
      }

      try {
        if (buildInfoCopiedTimerRef.current) window.clearTimeout(buildInfoCopiedTimerRef.current);
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    // Probe storage availability early so we can warn immediately.
    // Some environments (e.g., Safari private mode) throw on localStorage writes.
    try {
      const probeKey = `${STORAGE_KEY}.__probe`;
      const ok = storageSet(probeKey, '1');
      if (ok) storageRemove(probeKey);
      setStorageWritable(ok);
    } catch {
      setStorageWritable(false);
    }

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

    function onStorage(e) {
      // Cross-tab sync: if the user has the app open in multiple tabs/windows,
      // keep progress consistent.
      // Note: the "storage" event does not fire on the same document that writes.
      try {
        if (!e || e.key !== STORAGE_KEY) return;

        // If state was cleared in another tab, reflect it here too.
        // (Example: user hits "重置進度" in another window.)
        if (e.newValue == null) {
          // Avoid immediately re-persisting an empty/default state.
          skipNextPersistRef.current = true;

          setSavedAt('');
          setLastExportedAt('');
          setView('home');
          setDiagIndex(0);
          setAnswers({});
          setPlan([]);
          setDayIndex(0);
          setDayProgress({});
          setRevealed({});
          setAutoNext(true);
          setShufflePractice(false);
          setStorageWritable(true);
          return;
        }

        const next = safeParse(String(e.newValue || ''), null);
        if (!next || typeof next !== 'object') return;

        // Avoid immediately re-persisting and re-stamping savedAt.
        skipNextPersistRef.current = true;

        const nextPlan = Array.isArray(next.plan) ? next.plan : [];
        const nextDayIndex = typeof next.dayIndex === 'number' ? next.dayIndex : 0;
        const clampedDayIndex = Math.max(0, Math.min(nextPlan.length - 1, nextDayIndex));

        setPlan(nextPlan);
        setDayIndex(clampedDayIndex);
        setAnswers(next.answers && typeof next.answers === 'object' ? next.answers : {});
        setDayProgress(next.dayProgress && typeof next.dayProgress === 'object' ? next.dayProgress : {});
        setRevealed(next.revealed && typeof next.revealed === 'object' ? next.revealed : {});
        setAutoNext(typeof next.autoNext === 'boolean' ? next.autoNext : true);
        setShufflePractice(typeof next.shufflePractice === 'boolean' ? next.shufflePractice : false);
        setSavedAt(typeof next.savedAt === 'string' ? next.savedAt : '');
        setLastExportedAt(typeof next.lastExportedAt === 'string' ? next.lastExportedAt : '');
        setStorageWritable(true);
      } catch {
        // ignore
      }
    }

    updateStandalone();
    updateOnline();
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    window.addEventListener('storage', onStorage);

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
      try {
        if (offlineReadyTimerRef.current) window.clearTimeout(offlineReadyTimerRef.current);
      } catch {
        // ignore
      }

      try {
        offlineReadyTimerRef.current = window.setTimeout?.(() => setOfflineReady(false), 3500) || 0;
      } catch {
        // ignore
      }
    }

    window.addEventListener('pwa:need-refresh', onNeedRefresh);
    window.addEventListener('pwa:offline-ready', onOfflineReady);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      window.removeEventListener('storage', onStorage);
      mq?.removeEventListener?.('change', updateStandalone);
      window.removeEventListener('pwa:need-refresh', onNeedRefresh);
      window.removeEventListener('pwa:offline-ready', onOfflineReady);

      try {
        if (offlineReadyTimerRef.current) window.clearTimeout(offlineReadyTimerRef.current);
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    const prev = Boolean(prevOnlineRef.current);
    const cur = Boolean(isOnline);

    // Only toast when transitioning between online/offline.
    if (!prev && cur) {
      // Offline -> online
      setBackOnline(true);

      try {
        if (backOnlineTimerRef.current) window.clearTimeout(backOnlineTimerRef.current);
      } catch {
        // ignore
      }

      try {
        backOnlineTimerRef.current = window.setTimeout?.(() => setBackOnline(false), 2000) || 0;
      } catch {
        // ignore
      }

      // Also show a non-blocking toast (helps users notice when connectivity returns).
      notify('已恢復連線。', 'info', 1800);
    } else if (prev && !cur) {
      // Online -> offline
      notify('已離線：題庫與進度仍可用，但分享/更新可能受限。', 'warn', 2600);
    }

    prevOnlineRef.current = cur;

    return () => {
      try {
        if (backOnlineTimerRef.current) window.clearTimeout(backOnlineTimerRef.current);
      } catch {
        // ignore
      }
    };
  }, [isOnline, notify]);

  useEffect(() => {
    let raf = 0;

    function onScroll() {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        try {
          const y = window.scrollY || window.pageYOffset || 0;
          setShowScrollTop(y > 420);
        } catch {
          setShowScrollTop(false);
        }
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
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

  // persist state (debounced to reduce synchronous localStorage churn on mobile)
  const lastPersistPayloadRef = useRef(null);

  const persistNow = useCallback(() => {
    const payload = lastPersistPayloadRef.current;
    if (!payload) return;
    const ok = storageSet(STORAGE_KEY, JSON.stringify(payload));
    setStorageWritable(ok);
    if (ok) setSavedAt(payload.savedAt);
  }, [setSavedAt, setStorageWritable]);

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
      shufflePractice,
      savedAt: new Date().toISOString(),
      lastExportedAt: lastExportedAt || ''
    };

    lastPersistPayloadRef.current = payload;

    const t = window.setTimeout?.(() => {
      persistNow();
    }, 250);

    return () => {
      if (t) window.clearTimeout?.(t);
    };
  }, [plan, dayIndex, answers, dayProgress, revealed, autoNext, shufflePractice, lastExportedAt, persistNow]);

  // If the page is backgrounded/closed before the debounce fires (common on mobile),
  // flush the latest state so progress isn't lost.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') persistNow();
    }

    function onPageHide() {
      persistNow();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [persistNow]);

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

  const hasProgress = answeredCount > 0 || (plan?.length || 0) > 0;

  const daysSinceLastExport = useMemo(() => {
    if (!lastExportedAt) return null;
    try {
      const t = new Date(lastExportedAt).getTime();
      if (!Number.isFinite(t)) return null;
      const now = Date.now();
      const days = Math.floor((now - t) / (24 * 60 * 60 * 1000));
      return days >= 0 ? days : 0;
    } catch {
      return null;
    }
  }, [lastExportedAt]);

  // Gentle visual reminder: backups matter even when autosave works.
  // Show when the user has progress but hasn't exported recently.
  const backupDue = useMemo(() => {
    if (!storageWritable) return false;
    if (!hasProgress) return false;
    if (!lastExportedAt) return true;
    if (daysSinceLastExport == null) return true;
    return daysSinceLastExport >= 7;
  }, [storageWritable, hasProgress, lastExportedAt, daysSinceLastExport]);

  // If localStorage is not writable (private mode / strict privacy),
  // proactively remind users to export a backup once they start making progress.
  const didWarnNoStorageRef = useRef(false);
  useEffect(() => {
    if (storageWritable) {
      didWarnNoStorageRef.current = false;
      return;
    }

    const hasProgress = answeredCount > 0 || plan.length > 0;
    if (!hasProgress) return;

    if (!didWarnNoStorageRef.current) {
      didWarnNoStorageRef.current = true;
      notify('偵測到無法自動儲存進度：建議現在就「匯出進度」備份（JSON）。', 'warn', 4200);
    }
  }, [storageWritable, answeredCount, plan.length, notify]);

  // Gentle nudge: if storage works but user hasn't exported yet, suggest making a backup once they have meaningful progress.
  const didNudgeBackupRef = useRef(false);
  useEffect(() => {
    if (didNudgeBackupRef.current) return;
    if (!storageWritable) return; // already handled by the stronger warning above

    const hasProgress = answeredCount > 0 || plan.length > 0;
    if (!hasProgress) return;

    if (lastExportedAt) return;

    // Avoid nudging too early (reduce annoyance): wait until they answered a few questions or already generated a plan.
    if (plan.length === 0 && answeredCount < 8) return;

    didNudgeBackupRef.current = true;
    notify('小提醒：建議先「匯出進度（JSON）」做備份，避免換手機/清快取後不見。', 'info', 3600);
  }, [storageWritable, answeredCount, plan.length, lastExportedAt, notify]);

  // Extra guard: if we cannot persist (private mode) and the user has progress,
  // warn before closing/reloading so they have a chance to export a backup.
  useEffect(() => {
    if (storageWritable) return;
    const hasProgress = answeredCount > 0 || plan.length > 0;
    if (!hasProgress) return;

    function onBeforeUnload(e) {
      // Modern browsers ignore custom strings but still show a generic confirmation dialog.
      e.preventDefault();
      // @ts-ignore - returnValue is required by some browsers.
      e.returnValue = '';
      return '';
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [storageWritable, answeredCount, plan.length]);

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
      // Resetting diagnostic should also clear any previously generated plan/progress,
      // otherwise we can end up with a "plan" that no longer matches answers.
      setPlan([]);
      setDayIndex(0);
      setDayProgress({});
      setRevealed({});
      didAutoJumpToNextIncompleteRef.current = false;

      setAnswers({});
      setDiagIndex(0);
      return;
    }

    // resume at first unanswered question (if any)
    const firstUnanswered = allQuestions.findIndex((q) => answers?.[q.id] === undefined);
    setDiagIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
  }

  function restartDiagnosticFlow() {
    const ok = window.confirm('要重新做一次診斷嗎？（會清除目前的路徑進度與練習顯示狀態）');
    if (!ok) return;

    setPlan([]);
    setDayIndex(0);
    setDayProgress({});
    setRevealed({});
    setAnswers({});
    setDiagIndex(0);
    didAutoJumpToNextIncompleteRef.current = false;
    setView('diagnostic');
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

  const clearDiagnosticAnswer = useCallback((qid) => {
    setAnswers((p) => {
      if (!p || p[qid] === undefined) return p;
      const next = { ...p };
      delete next[qid];
      return next;
    });
  }, []);

  // Small UX: when switching views, scroll to top so users don't get "stuck" mid-page.
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    } catch {
      // ignore
    }
  }, [view]);

  // Shortcut help modal can be opened in any view.
  // (Previously it was diagnostic-only; keep it global so users can discover P/S/I shortcuts too.)

  // When browsing different days in the task view, snap back to the concept section.
  useEffect(() => {
    if (view !== 'task') return;
    try {
      document.getElementById('concept')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    } catch {
      // ignore
    }
  }, [view, dayIndex]);

  // Keep shortcut function refs up to date (so key handlers always call the latest closures).
  shortcutFnsRef.current.exportProgress = exportProgress;
  shortcutFnsRef.current.exportShareSummary = exportShareSummary;
  shortcutFnsRef.current.importProgressFromClipboard = importProgressFromClipboard;

  // Global keyboard shortcuts (desktop-friendly):
  // - P: export progress JSON
  // - S: export share summary
  // - I: import progress from clipboard (or prompt fallback)
  // (kept disabled in diagnostic view to avoid conflicts with answer shortcuts)
  useEffect(() => {
    if (view === 'diagnostic') return;

    function onKeyDown(e) {
      // avoid interfering with browser/OS shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // don't hijack keystrokes when user is typing in a form element
      const t = e.target;
      const tag = String(t?.tagName || '').toUpperCase();
      if (t?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // If the help modal is open, let Esc close it.
      if (showShortcuts && e.key === 'Escape') {
        e.preventDefault();
        setShowShortcuts(false);
        return;
      }

      const k = String(e.key || '').toLowerCase();

      // Help (works outside diagnostic too)
      if (k === '?' || k === 'h') {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      if (k === 'p') {
        e.preventDefault();
        shortcutFnsRef.current.exportProgress?.()?.catch?.(() => null);
        return;
      }

      if (k === 's') {
        e.preventDefault();
        shortcutFnsRef.current.exportShareSummary?.()?.catch?.(() => null);
        return;
      }

      if (k === 'i') {
        e.preventDefault();
        shortcutFnsRef.current.importProgressFromClipboard?.()?.catch?.(() => null);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, showShortcuts]);

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

      if (showShortcuts) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowShortcuts(false);
        }
        return;
      }

      if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

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

      // Extra QoL shortcuts
      // - C: clear current answer
      // - J: jump to first unanswered
      if (k === 'c') {
        if (answers?.[q.id] !== undefined) {
          e.preventDefault();
          clearDiagnosticAnswer(q.id);
        }
        return;
      }

      if (k === 'j') {
        if (firstUnansweredIndex >= 0) {
          e.preventDefault();
          setDiagIndex(firstUnansweredIndex);
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
  }, [
    view,
    currentQ,
    answers,
    diagIndex,
    allQuestions.length,
    firstUnansweredIndex,
    chooseDiagnosticAnswer,
    clearDiagnosticAnswer,
    submitDiagnostic,
    showShortcuts
  ]);

  function goTodayTask() {
    // If there is a known next incomplete day, prefer jumping there.
    // This avoids landing on an already-completed day (common after users review past days).
    if (nextIncompleteDay !== null && typeof nextIncompleteDay === 'number') {
      setDayIndex(nextIncompleteDay);
    }
    setView('task');
  }

  function buildShareSummary() {
    const lines = [];
    lines.push('高一化學覆習（診斷 → 補洞）進度摘要');
    lines.push(`匯出時間（台北）：${formatLocalTime(new Date().toISOString())}`);
    const deployedAt = formatBuildTime(BUILD_TIME);
    if (deployedAt) lines.push(`最後部署：${deployedAt}`);
    if (APP_VERSION) lines.push(`版本：v${APP_VERSION}`);
    if (savedAt) lines.push(`最後儲存（台北）：${formatLocalTime(savedAt)}`);
    if (lastExportedAt) lines.push(`上次匯出備份（JSON）（台北）：${formatLocalTime(lastExportedAt)}`);

    if (!plan?.length) {
      lines.push('尚未產生 7 日路徑（請先完成診斷）。');
      lines.push(`診斷進度：已作答 ${answeredCount}/${allQuestions.length}（${answeredPct}%）`);
      if (unansweredCount > 0) lines.push(`未作答：${unansweredCount} 題`);

      const ranked = Object.entries(perSkill)
        .map(([skillId, v]) => ({
          skillId,
          mastery: v.mastery,
          correct: v.correct,
          answered: v.answered,
          total: v.total
        }))
        // Prefer showing skills that have at least 1 answered diagnostic question.
        .sort((a, b) => {
          const aHas = (a.answered || 0) > 0;
          const bHas = (b.answered || 0) > 0;
          if (aHas !== bHas) return aHas ? -1 : 1;
          return a.mastery - b.mastery;
        });

      const topWeak = ranked.filter((x) => (x.answered || 0) > 0).slice(0, 3);
      if (topWeak.length) {
        lines.push('');
        lines.push('弱點 Top 3（尚未完成診斷，僅供參考）：');
        for (const w of topWeak) {
          const s = SKILLS.find((x) => x.id === w.skillId);
          const denom = w.answered ?? 0;
          const suffix = denom > 0 ? `${w.correct}/${denom}` : `0/0`;
          lines.push(`- ${s?.name || w.skillId}: ${w.mastery}%（${suffix}，共 ${w.total} 題）`);
        }
      }

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
    const now = new Date();
    const nowIso = now.toISOString();
    const ts = formatFilenameTimestamp(now);

    const payload = {
      version: 1,
      exportedAt: nowIso,
      appVersion: APP_VERSION || undefined,
      buildTime: BUILD_TIME || undefined,
      // Helpful debug metadata (kept optional + best-effort)
      device: (() => {
        try {
          return {
            userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : undefined,
            language: typeof navigator !== 'undefined' ? String(navigator.language || '') : undefined,
            standalone: Boolean(isStandalone),
            online: Boolean(isOnline)
          };
        } catch {
          return undefined;
        }
      })(),
      plan,
      dayIndex,
      answers,
      dayProgress,
      revealed,
      autoNext,
      shufflePractice,
      savedAt: savedAt || undefined,
      lastExportedAt: nowIso
    };
    const text = JSON.stringify(payload, null, 2);

    const markExported = () => {
      try {
        setLastExportedAt(nowIso);
      } catch {
        // ignore
      }
    };

    // Prefer native share sheet on mobile; fall back to clipboard / download.
    // Use a timestamped filename to avoid overwriting duplicates in chat apps / download managers.
    const shared = await tryNativeShare({
      title: '化學覆習進度（JSON）',
      text,
      filename: `chem-review-progress_${ts}.json`,
      mimeType: 'application/json'
    });
    if (shared) {
      markExported();
      // On mobile share sheets, users may not get any obvious confirmation.
      // Give a tiny non-blocking toast so they trust the backup happened.
      notify('已開啟分享：進度備份（JSON）已準備好。', 'good', 2200);
      return;
    }

    const ok = await copyToClipboard(text);
    if (ok) {
      markExported();
      notify('已複製進度 JSON 到剪貼簿。', 'good');
      return;
    }

    const downloaded = downloadText({ filename: `chem-review-progress_${ts}.json`, text });
    if (downloaded) {
      markExported();
      notify('你的瀏覽器不允許自動複製。我已改用「下載檔案」備份進度（JSON）。', 'info', 3200);
      return;
    }

    markExported();
    window.prompt('你的瀏覽器不允許自動複製/下載。請手動複製以下文字：', text);
  }

  async function exportShareSummary() {
    const now = new Date();
    const ts = formatFilenameTimestamp(now);

    const text = buildShareSummary();

    // Prefer native share sheet on mobile; fall back to clipboard / download.
    // Use a timestamped filename to avoid overwriting duplicates in chat apps / download managers.
    const shared = await tryNativeShare({
      title: '化學覆習進度摘要',
      text,
      filename: `chem-review-summary_${ts}.txt`,
      mimeType: 'text/plain;charset=utf-8'
    });
    if (shared) {
      // Tiny confirmation for share sheets.
      notify('已開啟分享：摘要已準備好。', 'good', 2000);
      return;
    }

    const ok = await copyToClipboard(text);
    if (ok) {
      notify('已複製摘要到剪貼簿。', 'good');
      return;
    }

    const downloaded = downloadText({ filename: `chem-review-summary_${ts}.txt`, text });
    if (downloaded) {
      notify('你的瀏覽器不允許自動複製。我已改用「下載檔案」匯出摘要（txt）。', 'info', 3200);
      return;
    }

    window.prompt('你的瀏覽器不允許自動複製/下載。請手動複製以下文字：', text);
  }

  const skillIdSet = useMemo(() => new Set(SKILLS.map((s) => s.id)), []);

  const diagnosticMeta = useMemo(() => {
    const qById = {};
    for (const q of allQuestions) {
      qById[q.id] = { choicesLen: Array.isArray(q.choices) ? q.choices.length : 0 };
    }

    const practiceIds = new Set();
    for (const s of SKILLS) {
      const qs = getPracticeQuestionsForSkill(s.id) || [];
      for (const q of qs) practiceIds.add(q.id);
    }

    return { qById, practiceIds };
  }, [allQuestions]);

  function sanitizeImportedPlan(xs) {
    if (!Array.isArray(xs)) return null;
    return xs.filter((sid) => typeof sid === 'string' && skillIdSet.has(sid));
  }

  function sanitizeImportedAnswers(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;

    for (const [qid, v] of Object.entries(obj)) {
      const meta = diagnosticMeta.qById[qid];
      if (!meta) continue;

      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      const i = Math.trunc(n);
      if (i < 0 || i >= meta.choicesLen) continue;
      out[qid] = i;
    }

    return out;
  }

  function sanitizeImportedRevealed(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;

    for (const [qid, v] of Object.entries(obj)) {
      if (!diagnosticMeta.practiceIds.has(qid)) continue;
      out[qid] = Boolean(v);
    }

    return out;
  }

  function sanitizeImportedDayProgress(obj, planLen) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;

    for (const [k, v] of Object.entries(obj)) {
      const day = Number(k);
      if (!Number.isInteger(day)) continue;
      if (day < 0 || day >= planLen) continue;
      if (!v || typeof v !== 'object') continue;

      out[day] = {
        conceptDone: Boolean(v.conceptDone),
        practiceDone: Boolean(v.practiceDone)
      };
    }

    return out;
  }
  function applyImportedProgress(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      window.alert('格式不正確：不是 JSON 物件');
      return false;
    }

    // Version warning (keep permissive: still allow importing older/newer exports).
    // If version is missing, treat it as v1.
    const importedVersion = Number(parsed.version ?? 1);
    if (Number.isFinite(importedVersion) && importedVersion !== 1) {
      const ok = window.confirm(
        `這份進度檔的版本是 v${importedVersion}（目前 App 預期 v1）。仍要嘗試匯入嗎？\n\n（若匯入後顯示異常，可按「重置進度」並用新版重新匯出/匯入。）`
      );
      if (!ok) return false;
    }

    // Minimal validation (keep it permissive)
    // Allow imports that only contain answers (plan missing) so users can move between builds
    // and regenerate the 7-day path later.
    let nextPlan = sanitizeImportedPlan(parsed.plan);
    if (!nextPlan) nextPlan = [];

    const nextDayIndex = typeof parsed.dayIndex === 'number' ? parsed.dayIndex : 0;
    const nextAnswers = sanitizeImportedAnswers(parsed.answers);
    const nextDayProgress = sanitizeImportedDayProgress(parsed.dayProgress, nextPlan.length);
    const nextRevealed = sanitizeImportedRevealed(parsed.revealed);
    const nextAutoNext = typeof parsed.autoNext === 'boolean' ? parsed.autoNext : true;
    const nextShufflePractice = typeof parsed.shufflePractice === 'boolean' ? parsed.shufflePractice : false;
    const importedSavedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : '';
    // If the export didn't include savedAt (older versions), treat the import as a fresh save.
    const effectiveSavedAt = importedSavedAt || new Date().toISOString();

    // Optional metadata: when the user last exported progress (for backup nudges).
    const importedLastExportedAt = typeof parsed.lastExportedAt === 'string' ? parsed.lastExportedAt : '';

    // If the imported file references skills/questions that no longer exist in this build,
    // warn the user that some progress will be skipped.
    try {
      const rawPlanLen = Array.isArray(parsed.plan) ? parsed.plan.length : 0;
      const rawAnswersLen = parsed.answers && typeof parsed.answers === 'object' ? Object.keys(parsed.answers).length : 0;
      const droppedPlan = Math.max(0, rawPlanLen - nextPlan.length);
      const droppedAnswers = Math.max(0, rawAnswersLen - Object.keys(nextAnswers || {}).length);

      if (droppedPlan > 0 || droppedAnswers > 0) {
        const ok = window.confirm(
          `注意：這份進度檔包含目前版本不存在的內容，我會略過無法識別的資料再匯入。\n\n` +
            (droppedPlan > 0 ? `- 已略過 ${droppedPlan} 個路徑技能點\n` : '') +
            (droppedAnswers > 0 ? `- 已略過 ${droppedAnswers} 個作答記錄\n` : '') +
            `\n仍要繼續匯入嗎？`
        );
        if (!ok) return false;
      }
    } catch {
      // ignore
    }

    const clampedDayIndex = Math.max(0, Math.min(nextPlan.length - 1, nextDayIndex));

    // Prevent the reactive persist effect from immediately overwriting imported savedAt
    // (and re-stamping it to "now") right after we set state.
    skipNextPersistRef.current = true;

    setPlan(nextPlan);
    setDayIndex(clampedDayIndex);
    setAnswers(nextAnswers);
    setDayProgress(nextDayProgress);
    setRevealed(nextRevealed);
    setAutoNext(nextAutoNext);
    setShufflePractice(nextShufflePractice);
    setSavedAt(effectiveSavedAt);
    // Keep practice shuffle seeds consistent with the newly imported state.
    // (initialSavedAtRef is used as a stable seed basis across refreshes/autosaves.)
    initialSavedAtRef.current = effectiveSavedAt;
    setLastExportedAt(importedLastExportedAt);

    // Persist immediately (keep storage consistent with the clamped in-memory state)
    const wrote = storageSet(
      STORAGE_KEY,
      JSON.stringify({
        plan: nextPlan,
        dayIndex: clampedDayIndex,
        answers: nextAnswers,
        dayProgress: nextDayProgress,
        revealed: nextRevealed,
        autoNext: nextAutoNext,
        shufflePractice: nextShufflePractice,
        savedAt: effectiveSavedAt,
        lastExportedAt: importedLastExportedAt
      })
    );
    setStorageWritable(wrote);

    setView(nextPlan.length > 0 ? 'result' : 'home');
    return true;
  }

  function summarizeImportedProgressForConfirm(parsed) {
    try {
      if (!parsed || typeof parsed !== 'object') return '';

      const exportedAt = typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '';
      const savedAt = typeof parsed.savedAt === 'string' ? parsed.savedAt : '';

      const answersObj = parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : null;
      const answersCount = answersObj ? Object.keys(answersObj).length : 0;

      const planArr = Array.isArray(parsed.plan) ? parsed.plan : [];
      const planLen = planArr.length;

      const dp = parsed.dayProgress && typeof parsed.dayProgress === 'object' ? parsed.dayProgress : null;
      let completedDays = 0;
      if (dp && planLen) {
        for (let i = 0; i < planLen; i++) {
          const p = dp[i] || dp[String(i)];
          if (p && typeof p === 'object' && p.conceptDone && p.practiceDone) completedDays += 1;
        }
      }

      const lines = [];
      if (exportedAt) lines.push(`匯出時間（台北）：${formatLocalTime(exportedAt)}`);
      if (savedAt) lines.push(`最後儲存（台北）：${formatLocalTime(savedAt)}`);
      if (Number.isFinite(planLen) && planLen > 0) lines.push(`7 日路徑：${planLen} 天（已完成 ${completedDays} 天）`);
      if (Number.isFinite(answersCount) && answersCount > 0) lines.push(`診斷作答：${answersCount} 題`);

      return lines.length ? `\n\n（匯入內容摘要）\n${lines.join('\n')}` : '';
    } catch {
      return '';
    }
  }

  function confirmImportOverwrite({ sourceLabel, parsed }) {
    const extra = summarizeImportedProgressForConfirm(parsed);
    return window.confirm(`要用${sourceLabel}的進度覆蓋目前進度嗎？（此操作無法復原）${extra}`);
  }

  function importProgressViaPrompt() {
    const raw = window.prompt('貼上先前匯出的進度 JSON（會覆蓋目前進度）');
    if (!raw) return;

    const parsed = safeParsePossiblyWrappedJson(raw, null);
    if (!parsed) {
      notify('匯入失敗：請確認內容是有效的進度 JSON。', 'warn', 4200);
      return;
    }

    const confirmOverwrite = confirmImportOverwrite({ sourceLabel: '「貼上」', parsed });
    if (!confirmOverwrite) return;

    const ok = applyImportedProgress(parsed);
    if (ok) notify('已匯入進度。', 'good', 3200);
    else notify('匯入失敗：請確認內容是有效的進度 JSON。', 'warn', 4200);
  }

  async function importProgressFromClipboard() {
    // True “from clipboard” import when permissions allow; fall back to prompt.
    try {
      const text = await navigator?.clipboard?.readText?.();
      if (!text) {
        importProgressViaPrompt();
        return;
      }

      const parsed = safeParsePossiblyWrappedJson(text, null);
      if (!parsed) {
        notify('匯入失敗：剪貼簿內容看起來不是有效的進度 JSON。', 'warn', 4200);
        return;
      }

      const confirmOverwrite = confirmImportOverwrite({ sourceLabel: '「剪貼簿」', parsed });
      if (!confirmOverwrite) return;

      const ok = applyImportedProgress(parsed);
      if (ok) notify('已從剪貼簿匯入進度。', 'good', 3200);
      else notify('匯入失敗：剪貼簿內容看起來不是有效的進度 JSON。', 'warn', 4200);
    } catch {
      // Permission denied / unsupported browser.
      importProgressViaPrompt();
    }
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

      const text = await file.text();
      const parsed = safeParsePossiblyWrappedJson(text, null);
      if (!parsed) {
        notify('匯入失敗：檔案內容看起來不是有效的進度 JSON。', 'warn', 4200);
        return;
      }

      const confirmOverwrite = confirmImportOverwrite({ sourceLabel: `「檔案：${file.name}」`, parsed });
      if (!confirmOverwrite) return;

      const ok = applyImportedProgress(parsed);
      if (ok) notify('已從檔案匯入進度。', 'good', 3200);
      else notify('匯入失敗：檔案內容看起來不是有效的進度 JSON。', 'warn', 4200);
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

  // QoL: drag & drop import (desktop). Drop an exported JSON anywhere on the page.
  function isProbablyProgressJsonFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    if (name.endsWith('.json')) return true;
    if (type.includes('json')) return true;
    return false;
  }

  function hasFileTransfer(dt) {
    if (!dt) return false;
    try {
      // Be conservative: only treat as a “file drag” when the browser explicitly says so.
      // (Some browsers expose dt.items for text/URL drags too, which would create noisy overlays.)
      if (Array.isArray(dt.types) && dt.types.includes('Files')) return true;
      if (dt.types && typeof dt.types.contains === 'function' && dt.types.contains('Files')) return true;
      if (dt.files && dt.files.length) return true;
    } catch {
      // ignore
    }
    return false;
  }

  function firstDraggedFile(dt) {
    try {
      const itemFile = dt?.items?.[0]?.getAsFile?.();
      if (itemFile) return itemFile;
    } catch {
      // ignore
    }
    try {
      const file = dt?.files?.[0];
      if (file) return file;
    } catch {
      // ignore
    }
    return null;
  }

  function onDragEnterImport(e) {
    const dt = e?.dataTransfer;
    if (!hasFileTransfer(dt)) return;

    // Best-effort: only show the import UI when we can tell it's probably JSON.
    // Some browsers don't expose filenames/types until drop; in that case, still allow the UX and validate on drop.
    const f = firstDraggedFile(dt);
    if (f && !isProbablyProgressJsonFile(f)) return;

    e.preventDefault();
    setDragImportActive(true);
  }

  function onDragOverImport(e) {
    const dt = e?.dataTransfer;
    if (!hasFileTransfer(dt)) return;

    // Best-effort: avoid showing the overlay for obviously-non-JSON file drags.
    const f = firstDraggedFile(dt);
    if (f && !isProbablyProgressJsonFile(f)) return;

    e.preventDefault();
    // Keep it sticky while hovering.
    if (!dragImportActive) setDragImportActive(true);
  }

  function onDragLeaveImport(e) {
    // Only deactivate when leaving the root element (not when moving between children).
    if (e?.currentTarget && e?.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    setDragImportActive(false);
  }

  async function onDropImport(e) {
    e.preventDefault();
    setDragImportActive(false);

    try {
      const file = e?.dataTransfer?.files?.[0];
      if (!file) return;
      if (!isProbablyProgressJsonFile(file)) {
        notify('這看起來不是 JSON 檔。請拖放先前匯出的進度 .json。', 'warn', 4200);
        return;
      }

      const text = await file.text();
      const parsed = safeParsePossiblyWrappedJson(text, null);
      if (!parsed) {
        notify('匯入失敗：檔案內容看起來不是有效的進度 JSON。', 'warn', 4200);
        return;
      }

      const confirmOverwrite = confirmImportOverwrite({ sourceLabel: `「拖放檔案：${file.name}」`, parsed });
      if (!confirmOverwrite) return;

      const ok = applyImportedProgress(parsed);
      if (ok) notify('已從拖放檔案匯入進度。', 'good', 3200);
      else notify('匯入失敗：檔案內容看起來不是有效的進度 JSON。', 'warn', 4200);
    } catch {
      notify('匯入失敗：請確認檔案是先前匯出的 JSON。', 'warn', 4200);
    }
  }

  function resetProgress() {
    // keep minimal: clear persisted state + reset in-memory state
    const ok = window.confirm('確定要重置進度？這會清除你的診斷結果與 7 日路徑。（建議先按「匯出進度」備份）');
    if (!ok) return;

    // Prevent the reactive "persist" effect from immediately re-writing an empty state
    // right after we remove localStorage (so reset truly clears).
    skipNextPersistRef.current = true;

    // Also reset any "auto jump" behavior so a fresh start doesn't unexpectedly snap days.
    didAutoJumpToNextIncompleteRef.current = false;

    const removed = storageRemove(STORAGE_KEY);
    setStorageWritable(removed);
    setSavedAt('');
    // Reset seed basis so a fresh start doesn't inherit old shuffle order.
    initialSavedAtRef.current = '';
    setLastExportedAt('');
    setView('home');
    setDiagIndex(0);
    setAnswers({});
    setPlan([]);
    setDayIndex(0);
    setDayProgress({});
    setRevealed({});
    setAutoNext(true);
    setShufflePractice(false);

    // Non-blocking confirmation (avoids relying on alert dialogs, especially on mobile/PWA).
    notify('已重置進度。', 'info');
  }

  const buildLabel = useMemo(() => formatBuildTime(BUILD_TIME), []);

  // Show/copy build info even if we only have version (some deploys may omit __BUILD_TIME__).
  const buildInfoText = useMemo(() => {
    const parts = [];
    if (buildLabel) parts.push(`最後部署：${buildLabel}`);
    if (APP_VERSION) parts.push(`v${APP_VERSION}`);
    return parts.join(' · ');
  }, [buildLabel]);

  const practiceQs = useMemo(() => {
    const base = getPracticeQuestionsForSkill(currentSkill?.id || '');
    if (!shufflePractice) return base;

    // Shuffle should be stable across refreshes (so "今天" doesn't feel random every open),
    // but still differ by Day/Skill.
    const seed = `${initialSavedAtRef.current || 'seed'}|${currentSkill?.id || ''}|day${dayIndex}`;
    return shuffledCopy(base, seed);
  }, [currentSkill?.id, shufflePractice, dayIndex]);

  // If a skill has 0 practice questions (e.g., during MVP expansion), don't block users from marking practice as done.
  // Treat "all revealed" as true when there is nothing to reveal.
  const allPracticeRevealed = useMemo(() => practiceQs.every((q) => Boolean(revealed?.[q.id])), [practiceQs, revealed]);
  const practiceRevealedCount = useMemo(() => practiceQs.filter((q) => Boolean(revealed?.[q.id])).length, [practiceQs, revealed]);

  const firstUnrevealedPractice = useMemo(() => practiceQs.find((q) => !revealed?.[q.id]) || null, [practiceQs, revealed]);

  return (
    <div
      className="min-h-screen"
      onDragEnter={onDragEnterImport}
      onDragOver={onDragOverImport}
      onDragLeave={onDragLeaveImport}
      onDrop={onDropImport}
    >
      <input
        ref={importFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={importProgressFromFile}
      />

      {dragImportActive ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-cyan-300/25 bg-black/60 p-5 text-center">
            <div className="text-xs tracking-widest text-cyan-100/70">IMPORT</div>
            <div className="mt-2 text-base font-medium text-cyan-50">放開以匯入進度 JSON</div>
            <div className="mt-2 text-xs text-white/60">（會覆蓋目前進度；僅接受先前匯出的 .json）</div>
          </div>
        </div>
      ) : null}

      {showShortcuts ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="鍵盤快捷鍵"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/95 p-5 text-white/85 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs tracking-widest text-white/50">HELP</div>
                <div className="mt-1 text-base font-semibold">鍵盤快捷鍵</div>
                <div className="mt-1 text-xs text-white/55">
                  {view === 'diagnostic' ? '（診斷模式）' : '（一般模式）'}
                </div>
              </div>
              <button
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                type="button"
                onClick={() => setShowShortcuts(false)}
              >
                關閉（Esc）
              </button>
            </div>

            {view === 'diagnostic' ? (
              <>
                <div className="mt-4 text-xs font-semibold text-white/65">診斷</div>
                <ul className="mt-2 grid gap-2 text-sm text-white/75">
                  <li>• 1–4 或 A–D：選擇答案</li>
                  <li>• ← / →：上一題 / 下一題（→ 需要已作答）</li>
                  <li>• Enter：下一題 / 送出診斷</li>
                  <li>• C：清除本題作答</li>
                  <li>• J：跳到第一個未作答</li>
                  <li>• Esc：關閉此視窗 / 退出診斷</li>
                </ul>

                <div className="mt-4 text-xs font-semibold text-white/65">全域（非診斷頁可用）</div>
                <ul className="mt-2 grid gap-2 text-sm text-white/75">
                  <li>• P：匯出進度（JSON）</li>
                  <li>• S：匯出分享摘要（文字）</li>
                  <li>• I：從剪貼簿匯入進度（JSON）</li>
                  <li>• ? 或 H：打開此視窗</li>
                </ul>
              </>
            ) : (
              <>
                <div className="mt-4 text-xs font-semibold text-white/65">全域</div>
                <ul className="mt-2 grid gap-2 text-sm text-white/75">
                  <li>• P：匯出進度（JSON）</li>
                  <li>• S：匯出分享摘要（文字）</li>
                  <li>• I：從剪貼簿匯入進度（JSON）</li>
                  <li>• Esc：關閉此視窗</li>
                  <li>• ? 或 H：打開此視窗</li>
                </ul>

                <div className="mt-4 text-xs text-white/55">診斷頁還有更多快捷鍵（1–4、A–D、←/→、Enter...）。</div>
              </>
            )}

            <div className="mt-4 text-xs text-white/55">小提醒：如果你在輸入框打字，快捷鍵不會生效（避免干擾）。</div>
          </div>
        </div>
      ) : null}

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
            {!storageWritable ? (
              <Badge tone="warn" title="你的瀏覽器可能停用了 localStorage（例如：隱私模式/嚴格追蹤防護）。進度可能無法自動保存。">
                無法儲存
              </Badge>
            ) : null}
            {savedAt ? <Badge tone="neutral">已儲存 {formatLocalTime(savedAt)}</Badge> : null}
            {lastExportedAt ? <Badge tone="good">已備份 {formatLocalTime(lastExportedAt)}</Badge> : null}
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

              {!storageWritable ? (
                <div className="rounded-xl border border-amber-300/20 bg-amber-500/10 p-4">
                  <div className="text-xs tracking-widest text-amber-100/80">WARNING</div>
                  <div className="mt-2 text-sm text-amber-50/90">
                    你的瀏覽器目前可能無法保存進度（localStorage 被停用/隱私模式）。建議你定期用「匯出進度」做備份（JSON），換裝置也能匯入。
                  </div>
                  {answeredCount > 0 || plan.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-lg border border-amber-300/20 bg-amber-500/15 px-4 py-2 text-sm text-amber-50 hover:bg-amber-500/20"
                        type="button"
                        onClick={exportProgress}
                      >
                        立即備份（匯出進度）
                      </button>
                      <button
                        className="rounded-lg border border-amber-300/20 bg-black/10 px-4 py-2 text-sm text-amber-50/90 hover:bg-black/20"
                        type="button"
                        onClick={importProgressFromClipboard}
                      >
                        從剪貼簿匯入
                      </button>
                    </div>
                  ) : null}
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
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10"
                        type="button"
                        onClick={exportShareSummary}
                        title="即使診斷還沒做完，也可以先匯出目前弱點摘要（供老師/同學參考）"
                      >
                        匯出摘要
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
                        onClick={goTodayTask}
                        title={nextIncompleteDay !== null ? `預設跳到下一個未完成：Day ${nextIncompleteDay + 1}` : undefined}
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
                        className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/15"
                        type="button"
                        onClick={resetProgress}
                      >
                        重置進度
                      </button>
                    </>
                  ) : null}

                  {answeredCount > 0 || plan.length > 0 ? (
                    <>
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
                        onClick={importProgressFromClipboard}
                        title="從剪貼簿讀取 JSON 匯入進度（會覆蓋目前進度；若不支援會改用手動貼上）"
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
              {/* help modal is rendered globally (so it also works outside diagnostic) */}
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/55">
                  <span>
                    題目 {diagIndex + 1} / {allQuestions.length} · 已作答 {answeredCount} / {allQuestions.length}（{answeredPct}%）
                    {unansweredCount > 0 ? ` · 未答 ${unansweredCount}` : ''}
                  </span>

                  <div className="flex items-center gap-2">
                    <span
                      className="hidden lg:inline text-white/35"
                      title="鍵盤：按 ? 或 H 也可開啟快捷鍵說明"
                      aria-hidden="true"
                    >
                      按 ? 看快捷鍵
                    </span>
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
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() => setShowShortcuts(true)}
                      title="查看鍵盤快捷鍵（也可按 ? 或 H）"
                    >
                      快捷鍵
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

              <div
                className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-black/10"
                role="progressbar"
                aria-label="診斷完成度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={answeredPct}
                title={`診斷完成度：${answeredPct}%`}
              >
                <div className="h-full bg-cyan-400/40" style={{ width: `${answeredPct}%` }} />
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
                        key={`${currentQ.id}-${idx}`}
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

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
                    type="button"
                    disabled={diagIndex === 0}
                    onClick={() => setDiagIndex((i) => Math.max(0, i - 1))}
                  >
                    上一題
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    {firstUnansweredIndex >= 0 ? (
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
                        type="button"
                        disabled={firstUnansweredIndex === diagIndex}
                        onClick={() => setDiagIndex(firstUnansweredIndex)}
                        title="跳到第一個未作答的題目"
                      >
                        跳到未答
                      </button>
                    ) : null}

                    {answers[currentQ.id] !== undefined ? (
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                        type="button"
                        onClick={() => clearDiagnosticAnswer(currentQ.id)}
                        title="清除本題作答"
                      >
                        清除本題
                      </button>
                    ) : null}

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
              </div>

              <div className="rounded-xl border border-white/10 bg-black/10 p-4 text-xs text-white/55">
                設計目標：診斷題要能定位「技能點弱項」。MVP 先用每技能點 2 題做示範。小技巧：可用 1–4 或 A–D 作答、←/→ 換題、Enter 下一題、C 清除本題、J 跳到未答、Esc 退出。
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
                      className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/15"
                      type="button"
                      onClick={restartDiagnosticFlow}
                      title="重新做診斷（會清除目前的路徑進度與練習顯示狀態）"
                    >
                      重新診斷
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
                      onClick={importProgressFromClipboard}
                      title="從剪貼簿讀取 JSON 匯入進度（會覆蓋目前進度；若不支援會改用手動貼上）"
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
                      onClick={() => document.getElementById('concept')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}
                    >
                      跳到概念
                    </button>
                    <button
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      type="button"
                      onClick={() => document.getElementById('practice')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}
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

                    {practiceQs.length > 1 ? (
                      <button
                        className={cls(
                          'rounded-lg border px-3 py-1.5 text-xs hover:bg-white/10',
                          shufflePractice ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-50' : 'border-white/10 bg-white/5 text-white/75'
                        )}
                        type="button"
                        onClick={() => setShufflePractice((v) => !v)}
                        title="把本日練習題順序改為固定亂序（避免背題號）；不同 Day/技能會有不同順序"
                      >
                        練習題亂序：{shufflePractice ? '開' : '關'}
                      </button>
                    ) : null}

                    {firstUnrevealedPractice ? (
                      <>
                        <button
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                          type="button"
                          onClick={() => {
                            try {
                              document
                                .getElementById(`pq_${safeDomId(firstUnrevealedPractice.id)}`)
                                ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
                            } catch {
                              // ignore
                            }
                          }}
                          title="跳到第一題尚未顯示答案的練習題"
                        >
                          跳到未顯示
                        </button>
                        <button
                          className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-50 hover:bg-emerald-500/15"
                          type="button"
                          onClick={() => {
                            try {
                              setRevealed((p) => ({ ...p, [firstUnrevealedPractice.id]: true }));
                              window.setTimeout?.(() => {
                                try {
                                  document
                                    .getElementById(`pq_${safeDomId(firstUnrevealedPractice.id)}`)
                                    ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
                                } catch {
                                  // ignore
                                }
                              }, 0);
                            } catch {
                              // ignore
                            }
                          }}
                          title="直接顯示下一題尚未顯示的答案（並跳到該題）"
                        >
                          顯示下一題答案
                        </button>
                      </>
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

                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                              type="button"
                              title="複製本題（方便貼給老師/同學或做筆記）"
                              onClick={async () => {
                                const lines = [];
                                lines.push('化學覆習練習題');
                                lines.push(`題目：${q.stem}`);

                                if (Array.isArray(q?.choices) && q.choices.length > 0) {
                                  lines.push('選項：');
                                  for (let i = 0; i < q.choices.length; i++) {
                                    lines.push(`${String.fromCharCode(65 + i)}. ${q.choices[i]}`);
                                  }
                                }

                                if (isRevealed) {
                                  const ansLabel = String.fromCharCode(65 + q.answer);
                                  const ansText = Array.isArray(q?.choices) && q.choices?.[q.answer] ? `（${q.choices[q.answer]}）` : '';
                                  lines.push(`答案：${ansLabel}${ansText}`);
                                  if (q.explanation) lines.push(`解析：${q.explanation}`);
                                  if (Array.isArray(q?.wrongReasonTags) && q.wrongReasonTags.length > 0) {
                                    lines.push(`常見錯因：${q.wrongReasonTags.join('、')}`);
                                  }
                                } else {
                                  lines.push('（尚未顯示答案）');
                                }

                                const ok = await copyToClipboard(lines.join('\n'));
                                if (ok) notify('已複製本題內容到剪貼簿。', 'good');
                                else window.alert('你的瀏覽器不允許自動複製，請改用手動選取文字。');
                              }}
                            >
                              複製本題
                            </button>

                            <button
                              className={cls(
                                'rounded-lg border px-3 py-1.5 text-xs',
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
                        </div>

                        {Array.isArray(q?.choices) && q.choices.length > 0 ? (
                          <div className="mt-2 grid gap-1 text-xs text-white/70">
                            {q.choices.map((c, idx) => {
                              const isCorrect = idx === q.answer;
                              return (
                                <div
                                  key={`${q.id}_c_${idx}`}
                                  className={cls(
                                    'rounded-lg border px-3 py-2',
                                    'bg-black/10',
                                    isRevealed && isCorrect
                                      ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-50'
                                      : 'border-white/10 text-white/80'
                                  )}
                                >
                                  <span className={cls('mr-1', isRevealed && isCorrect ? 'text-emerald-50/90' : 'text-white/60')}>
                                    {String.fromCharCode(65 + idx)}.
                                  </span>
                                  {c}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {isRevealed ? (
                          <div className="mt-2 grid gap-2 text-xs text-white/55">
                            <div>
                              答案：{String.fromCharCode(65 + q.answer)}
                              {Array.isArray(q?.choices) && q.choices?.[q.answer] ? `（${q.choices[q.answer]}）` : ''} · {q.explanation}
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
        <div
          className="fixed bottom-3 left-3 z-50 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-50/90 backdrop-blur"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          已可離線使用
        </div>
      ) : null}

      {backOnline && isOnline ? (
        <div
          className="fixed bottom-12 left-3 z-50 rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-50/90 backdrop-blur"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          已恢復連線
        </div>
      ) : null}

      {!isOnline ? (
        <div
          className="fixed bottom-12 left-3 z-50 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/85 backdrop-blur"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          title="目前為離線狀態：題庫與進度操作仍可使用，但分享/更新可能受限。"
        >
          離線中
        </div>
      ) : null}

      {!storageWritable ? (
        <button
          type="button"
          className="fixed bottom-28 left-3 z-50 rounded-full border border-amber-300/20 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-50/90 backdrop-blur hover:bg-amber-500/15"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="無法自動儲存：點此立即匯出進度備份（JSON）"
          title="偵測到瀏覽器禁止 localStorage（例如隱私模式）。點一下立即『匯出進度（JSON）』備份。"
          onClick={() => {
            exportProgress()?.catch?.(() => null);
          }}
        >
          無法自動儲存：點此匯出備份
        </button>
      ) : backupDue ? (
        <button
          type="button"
          className="fixed bottom-28 right-3 z-50 rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-50/90 backdrop-blur hover:bg-cyan-500/15"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="建議備份：點此匯出進度（JSON）"
          title={
            lastExportedAt
              ? `上次備份已超過 ${daysSinceLastExport ?? '多'} 天。點一下『匯出進度（JSON）』做備份。`
              : '尚未備份過。點一下『匯出進度（JSON）』做備份。'
          }
          onClick={() => {
            exportProgress()?.catch?.(() => null);
          }}
        >
          建議備份：匯出進度
        </button>
      ) : null}

      {toast?.msg ? (
        <button
          type="button"
          className={cls(
            'fixed bottom-20 left-3 z-50 rounded-full border px-3 py-1 text-[11px] backdrop-blur',
            toast.tone === 'good'
              ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-50/90'
              : toast.tone === 'warn'
                ? 'border-amber-300/20 bg-amber-500/10 text-amber-50/90'
                : toast.tone === 'info'
                  ? 'border-cyan-300/20 bg-cyan-500/10 text-cyan-50/90'
                  : 'border-white/10 bg-white/5 text-white/85'
          )}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="通知（點一下關閉）"
          title="點一下關閉"
          onClick={() => {
            try {
              if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
            } catch {
              // ignore
            }
            setToast(null);
          }}
        >
          {toast.msg}
        </button>
      ) : null}

      {needRefresh ? (
        <div
          className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-50/90 backdrop-blur"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>有新版本可用</span>
          <button
            type="button"
            aria-label="重新整理以更新到新版本"
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
            aria-label="稍後再更新"
            className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
            onClick={() => setNeedRefresh(false)}
          >
            稍後
          </button>
        </div>
      ) : null}

      {buildInfoCopied ? (
        <div
          className="fixed bottom-20 right-3 z-50 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-50/90 backdrop-blur"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          已複製版本資訊
        </div>
      ) : null}

      {showScrollTop ? (
        <button
          type="button"
          aria-label="回到頁面頂部"
          className="fixed bottom-12 right-3 z-40 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-white/70 backdrop-blur hover:bg-black/45"
          title="回到頂部"
          onClick={() => {
            try {
              window.scrollTo({ top: 0, behavior: scrollBehavior() });
            } catch {
              // ignore
            }
          }}
        >
          回到頂部
        </button>
      ) : null}

      {buildInfoText ? (
        <button
          type="button"
          aria-label="複製版本與最後部署資訊"
          className="fixed bottom-3 right-3 z-40 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-white/65 backdrop-blur hover:bg-black/45"
          title="點一下複製版本資訊（方便回報問題）"
          onClick={async () => {
            const ok = await copyToClipboard(buildInfoText);
            if (ok) {
              setBuildInfoCopied(true);
              try {
                if (buildInfoCopiedTimerRef.current) window.clearTimeout(buildInfoCopiedTimerRef.current);
              } catch {
                // ignore
              }
              try {
                buildInfoCopiedTimerRef.current = window.setTimeout?.(() => setBuildInfoCopied(false), 2000) || 0;
              } catch {
                // ignore
              }
            } else {
              window.alert('你的瀏覽器不允許自動複製，請手動複製版本資訊。');
            }
          }}
        >
          {buildInfoText}
        </button>
      ) : null}
    </div>
  );
}
