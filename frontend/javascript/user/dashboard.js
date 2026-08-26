export function initUserDashboard({ renderRequests, showDashboardView }) {
  const dashboard = document.getElementById('user-dashboard');
  const sidebar = dashboard?.querySelector('.dashboard-sidebar');
  const menuToggle = document.getElementById('dashboard-menu-toggle');
  const menuClose = document.getElementById('dashboard-menu-close');
  const menuBackdrop = document.getElementById('dashboard-menu-backdrop');

  const closeMenu = () => {
    sidebar?.classList.remove('is-open');
    menuBackdrop?.classList.remove('is-visible');
    menuToggle?.setAttribute('aria-expanded', 'false');
  };

  menuToggle?.addEventListener('click', () => {
    const isOpen = sidebar?.classList.toggle('is-open') || false;
    menuBackdrop?.classList.toggle('is-visible', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
  menuClose?.addEventListener('click', closeMenu);
  menuBackdrop?.addEventListener('click', closeMenu);

  document.querySelector('[data-dashboard-view="dashboard-overview-view"]')?.addEventListener('click', () => {
    showDashboardView('dashboard-overview-view');
    closeMenu();
  });

  document.getElementById('dashboard-request-nav')?.addEventListener('click', () => {
    showDashboardView('dashboard-request-view');
    closeMenu();
  });

  document.getElementById('dashboard-refresh-nav')?.addEventListener('click', () => {
    renderRequests();
    showDashboardView('dashboard-access-view');
    closeMenu();
  });

  document.getElementById('dashboard-rejected-nav')?.addEventListener('click', () => {
    renderRequests();
    showDashboardView('dashboard-rejected-view');
    closeMenu();
  });

  document.getElementById('refresh-requests')?.addEventListener('click', renderRequests);
}
