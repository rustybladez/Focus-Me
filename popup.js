document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");

  // Animate the status dot
  let visible = true;
  setInterval(() => {
    visible = !visible;
    status.style.opacity = visible ? "1" : "0.3";
  }, 800);
});
