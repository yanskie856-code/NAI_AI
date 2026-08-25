export function initAdminDashboard({ renderAdminRequests, showAdminView }) {
  document.getElementById('refresh-admin-requests')?.addEventListener('click', renderAdminRequests);

  document.querySelectorAll('.admin-nav').forEach(button => {
    button.addEventListener('click', () => showAdminView(button.dataset.adminView));
  });
}
