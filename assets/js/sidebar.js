/* ============================================================
   PGP GLASS — Sidebar and Top Navigation Controller
   ============================================================ */

const Sidebar = {
  init() {
    const sidebar = document.getElementById('app-sidebar');
    const mainContent = document.getElementById('app-main');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const mobileToggleBtn = document.getElementById('mobile-sidebar-toggle');
    const overlay = document.getElementById('sidebar-overlay');

    // Load saved sidebar state (collapsed vs expanded) for desktop
    if (window.innerWidth > 768) {
      const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
      if (isCollapsed && sidebar && mainContent) {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('sidebar-collapsed');
      }
    }

    // Toggle click handler (collapses on desktop, closes menu drawer on mobile)
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          if (sidebar && overlay) {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
          }
        } else {
          if (sidebar && mainContent) {
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('sidebar-collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('sidebar-collapsed', isCollapsed);
            
            // Trigger resize event for charts after layout transition completes (280ms)
            setTimeout(() => {
              window.dispatchEvent(new Event('resize'));
            }, 300);
          }
        }
      });
    }

    // Mobile menu expand handler
    if (mobileToggleBtn && sidebar && overlay) {
      mobileToggleBtn.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('active');
      });
    }

    // Overlay click to close mobile menu
    if (overlay && sidebar) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('active');
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // If app.js is not loaded on this page, fall back to auto-init
  if (typeof AppShell === 'undefined') {
    Sidebar.init();
  }
});
