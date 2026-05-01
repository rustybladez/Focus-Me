// popup.js — display only. All timer logic lives in background.js.

document.addEventListener("DOMContentLoaded", () => {

  // ── Original: status dot pulse ─────────────────────────────────────
  const statusDot = document.getElementById("status");
  let dotVisible = true;
  setInterval(() => {
    dotVisible = !dotVisible;
    statusDot.style.opacity = dotVisible ? "1" : "0.3";
  }, 800);

  // ── DOM refs ────────────────────────────────────────────────────────
  const display          = document.getElementById("timer-display");
  const sessionLabel     = document.getElementById("session-label");
  const progressBar      = document.getElementById("progress-bar");
  const btnStart         = document.getElementById("btn-start");
  const btnReset         = document.getElementById("btn-reset");
  const statusText       = document.getElementById("status-text");
  const hardModeCheckbox = document.getElementById("hard-mode-checkbox");

  // ── Helpers ─────────────────────────────────────────────────────────
  function pad(n) { return String(n).padStart(2, "0"); }

  function formatTime(secs) {
    return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  }

  function render(state) {
    const isBreak = state.session === "break";

    display.textContent = formatTime(state.remaining);
    display.classList.toggle("break", isBreak);

    progressBar.style.width = `${(state.remaining / state.total) * 100}%`;
    progressBar.classList.toggle("break", isBreak);

    sessionLabel.textContent = isBreak ? "Break Session" : "Work Session";

    btnStart.textContent = state.running
      ? "Pause"
      : (state.remaining < state.total ? "Resume" : "Start");

    if (!state.running && state.remaining === state.total) {
      statusText.textContent = "Ready";
    } else if (state.running) {
      statusText.textContent = isBreak ? "Resting…" : "Focusing…";
    } else {
      statusText.textContent = "Paused";
    }

    // Sync hard mode toggle if state carries it (GET_STATE response)
    if (typeof state.hardMode === "boolean") {
      hardModeCheckbox.checked = state.hardMode;
    }
  }

  // ── Send command to background, re-render with returned state ───────
  function send(type, extra = {}) {
    chrome.runtime.sendMessage({ type, ...extra }, (state) => {
      if (state) render(state);
    });
  }

  // ── Button listeners ─────────────────────────────────────────────────
  btnStart.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
      if (state.running) {
        send("PAUSE");
      } else {
        // FIX: query the active tab HERE in popup context.
        // The service worker has no "current window", so querying from there
        // always returns an empty array — the root cause of the bug.
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id ?? null;
          send("START", { tabId });
        });
      }
    });
  });

  btnReset.addEventListener("click", () => send("RESET"));

  // ── Hard Mode toggle ─────────────────────────────────────────────────
  hardModeCheckbox.addEventListener("change", () => {
    chrome.runtime.sendMessage({
      type: "SET_HARD_MODE",
      value: hardModeCheckbox.checked,
    });
  });

  // ── Live updates while popup is open ─────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATE_UPDATE") render(msg.state);
  });

  // ── Bootstrap: load current state immediately on open ────────────────
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (state) render(state);
  });
});