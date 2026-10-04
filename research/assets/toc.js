// Highlights the current section in the sticky table of contents. Page works without it.
(function () {
  try {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var targets = Object.keys(byId).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var current = null;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          if (current) current.classList.remove('active');
          current = byId[e.target.id];
          if (current) current.classList.add('active');
        }
      });
    }, { rootMargin: '0px 0px -75% 0px', threshold: 0 });
    targets.forEach(function (t) { obs.observe(t); });
    // Close the mobile table of contents after a jump.
    var det = document.querySelector('.toc-mobile');
    if (det) det.addEventListener('click', function (ev) {
      if (ev.target && ev.target.tagName === 'A') det.removeAttribute('open');
    });
  } catch (e) { /* non-essential */ }
})();
