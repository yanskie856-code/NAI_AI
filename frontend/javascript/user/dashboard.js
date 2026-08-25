export function initUserDashboard({ renderRequests, showDashboardView }) {
  document.querySelector('[data-dashboard-view="dashboard-overview-view"]')?.addEventListener('click', () => {
    showDashboardView('dashboard-overview-view');
  });

  document.getElementById('dashboard-request-nav')?.addEventListener('click', () => {
    showDashboardView('dashboard-request-view');
  });

  document.getElementById('dashboard-refresh-nav')?.addEventListener('click', () => {
    renderRequests();
    showDashboardView('dashboard-access-view');
  });

  document.getElementById('refresh-requests')?.addEventListener('click', renderRequests);
}
