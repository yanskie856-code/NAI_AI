export function initAdminDashboard({ renderAdminRequests, showAdminView }) {
  const dashboard = document.getElementById('admin-portal');
  const sidebar = dashboard?.querySelector('.admin-sidebar');
  const menuToggle = document.getElementById('admin-menu-toggle');
  const menuClose = document.getElementById('admin-menu-close');
  const menuBackdrop = document.getElementById('admin-menu-backdrop');
  const closeMenu = () => {
    sidebar?.classList.remove('is-open');
    menuBackdrop?.classList.remove('is-visible');
    menuToggle?.setAttribute('aria-expanded', 'false');
    dashboard?.classList.remove('admin-menu-open');
  };
  menuToggle?.addEventListener('click', () => {
    const isOpen = sidebar?.classList.toggle('is-open') || false;
    menuBackdrop?.classList.toggle('is-visible', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    dashboard?.classList.toggle('admin-menu-open', isOpen);
  });
  menuClose?.addEventListener('click', closeMenu);
  menuBackdrop?.addEventListener('click', closeMenu);
  document.getElementById('refresh-admin-requests')?.addEventListener('click', renderAdminRequests);

  document.querySelectorAll('.admin-nav').forEach(button => {
    button.addEventListener('click', () => {
      showAdminView(button.dataset.adminView);
      closeMenu();
    });
  });
}
