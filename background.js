// background.js — service worker
// Owns all timer state. The popup only reads/commands this worker.

const SESSIONS = {
  work:  { label: "Work Session",  duration: 25 * 60 },
  break: { label: "Break Session", duration:  5 * 60 },
};

const ALARM_NAME = "pomodoro-tick";

// ── Helpers ───────────────────────────────────────────────────────────

function defaultState() {
  return {
    session:   "work",
    remaining: SESSIONS.work.duration,
    total:     SESSIONS.work.duration,
    running:   false,
  };
}

async function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get("pomodoroState", (data) => {
      resolve(data.pomodoroState || defaultState());
    });
  });
}

function saveState(state) {
  chrome.storage.local.set({ pomodoroState: state });
}

function broadcastState(state) {
  // Notify popup if it happens to be open
  chrome.runtime.sendMessage({ type: "STATE_UPDATE", state }).catch(() => {});
}

// ── Alarm tick ────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const state = await getState();
  if (!state.running) return;

  state.remaining--;

  if (state.remaining <= 0) {
    // Switch session
    state.session   = state.session === "work" ? "break" : "work";
    state.total     = SESSIONS[state.session].duration;
    state.remaining = state.total;
    // Keep running (auto-advance)
  }

  saveState(state);
  broadcastState(state);
});

// ── Message handler (commands from popup) ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await getState();

    if (msg.type === "GET_STATE") {
      sendResponse(state);

    } else if (msg.type === "START") {
      state.running = true;
      saveState(state);
      // Create a repeating alarm every 1 second (minimum Chrome allows is ~1 min for
      // persistent alarms, but periodInMinutes accepts decimals — 1/60 ≈ 1 second)
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 / 60 });
      sendResponse(state);

    } else if (msg.type === "PAUSE") {
      state.running = false;
      saveState(state);
      chrome.alarms.clear(ALARM_NAME);
      sendResponse(state);

    } else if (msg.type === "RESET") {
      state.running  = false;
      state.session  = "work";
      state.total    = SESSIONS.work.duration;
      state.remaining = SESSIONS.work.duration;
      saveState(state);
      chrome.alarms.clear(ALARM_NAME);
      sendResponse(state);
    }
  })();

  return true; // keep channel open for async sendResponse
});