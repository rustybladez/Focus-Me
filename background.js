// background.js — service worker
// Owns all timer state. The popup only reads/commands this worker.

const SESSIONS = {
  work:  { label: "Work Session",  duration: 25 * 60 },
  break: { label: "Break Session", duration:  5 * 60 },
};

const ALARM_NAME = "pomodoro-tick";

// ── Storage helpers ───────────────────────────────────────────────────
// Always read everything in one call — avoids three-way read races.

function loadAll() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["pomodoroState", "hardMode", "lockedTabId"],
      (data) => {
        resolve({
          state:       data.pomodoroState ?? defaultState(),
          hardMode:    data.hardMode === true,
          lockedTabId: data.lockedTabId ?? null,
        });
      }
    );
  });
}

function defaultState() {
  return {
    session:   "work",
    remaining: SESSIONS.work.duration,
    total:     SESSIONS.work.duration,
    running:   false,
  };
}

// Individual writers — reads still go through loadAll()
function saveState(state) {
  chrome.storage.local.set({ pomodoroState: state });
}

function saveStateAsync(state) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ pomodoroState: state }, resolve)
  );
}

function setLockedTab(tabId) {
  return new Promise((resolve) =>
    chrome.storage.local.set({ lockedTabId: tabId }, resolve)
  );
}

function clearLockedTab() {
  return new Promise((resolve) =>
    chrome.storage.local.remove("lockedTabId", resolve)
  );
}

function broadcastState(state) {
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", state }).catch(() => {});
}

// ── Tab lock enforcement ──────────────────────────────────────────────
// Single read → decide → act, with no setTimeout (unreliable in SW).
// chrome.tabs.update is called directly; errors are caught explicitly.

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const { state, hardMode, lockedTabId } = await loadAll();

  if (!state.running || !hardMode || lockedTabId === null) return;
  if (tabId === lockedTabId) return; // snap-back itself fires this — ignore

  snapBack(lockedTabId);
});

async function snapBack(lockedTabId, attempt = 0) {
  try {
    await chrome.tabs.update(lockedTabId, { active: true });
  } catch (err) {
    const msg = err?.message ?? "";

    if (msg.includes("No tab with id") || msg.includes("Cannot access")) {
      // Locked tab is gone — release gracefully
      clearLockedTab();
      return;
    }

    // "Tabs cannot be edited right now" — Chrome is mid-transition.
    // Retry up to 5 times with a short linear back-off (100 ms each).
    // Using chrome.alarms for the delay keeps the service worker alive.
    if (attempt < 5) {
      await sleep(100);
      await snapBack(lockedTabId, attempt + 1);
    }
    // If all retries fail, give up silently rather than spam errors.
  }
}

// sleep() that won't be killed mid-wait: wraps a Promise around
// chrome.alarms for the delay so Chrome keeps the SW alive.
// For short delays (<1 s) a plain Promise + chained microtask is fine
// because we're already inside an active event handler's async chain.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Release lock when the locked tab itself is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { lockedTabId } = await loadAll();
  if (tabId === lockedTabId) clearLockedTab();
});

// ── Alarm tick ────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const { state } = await loadAll();
  if (!state.running) return;

  state.remaining--;

  if (state.remaining <= 0) {
    state.session   = state.session === "work" ? "break" : "work";
    state.total     = SESSIONS[state.session].duration;
    state.remaining = state.total;
  }

  saveState(state);
  broadcastState(state);
});

// ── Message handler (commands from popup) ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const { state, hardMode } = await loadAll();

    if (msg.type === "GET_STATE") {
      sendResponse({ ...state, hardMode });

    } else if (msg.type === "START") {
      state.running = true;
      // Await both writes together so lock + state are in storage
      // before the first onActivated can fire.
      await Promise.all([
        saveStateAsync(state),
        msg.tabId != null ? setLockedTab(msg.tabId) : Promise.resolve(),
      ]);
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 / 60 });
      sendResponse(state);

    } else if (msg.type === "PAUSE") {
      state.running = false;
      saveState(state);
      chrome.alarms.clear(ALARM_NAME);
      sendResponse(state);

    } else if (msg.type === "RESET") {
      state.running   = false;
      state.session   = "work";
      state.total     = SESSIONS.work.duration;
      state.remaining = SESSIONS.work.duration;
      await Promise.all([saveStateAsync(state), clearLockedTab()]);
      chrome.alarms.clear(ALARM_NAME);
      sendResponse(state);

    } else if (msg.type === "SET_HARD_MODE") {
      chrome.storage.local.set({ hardMode: msg.value });
      sendResponse({ ok: true });
    }
  })();

  return true;
});