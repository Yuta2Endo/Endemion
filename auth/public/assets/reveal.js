document.querySelectorAll("[data-reveal]").forEach((box) => {
  box.addEventListener("change", () => {
    const input = document.getElementById(box.dataset.reveal);
    if (input) input.type = box.checked ? "text" : "password";
  });
});
