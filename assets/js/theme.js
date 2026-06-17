/* ============================================================
   PGP GLASS — Theme & Security Management (Light Mode Standard)
   ============================================================ */

const themeToggle = {
  applyTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', 'light');
    window.dispatchEvent(new CustomEvent('themechanged', { detail: { theme: 'light' } }));
  },
  toggleTheme: () => {
    themeToggle.applyTheme('light');
  }
};

// Immediately apply theme before DOM content loads to avoid flicker
(function() {
  localStorage.setItem('theme', 'light');
  document.documentElement.setAttribute('data-theme', 'light');
})();

document.addEventListener('DOMContentLoaded', () => {
  themeToggle.applyTheme('light');
  localStorage.setItem('theme', 'light');
});

// ============================================================
// GLOBAL FETCH INTERCEPTOR (401 Auto-Redirect & Offline Checks)
// ============================================================
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  if (!navigator.onLine) {
    return Promise.reject(new Error('You are currently offline. Please check your network connection.'));
  }

  try {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
    const isLoginRequest = url.includes('/api/auth/login');

    if (response.status === 401 && !isLoginRequest) {
      // Session Expired - Clear all potential auth keys
      localStorage.removeItem('pgp_token');
      localStorage.removeItem('pgp_role');
      localStorage.removeItem('pgp_branch');
      localStorage.removeItem('pgp_user_name');
      localStorage.removeItem('pgp_user_email');
      localStorage.removeItem('pgp_location');
      localStorage.removeItem('pgp_name');

      const currentPath = window.location.pathname;
      if (!currentPath.endsWith('index.html') && currentPath !== '/' && currentPath !== '') {
        const redirectUrl = currentPath.includes('/pages/') ? '../index.html?session_expired=true' : 'index.html?session_expired=true';
        window.location.href = redirectUrl;
      }
    } else if (response.ok) {
      // Perform schema & structure validation checks on response
      validateApiResponse(response, url);
    }
    return response;
  } catch (error) {
    if (!navigator.onLine) {
      return Promise.reject(new Error('Network connection lost. Please check your network connection.'));
    }
    return Promise.reject(error);
  }
};

async function validateApiResponse(response, url) {
  try {
    if (!response.ok) return;

    if (url.includes('/api/apprentices')) {
      const cloned = response.clone();
      const data = await cloned.json();
      if (!data || typeof data !== 'object' || data.success === undefined) {
        triggerUnexpectedToast();
        return;
      }
      
      const pathOnly = url.split('?')[0];
      if (pathOnly.endsWith('/api/apprentices')) {
        if (!Array.isArray(data.apprentices)) {
          triggerUnexpectedToast();
        }
      } else if (/\/api\/apprentices\/[a-zA-Z0-9_-]+$/.test(pathOnly)) {
        if (data.success && (!data.apprentice || typeof data.apprentice !== 'object')) {
          triggerUnexpectedToast();
        }
      }
    } else if (url.includes('/api/users')) {
      const cloned = response.clone();
      const data = await cloned.json();
      if (!data || typeof data !== 'object' || data.success === undefined) {
        triggerUnexpectedToast();
        return;
      }
      
      const pathOnly = url.split('?')[0];
      if (pathOnly.endsWith('/api/users')) {
        if (!Array.isArray(data.users)) {
          triggerUnexpectedToast();
        }
      }
    } else if (url.includes('/api/reports/preview')) {
      const cloned = response.clone();
      const data = await cloned.json();
      if (!data || typeof data !== 'object' || data.success === undefined || typeof data.count !== 'number') {
        triggerUnexpectedToast();
      }
    } else if (url.includes('/api/reports/export')) {
      const cloned = response.clone();
      const blob = await cloned.blob();
      if (!blob || blob.size === 0) {
        triggerUnexpectedToast();
      }
    }
  } catch (err) {
    console.error('API Validation Error:', err);
    triggerUnexpectedToast();
  }
}

function triggerUnexpectedToast() {
  if (typeof Toast !== 'undefined' && Toast.warning) {
    Toast.warning('System Warning', 'Unexpected server response.');
  } else {
    console.warn('Unexpected server response.');
  }
}

// ============================================================
// GLOBAL ERROR BOUNDARY OVERLAY (Slate premium design)
// ============================================================
window.addEventListener('error', (event) => {
  // Ignore minor third-party resource load errors
  if (event.message && (event.message.includes('Script error') || event.message.includes('ResizeObserver'))) return;
  showErrorOverlay(event.error || new Error(event.message || 'Unknown Javascript error occurred.'));
});

window.addEventListener('unhandledrejection', (event) => {
  // Ignore minor unhandled rejections that might not affect UI stability
  const reason = event.reason || 'Unhandled promise rejection';
  const reasonStr = typeof reason === 'object' ? (reason.message || '') : String(reason);
  if (reasonStr.includes('ResizeObserver') || reasonStr.includes('navigation')) return;
  showErrorOverlay(reason instanceof Error ? reason : new Error(reasonStr));
});

function showErrorOverlay(error) {
  if (document.getElementById('error-boundary-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'error-boundary-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
  overlay.style.backdropFilter = 'blur(10px)';
  overlay.style.zIndex = '999999';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  overlay.style.color = '#f8fafc';
  overlay.style.padding = '24px';

  const container = document.createElement('div');
  container.style.maxWidth = '550px';
  container.style.width = '100%';
  container.style.backgroundColor = '#1e293b';
  container.style.border = '1px solid #334155';
  container.style.borderRadius = '16px';
  container.style.padding = '36px';
  container.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.5)';
  container.style.textAlign = 'center';

  container.innerHTML = `
    <div style="width: 64px; height: 64px; background-color: rgba(239, 68, 68, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </div>
    <h2 style="font-size: 22px; font-weight: 700; margin: 0 0 8px 0; color: #f1f5f9; letter-spacing: -0.025em;">Application Error</h2>
    <p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">An uncaught script error has crashed the interface. The system has paused to protect database integrity.</p>
    
    <div style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; text-align: left; margin-bottom: 28px; max-height: 160px; overflow-y: auto;">
      <code style="font-family: 'Fira Code', 'Courier New', Courier, monospace; font-size: 12px; color: #f43f5e; word-break: break-all; white-space: pre-wrap;">${escapeHtml(error.stack || error.message || error)}</code>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: center;">
      <button onclick="window.location.reload()" style="background-color: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.2);">
        Reload Portal
      </button>
      <button onclick="document.getElementById('error-boundary-overlay').remove()" style="background-color: transparent; border: 1px solid #475569; color: #94a3b8; padding: 12px 20px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; transition: all 0.2s;">
        Dismiss
      </button>
    </div>
  `;

  overlay.appendChild(container);
  document.body.appendChild(overlay);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
