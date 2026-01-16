const form = document.getElementById("login-form");
const user = document.getElementById("user");
const pass = document.getElementById("pass");
const errEl = document.getElementById("error");

if (typeof anime !== "undefined") {
  const particles = document.querySelectorAll(".particle");
  particles.forEach((particle, i) => {
    anime({
      targets: particle,
      translateX: () => anime.random(-100, 100),
      translateY: () => anime.random(-100, 100),
      scale: () => anime.random(0.5, 1.5),
      opacity: [0, 0.6, 0],
      duration: () => anime.random(3000, 6000),
      delay: i * 200,
      easing: "easeInOutQuad",
      loop: true,
    });
  });

  anime
    .timeline()
    .add({
      targets: ".login-card",
      opacity: [0, 1],
      translateY: [30, 0],
      duration: 800,
      easing: "easeOutExpo",
    })
    .add(
      {
        targets: ".login-crown-wrapper",
        scale: [0, 1],
        rotate: [180, 0],
        duration: 600,
        easing: "easeOutBack",
      },
      "-=400",
    )
    .add(
      {
        targets: ".login-brand",
        opacity: [0, 1],
        translateY: [-10, 0],
        duration: 500,
        easing: "easeOutQuad",
      },
      "-=300",
    )
    .add(
      {
        targets: ".login-title, .login-subtitle",
        opacity: [0, 1],
        translateY: [10, 0],
        duration: 500,
        delay: anime.stagger(100),
        easing: "easeOutQuad",
      },
      "-=300",
    )
    .add(
      {
        targets: ".form-group",
        opacity: [0, 1],
        translateY: [15, 0],
        duration: 500,
        delay: anime.stagger(100),
        easing: "easeOutQuad",
      },
      "-=300",
    )
    .add(
      {
        targets: ".login-btn",
        opacity: [0, 1],
        scale: [0.95, 1],
        duration: 400,
        easing: "easeOutQuad",
      },
      "-=200",
    );

  anime({
    targets: ".login-crown",
    scale: [1, 1.1, 1],
    duration: 2000,
    easing: "easeInOutQuad",
    loop: true,
  });

  const loginBtn = document.querySelector(".login-btn");
  if (loginBtn) {
    let particleInterval = 100;
    let currentInterval;
    let isHovering = false;

    function createParticle() {
      const btnRect = loginBtn.getBoundingClientRect();
      const particle = document.createElement("div");
      particle.className = "login-btn-particle";

      const edge = Math.random();
      let startX, startY, moveX, moveY;

      if (edge < 0.7) {
        startX = btnRect.left + Math.random() * btnRect.width;
        startY = btnRect.bottom;
        moveX = anime.random(-20, 20);
        moveY = anime.random(40, 80);
      } else if (edge < 0.8) {
        startX = btnRect.left;
        startY = btnRect.top + Math.random() * btnRect.height;
        moveX = anime.random(-50, -25);
        moveY = anime.random(-15, 25);
      } else if (edge < 0.9) {
        startX = btnRect.right;
        startY = btnRect.top + Math.random() * btnRect.height;
        moveX = anime.random(25, 50);
        moveY = anime.random(-15, 25);
      } else {
        startX = btnRect.left + Math.random() * btnRect.width;
        startY = btnRect.top;
        moveX = anime.random(-25, 25);
        moveY = anime.random(-50, -25);
      }

      const size = anime.random(3, 7);
      particle.style.width = size + "px";
      particle.style.height = size + "px";
      particle.style.left = startX + "px";
      particle.style.top = startY + "px";

      document.body.appendChild(particle);

      anime({
        targets: particle,
        translateX: [0, moveX],
        translateY: [0, moveY],
        opacity: [0, 0.9, 0.7, 0],
        scale: [0.5, 1, 0.8, 0.3],
        rotate: anime.random(-180, 180),
        duration: anime.random(1200, 2000),
        easing: "easeOutQuad",
        complete: () => particle.remove(),
      });
    }

    function startParticles(interval) {
      if (currentInterval) clearInterval(currentInterval);
      currentInterval = setInterval(createParticle, interval);
    }

    startParticles(particleInterval);

    loginBtn.addEventListener("mouseenter", () => {
      isHovering = true;
      startParticles(40);
    });

    loginBtn.addEventListener("mouseleave", () => {
      isHovering = false;
      startParticles(particleInterval);
    });
  }

  document.querySelectorAll(".input-animated input").forEach((input) => {
    input.addEventListener("focus", (e) => {
      anime({
        targets: e.target.parentElement,
        scale: [1, 1.02],
        duration: 200,
        easing: "easeOutQuad",
      });
    });

    input.addEventListener("blur", (e) => {
      anime({
        targets: e.target.parentElement,
        scale: [1.02, 1],
        duration: 200,
        easing: "easeOutQuad",
      });
    });
  });
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.textContent = "";

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (typeof anime !== "undefined" && submitBtn) {
    anime({
      targets: submitBtn,
      scale: [1, 0.95, 1],
      duration: 300,
      easing: "easeInOutQuad",
    });
  }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: user.value, pass: pass.value }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Invalid credentials");
    }

    const data = await res.json();

    if (data.user && data.user.mustChangePassword) {
      sessionStorage.setItem("temp_token", data.token);
      sessionStorage.setItem("temp_user", JSON.stringify(data.user));

      window.location.href = "/change-password.html";
    } else {
      window.location.href = "/";
    }
  } catch (err) {
    errEl.textContent = err.message || "Login failed";

    if (typeof anime !== "undefined") {
      anime({
        targets: ".login-card",
        translateX: [
          { value: -10, duration: 100 },
          { value: 10, duration: 100 },
          { value: -10, duration: 100 },
          { value: 10, duration: 100 },
          { value: 0, duration: 100 },
        ],
        easing: "easeInOutQuad",
      });

      anime({
        targets: "#error",
        opacity: [0, 1],
        translateY: [-5, 0],
        duration: 300,
        easing: "easeOutQuad",
      });
    }
  }
});
