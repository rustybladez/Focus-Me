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
  const display       = document.getElementById("timer-display");
  const sessionLabel  = document.getElementById("session-label");
  const progressBar   = document.getElementById("progress-bar");
  const btnStart      = document.getElementById("btn-start");
  const btnReset      = document.getElementById("btn-reset");
  const statusText    = document.getElementById("status-text");

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

    btnStart.textContent = state.running ? "Pause" : (state.remaining < state.total ? "Resume" : "Start");

    if (!state.running && state.remaining === state.total) {
      statusText.textContent = "Ready";
    } else if (state.running) {
      statusText.textContent = isBreak ? "Resting…" : "Focusing…";
    } else {
      statusText.textContent = "Paused";
    }
  }

  // ── Send command to background, re-render with returned state ───────
  function send(type) {
    chrome.runtime.sendMessage({ type }, (state) => {
      if (state) render(state);
    });
  }

  // ── Button listeners ─────────────────────────────────────────────────
  btnStart.addEventListener("click", () => {
    // Ask background for current state to decide start vs pause
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
      send(state.running ? "PAUSE" : "START");
    });
  });

  btnReset.addEventListener("click", () => send("RESET"));

  // ── Live updates while popup is open ─────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATE_UPDATE") render(msg.state);
  });

  // ── Bootstrap: load current state immediately on open ────────────────
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (state) render(state);
  });
});