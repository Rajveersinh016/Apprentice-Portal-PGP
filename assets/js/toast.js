/* ============================================================
   PGP GLASS — Toast Notification Manager
   ============================================================ */

const Toast = {
  container: null,

  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(title, message, type = 'info', duration = 4000) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    
    // Choose icon based on toast type
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'warning') iconClass = 'fa-exclamation-triangle';
    if (type === 'danger' || type === 'error') {
      iconClass = 'fa-exclamation-circle';
      toast.className = `toast-item toast-danger`; // Normalize error to danger
    }

    toast.innerHTML = `
      <div class="toast-icon">
        <i class="fas ${iconClass}"></i>
      </div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close">
        <i class="fas fa-times"></i>
      </button>
      <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
    `;

    this.container.appendChild(toast);

    // Click handler to close manually
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.remove(toast));

    // Auto dismiss
    const timer = setTimeout(() => {
      this.remove(toast);
    }, duration);

    toast.dataset.timerId = timer;
  },

  remove(toast) {
    if (toast.classList.contains('removing')) return;
    
    // Clear auto-dismiss timer in case of manual click
    if (toast.dataset.timerId) {
      clearTimeout(parseInt(toast.dataset.timerId, 10));
    }

    toast.classList.add('removing');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  },

  // Helper shortcuts
  success(title, message, duration) { this.show(title, message, 'success', duration); },
  error(title, message, duration) { this.show(title, message, 'error', duration); },
  warning(title, message, duration) { this.show(title, message, 'warning', duration); },
  info(title, message, duration) { this.show(title, message, 'info', duration); }
};
