(function () {
  const toggle = document.getElementById("mobile-nav-toggle");
  const backdrop = document.getElementById("nav-backdrop");
  if (!toggle) return;

  function setOpen(open) {
    document.body.classList.toggle("nav-open", open);
    toggle.textContent = open ? "Close" : "Menu";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  toggle.addEventListener("click", function () {
    setOpen(!document.body.classList.contains("nav-open"));
  });

  backdrop?.addEventListener("click", function () {
    setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  document.querySelectorAll(".sidebar a").forEach((link) => {
    link.addEventListener("click", function () {
      if (window.innerWidth <= 980) {
        setOpen(false);
      }
    });
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 980) {
      setOpen(false);
    }
  });
})();
