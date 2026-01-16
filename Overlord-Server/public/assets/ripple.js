function addRippleEffect(element) {
  element.classList.add("ripple");

  element.addEventListener("click", function (e) {
    this.classList.remove("ripple-active");

    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.style.setProperty("--x", x + "px");
    this.style.setProperty("--y", y + "px");

    void this.offsetWidth;

    this.classList.add("ripple-active");

    setTimeout(() => {
      this.classList.remove("ripple-active");
    }, 600);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll("button:not(.no-ripple), .button:not(.no-ripple)")
    .forEach((btn) => {
      addRippleEffect(btn);
    });
});

window.addRippleEffect = addRippleEffect;
