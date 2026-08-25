async function loadDashboardFragment(path, rootId) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  const template = document.createElement('template');
  template.innerHTML = await response.text();
  const fragmentRoot = template.content.querySelector(`#${rootId}`);
  const currentRoot = document.getElementById(rootId);
  if (!fragmentRoot || !currentRoot) throw new Error(`Missing dashboard root: ${rootId}`);
  currentRoot.replaceWith(fragmentRoot);
}

try {
  await Promise.all([
    loadDashboardFragment('dashboard/user.html', 'user-dashboard'),
    loadDashboardFragment('dashboard/admin.html', 'admin-portal')
  ]);
  await import('./script.js');
} catch (error) {
  console.error('Dashboard fragments could not be loaded.', error);
}
