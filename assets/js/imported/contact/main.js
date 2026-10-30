// Golden Crumb Bakery — shared interactions (demo only, no backend)
(function () {
  // Mobile nav
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
  }

  // Footer year
  document.querySelectorAll('[data-year]').forEach(el => (el.textContent = new Date().getFullYear()));

  // Toast helper
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);
  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // Order basket (stored per browser so the count carries across pages)
  const KEY = 'goldenCrumbBasket';
  function readCount() {
    try { return parseInt(localStorage.getItem(KEY) || '0', 10); } catch (e) { return 0; }
  }
  function writeCount(n) {
    try { localStorage.setItem(KEY, String(n)); } catch (e) { /* storage unavailable */ }
  }
  let count = readCount();
  const badges = document.querySelectorAll('.cart-count');
  const renderCount = () => badges.forEach(b => (b.textContent = count));
  renderCount();

  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      count += 1;
      writeCount(count);
      renderCount();
      showToast(`${btn.dataset.add} added to your order 🥐`);
    });
  });

  // Product filters
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.filter;
      document.querySelectorAll('[data-category]').forEach(card => {
        card.hidden = f !== 'all' && !card.dataset.category.split(' ').includes(f);
      });
    });
  });

  // Forms (demo: no data leaves the page)
  document.querySelectorAll('form[data-demo]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const success = form.querySelector('.form-success');
      if (success) success.classList.add('show');
      else showToast(form.dataset.demo);
      form.reset();
    });
  });

  // Highlight today in the opening hours table
  const today = new Date().getDay();
  document.querySelectorAll('.hours tr[data-day]').forEach(row => {
    if (row.dataset.day.split(',').map(Number).includes(today)) row.classList.add('today');
  });

  // Reveal on scroll
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('visible'));
  }
})();
