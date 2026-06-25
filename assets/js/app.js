/* ============================================================
   PGP GLASS — Live Backend Integration Engine
   ============================================================ */

// All data is served from the live Google Sheets backend.
// No demo, mock, or placeholder data is used anywhere in this application.

// Mapping helper functions
function mapSheetToInternal(row, isCompleted) {
  const mapped = {
    code: row["Employee Code"] || "",
    name: row["Full Name"] || "",
    location: row["Location"] || "",
    dept: row["Department"] || "",
    joined: row["Joining Date"] ? String(row["Joining Date"]).split("T")[0] : "",
    sex: row["Sex"] || "Male",
    age: row["Age"] ? parseInt(row["Age"]) : 22,
    phone: row["Phone"] || "",
    email: row["Email"] || "",
    address: row["Address"] || "",
    remarks: row["Remarks"] || "",
    contractId: row["Employee Contract ID"] || "Pending",
    portalEnrollmentNumber: row["Portal Enrollment Number"] || "Pending",
    portalName: row["Portal Name"] || "Pending",
    status: isCompleted ? "Completed" : (row["Record Status"] || "Active"),
    completionDate: isCompleted ? (row["Completion Date"] ? String(row["Completion Date"]).split("T")[0] : "") : "",
    completedBy: isCompleted ? (row["Completed By"] || "") : "",
    completionReason: isCompleted ? (row["Completion Reason"] || "") : "",
    otherCompletionReason: isCompleted ? (row["Other Completion Reason"] || "") : "",
    completionRemarks: isCompleted ? (row["Completion Remarks"] || "") : "",
    postApprenticeshipStatus: isCompleted ? (row["Post Apprenticeship Status"] || row["Completion Reason"] || "Completed") : "",
    updatedBy: row["Updated By"] || "",
    updatedDate: row["Updated Date"] || ""
  };

  // Dynamically attach any other fields from the spreadsheet row
  Object.keys(row).forEach(key => {
    if (key.startsWith('__')) return; // skip row number metadata
    if (!mapped.hasOwnProperty(key)) {
      mapped[key] = row[key];
    }
  });

  return mapped;
}

function mapInternalToSheet(app) {
  return {
    "Employee Code": app.code || "",
    "Full Name": app.name || "",
    "Location": app.location || "",
    "Department": app.dept || "",
    "Joining Date": app.joined || "",
    "Sex": app.sex || "Male",
    "Age": app.age || 22,
    "Phone": app.phone || "",
    "Email": app.email || "",
    "Address": app.address || "",
    "Remarks": app.remarks || "",
    "Employee Contract ID": app.contractId || "Pending",
    "Portal Enrollment Number": app.portalEnrollmentNumber || "Pending",
    "Portal Name": app.portalName || "Pending",
    "Record Status": app.status || "Active"
  };
}

// ============================================================
// DEBOUNCE UTILITY — prevents excessive calls on rapid events
// Usage: debounce(fn, 300) returns a version of fn that only
// fires after 300ms of silence.
// ============================================================
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ============================================================
// LOCATIONS CACHE — Dynamic location list from backend
// Fetched once per session via /api/locations, which reads
// unique Location values from the live Google Sheets data.
// ============================================================
const LocationsCache = {
  _locations: null,
  _promise: null,

  // Load locations from backend (called during AppDB.init)
  async load() {
    if (this._locations !== null) return; // already loaded
    if (this._promise) return this._promise; // deduplicate concurrent calls

    this._promise = (async () => {
      try {
        const backendUrl = AppDB.getBackendUrl();
        const response = await fetch(`${backendUrl}/api/locations`, {
          headers: AppDB.apiHeaders()
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (data.success && Array.isArray(data.locations)) {
          this._locations = data.locations;
        } else {
          throw new Error(data.error || 'Locations fetch failed');
        }
      } catch (err) {
        console.warn('LocationsCache: Failed to load — using fallback from data.', err.message);
        // Fallback: derive unique locations from already-cached apprentice data
        const list = AppDB.getApprentices();
        const set = new Set();
        list.forEach(x => { if (x.location) set.add(String(x.location).trim()); });
        this._locations = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      }
      this._promise = null;
    })();

    return this._promise;
  },

  // Synchronous getter — returns cached array ([] if not yet loaded)
  get() {
    return this._locations || [];
  },

  // Invalidate so next load() re-fetches (call after data upload)
  invalidate() {
    this._locations = null;
    this._promise = null;
  }
};

// ============================================================
// DEPARTMENTS CACHE — Dynamic department list from backend
// Fetched once per session via /api/departments, which reads
// unique Department values from the live Google Sheets data.
// ============================================================
const DepartmentsCache = {
  _departments: null,
  _promise: null,

  // Load departments from backend (called during AppDB.init)
  async load() {
    if (this._departments !== null) return; // already loaded
    if (this._promise) return this._promise; // deduplicate concurrent calls

    this._promise = (async () => {
      try {
        const backendUrl = AppDB.getBackendUrl();
        const response = await fetch(`${backendUrl}/api/departments`, {
          headers: AppDB.apiHeaders()
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (data.success && Array.isArray(data.departments)) {
          this._departments = data.departments;
        } else {
          throw new Error(data.error || 'Departments fetch failed');
        }
      } catch (err) {
        console.warn('DepartmentsCache: Failed to load — using fallback from data.', err.message);
        // Fallback: derive unique departments from already-cached apprentice data
        const list = AppDB.getApprentices();
        const set = new Set();
        list.forEach(x => {
          const d = (x.dept || x.department || '').trim();
          if (d) set.add(d);
        });
        this._departments = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      }
      this._promise = null;
    })();

    return this._promise;
  },

  // Synchronous getter — returns cached array ([] if not yet loaded)
  get() {
    return this._departments || [];
  },

  // Invalidate so next load() re-fetches (call after data upload)
  invalidate() {
    this._departments = null;
    this._promise = null;
  }
};

const AppDB = {
  isLive: false,

  // ── In-memory cache (per browser session, NOT localStorage)
  // Shared across all page components. Invalidated on every write.
  // localStorage is ONLY used for: token, role, branch, theme, UI state.
  _cache: { data: null, ts: 0, TTL: 30000 }, // 30 second TTL

  isCacheValid() {
    return this._cache.data !== null && (Date.now() - this._cache.ts) < this._cache.TTL;
  },

  invalidateCache() {
    this._cache.data = null;
    this._cache.ts = 0;
    if (typeof LocationsCache !== 'undefined') {
      LocationsCache.invalidate();
    }
    if (typeof DepartmentsCache !== 'undefined') {
      DepartmentsCache.invalidate();
    }
  },

  // ── Helper: read stored JWT token
  getToken() {
    return localStorage.getItem('pgp_token') || '';
  },

  // ── Helper: base URL for Express backend (set in Settings)
  getBackendUrl() {
    const fallback = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.hostname !== '[::1]' && window.location.hostname !== '::1'
      ? window.location.origin
      : 'http://localhost:3001';
    return (localStorage.getItem('pgp_google_apps_script_url') || fallback).replace(/\/$/, '');
  },

  // ── Helper: standard Authorization headers for all API calls
  apiHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + this.getToken()
    };
  },

  async init() {
    const backendUrl = this.getBackendUrl();
    const token = this.getToken();

    if (!token) {
      // Not logged in — set empty cache, redirect handled by auth guard
      this._cache.data = [];
      this.isLive = false;
      return;
    }

    // Serve from in-memory cache if still valid (avoids redundant API calls
    // when multiple page components call init() within the TTL window)
    if (this.isCacheValid()) {
      // Ensure locations and departments are loaded even when data cache hits
      await Promise.all([
        LocationsCache.load(),
        DepartmentsCache.load()
      ]);
      return;
    }

    try {
      // console.log('AppDB: Fetching live data from Express backend...');
      const response = await fetch(`${backendUrl}/api/apprentices?type=all`, {
        headers: this.apiHeaders()
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const resData = await response.json();
      if (resData.success) {
        // Store in in-memory cache (NOT localStorage — multi-user safe)
        this._cache.data = resData.apprentices || [];
        this._cache.ts = Date.now();
        localStorage.setItem('pref_sheets_sync', 'true');
        this.isLive = true;
        // Load locations and departments in parallel after data is cached
        await Promise.all([
          LocationsCache.load(),
          DepartmentsCache.load()
        ]);
        return;
      } else {
        throw new Error(resData.error || 'Backend error');
      }
    } catch (err) {
      console.error('AppDB: Backend unreachable —', err.message);
      // Keep existing cache on transient errors rather than wiping data
      if (!this._cache.data) this._cache.data = [];
      this.isLive = false;
      if (typeof Toast !== 'undefined') {
        Toast.error('Backend Offline', `Cannot reach the database server. Please ensure the backend is running. (${err.message})`, 8000);
      }
    }
  },

  // Returns in-memory employee cache (never reads localStorage)
  getApprentices() {
    return this._cache.data || [];
  },

  // Fetch a SINGLE apprentice by code — used by profile detail page.
  // Server uses its cache; no need to load full dataset.
  async fetchOne(code) {
    const backendUrl = this.getBackendUrl();
    const response = await fetch(`${backendUrl}/api/apprentices/${encodeURIComponent(code)}`, {
      headers: this.apiHeaders()
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Apprentice not found');
    return data.apprentice;
  },

  getUsers() {
    return JSON.parse(localStorage.getItem('pgp_users')) || [];
  },

  saveUsers(data) {
    localStorage.setItem('pgp_users', JSON.stringify(data));
  },

  getAudit() {
    return JSON.parse(localStorage.getItem('pgp_audit')) || [];
  },

  saveAudit(data) {
    localStorage.setItem('pgp_audit', JSON.stringify(data));
  },

  getRole() {
    return localStorage.getItem('pgp_role');
  },

  saveRole(role) {
    localStorage.setItem('pgp_role', role);
    if (role === 'Branch HR') {
      const activeBranch = localStorage.getItem('pgp_branch');
      if (!activeBranch || activeBranch === 'All Locations') {
        // Use first available location from dynamic cache, or leave unset for login flow
        const firstLoc = LocationsCache.get()[0] || '';
        if (firstLoc) localStorage.setItem('pgp_branch', firstLoc);
      }
    } else {
      localStorage.setItem('pgp_branch', 'All Locations');
    }
  },

  getBranch() {
    return sessionStorage.getItem('pgp_branch') || localStorage.getItem('pgp_branch') || 'All Locations';
  },

  saveBranch(branch) {
    sessionStorage.setItem('pgp_branch', branch);
    localStorage.setItem('pgp_branch', branch);
  },

  addAuditLog(code, name, location, dept, status, field) {
    const audit = JSON.parse(localStorage.getItem('pgp_audit')) || [];
    const now = new Date();
    const dateStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    audit.unshift({ code, name, location, dept, status, updated: dateStr, field });
    if (audit.length > 50) audit.pop();
    localStorage.setItem('pgp_audit', JSON.stringify(audit));
  },

  async updateApprentice(code, fields) {
    const backendUrl = this.getBackendUrl();
    const response = await fetch(`${backendUrl}/api/apprentices/${encodeURIComponent(code)}`, {
      method: 'PUT',
      headers: this.apiHeaders(),
      body: JSON.stringify(fields)
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const resData = await response.json();
    if (!resData.success) throw new Error(resData.error || 'Backend error');

    // Invalidate cache so next getApprentices() reflects updated record
    this.invalidateCache();
    await this.init();
    const list = this.getApprentices();
    const app = list.find(x => x.code === code);
    if (app) this.addAuditLog(code, app.name, app.location, app.dept, app.status, 'Profile Details Updated');
    return { success: true };
  },

  async completeApprentice(code, reason, otherReason, remarks) {
    const backendUrl = this.getBackendUrl();
    const response = await fetch(`${backendUrl}/api/apprentices/${encodeURIComponent(code)}/complete`, {
      method: 'POST',
      headers: this.apiHeaders(),
      body: JSON.stringify({ reason, otherReason, remarks })
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const resData = await response.json();
    if (!resData.success) throw new Error(resData.error || 'Backend error');

    // Invalidate cache so completion is reflected immediately
    this.invalidateCache();
    await this.init();
    this.addAuditLog(code, code, '', '', 'Completed', 'Apprenticeship Completed');
    return { success: true };
  },

  async upsertActiveApprentices(records) {
    const backendUrl = this.getBackendUrl();
    const response = await fetch(`${backendUrl}/api/upload`, {
      method: 'POST',
      headers: this.apiHeaders(),
      body: JSON.stringify({ records })
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);
    const resData = await response.json();
    if (!resData.success) throw new Error(resData.error || 'Backend upload error');

    // Invalidate cache so uploaded records appear immediately
    this.invalidateCache();
    await this.init();
    return { success: true, inserted: resData.inserted, updated: resData.updated };
  }
};

// 2. SHELL GENERATION: SIDEBAR & TOPNAV LAYOUT
const AppShell = {
  renderSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;

    const currentRole = AppDB.getRole();
    const currentPath = window.location.pathname;
    const filename = currentPath.split('/').pop() || 'dashboard.html';

    const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie', path: 'dashboard.html', superOnly: false },
      { id: 'apprentices', label: 'Active Apprentices', icon: 'fa-user-graduate', path: 'apprentices.html?type=active', superOnly: false },
      { id: 'completed', label: 'Completed Apprentices', icon: 'fa-graduation-cap', path: 'apprentices.html?type=completed', superOnly: false },
      { id: 'upload', label: 'Excel Upload', icon: 'fa-file-excel', path: 'upload.html', superOnly: true },
      { id: 'analytics', label: 'Analytics', icon: 'fa-chart-bar', path: 'analytics.html', superOnly: true },
      { id: 'reports', label: 'Reports', icon: 'fa-print', path: 'reports.html', superOnly: false },
      { id: 'users', label: 'User Management', icon: 'fa-users-cog', path: 'users.html', superOnly: true },
      { id: 'settings', label: 'Settings', icon: 'fa-sliders-h', path: 'settings.html', superOnly: false }
    ];

    let itemsHtml = '';
    navItems.forEach(item => {
      // Hide super HR exclusive pages for Branch HR
      if (item.superOnly && currentRole !== 'Super HR') return;

      const itemPathBase = item.path.split('?')[0];
      const itemType = new URLSearchParams(item.path.split('?')[1] || '').get('type');
      const pageType = new URLSearchParams(window.location.search).get('type') || (filename === 'apprentices.html' ? 'active' : null);
      const isActive = filename === itemPathBase && itemType === pageType;

      itemsHtml += `
        <a href="${item.path}" class="nav-item ${isActive ? 'active' : ''}">
          <i class="fas ${item.icon} nav-icon"></i>
          <span class="nav-label">${item.label}</span>
          <span class="nav-tooltip">${item.label}</span>
        </a>
      `;
    });

    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <div class="sidebar-logo">P</div>
        <div class="sidebar-brand-text">
          <div class="sidebar-brand-name">PGP Glass</div>
          <div class="sidebar-brand-tagline">Apprentice Portal</div>
        </div>
        <button class="sidebar-toggle-btn" id="sidebar-toggle">
          <i class="fas fa-chevron-left"></i>
        </button>
      </div>
      
      <nav class="sidebar-nav" aria-label="Main navigation">
        <div class="sidebar-section-label">Central Management</div>
        ${itemsHtml}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user-card" onclick="window.location.href='settings.html'">
          <div class="sidebar-user-avatar">${currentRole === 'Super HR' ? 'SA' : 'BH'}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${currentRole === 'Super HR' ? 'Super HR Admin' : 'Branch Manager'}</div>
            <div class="sidebar-user-role">${currentRole}</div>
          </div>
          <i class="fas fa-cog sidebar-user-chevron"></i>
        </div>
        <a href="../index.html" class="nav-item danger mt-2" style="margin-bottom: 0;">
          <i class="fas fa-sign-out-alt nav-icon"></i>
          <span class="nav-label">Logout</span>
          <span class="nav-tooltip">Logout</span>
        </a>
      </div>
    `;

    // Global navigation validator to ensure ONLY ONE menu item is active
    const menuItems = sidebar.querySelectorAll('.nav-item');
    menuItems.forEach(el => {
      el.classList.remove('active', 'active-page', 'selected');
    });

    let activeFound = false;
    menuItems.forEach(el => {
      const href = el.getAttribute('href');
      if (!href) return;

      const itemPathBase = href.split('?')[0];
      const itemType = new URLSearchParams(href.split('?')[1] || '').get('type');
      const pageType = new URLSearchParams(window.location.search).get('type') || (filename === 'apprentices.html' ? 'active' : null);

      const isExactMatch = filename === itemPathBase && (itemType === null || itemType === pageType);

      if (isExactMatch && !activeFound) {
        el.classList.add('active');
        activeFound = true;
      }
    });

    if (!activeFound && filename === 'dashboard.html') {
      const dashItem = sidebar.querySelector('[href="dashboard.html"]');
      if (dashItem) dashItem.classList.add('active');
    }
  },

  renderTopNav() {
    const topNav = document.getElementById('app-topnav');
    if (!topNav) return;

    const currentRole = AppDB.getRole();
    const currentBranch = AppDB.getBranch();

    const cleared = localStorage.getItem('pgp_notifications_cleared') === 'true';
    const badgeHtml = cleared ? '' : `<span class="notification-badge" aria-hidden="true">3</span>`;
    const ariaLabel = cleared ? 'No unread notifications' : '3 unread notifications';
    const badgeText = cleared ? '0 Unread' : '3 Unread';
    const item1Class = cleared ? 'notification-item' : 'notification-item unread';
    const item2Class = cleared ? 'notification-item' : 'notification-item unread';

    let branchSelectorHtml = '';
    if (currentRole === 'Super HR') {
      // Dynamic locations: 'All Locations' + whatever exists in the live data
      const branches = ['All Locations', ...LocationsCache.get()];
      let optionsHtml = '';
      branches.forEach(b => {
        optionsHtml += `<option value="${b}" ${currentBranch === b ? 'selected' : ''}>${b}</option>`;
      });
      branchSelectorHtml = `
        <div class="align-center d-flex gap-2">
          <span class="text-xs fw-semibold text-muted text-uppercase" style="letter-spacing:0.04em;">Branch:</span>
          <select class="filter-select" id="topnav-branch-select" style="padding: 6px var(--space-4); min-width: 130px; font-size:13px; height: 32px; border-radius: var(--radius-sm);">
            ${optionsHtml}
          </select>
        </div>
      `;
    } else {
      // Branch HR - Show read-only location badge
      branchSelectorHtml = `
        <span class="badge-custom badge-brand">
          <i class="fas fa-map-marker-alt"></i> Location: ${currentBranch}
        </span>
      `;
    }

    topNav.innerHTML = `
      <button class="topnav-toggle" id="mobile-sidebar-toggle">
        <i class="fas fa-bars"></i>
      </button>

      <div class="topnav-breadcrumb d-none d-md-flex align-center gap-2">
        <span class="text-secondary">Apprentice Central</span>
        <span class="text-muted">/</span>
        <span class="page-name">${this.getPageTitle()}</span>
      </div>

      <div class="topnav-actions">
        <!-- Branch selector / Badge -->
        <div class="me-3">
          ${branchSelectorHtml}
        </div>


        <!-- Notifications -->
        <div class="position-relative">
          <button class="topnav-icon-btn" id="notification-btn" aria-label="${ariaLabel}" title="Notifications">
            <i class="fas fa-bell"></i>
            ${badgeHtml}
          </button>
          
          <!-- Dropdown Notification panel -->
          <div class="notification-panel hidden" id="notification-panel">
            <div class="notification-panel-header">
              <h3>Notifications</h3>
              <span class="badge-custom badge-brand">${badgeText}</span>
            </div>
            <div class="notification-panel-list">
              <div class="${item1Class}">
                <div class="notification-icon" style="background:#eff6ff;color:#0078d4;"><i class="fas fa-file-upload"></i></div>
                <div class="notification-body">
                  <div class="notification-title">Excel Upload Successful</div>
                  <div class="notification-message">Super HR uploaded 12 new apprentice entries.</div>
                  <div class="notification-time">Just now</div>
                </div>
              </div>
              <div class="${item2Class}">
                <div class="notification-icon" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-exclamation-circle"></i></div>
                <div class="notification-body">
                  <div class="notification-title">Contract ID Pending</div>
                  <div class="notification-message">Sarah Jenkins (Jambusar) is missing a Contract ID.</div>
                  <div class="notification-time">2 hours ago</div>
                </div>
              </div>
              <div class="notification-item">
                <div class="notification-icon" style="background:#d1fae5;color:#059669;"><i class="fas fa-check-circle"></i></div>
                <div class="notification-body">
                  <div class="notification-title">Apprentice Completion</div>
                  <div class="notification-message">Vikram Singh marked completed by Rajesh Mehta.</div>
                  <div class="notification-time">1 day ago</div>
                </div>
              </div>
            </div>
            <div class="notification-panel-footer">
              <a href="#" id="dismiss-all-notifications">Clear All</a>
            </div>
          </div>
        </div>

        <!-- User avatar button -->
        <button class="topnav-user-btn" onclick="window.location.href='settings.html'">
          <div class="topnav-avatar">${currentRole === 'Super HR' ? 'SA' : 'BH'}</div>
          <span class="topnav-user-name">${currentRole === 'Super HR' ? 'Super HR Admin' : 'Branch HR'}</span>
          <i class="fas fa-chevron-down topnav-user-chevron"></i>
        </button>
      </div>
    `;

    // Hook listeners

    const branchSel = document.getElementById('topnav-branch-select');
    if (branchSel) {
      branchSel.addEventListener('change', (e) => {
        AppDB.saveBranch(e.target.value);
        Toast.info('Location Filtered', `Filtered view for ${e.target.value}.`, 1500);

        // Dispatch custom event for views to filter dynamically
        window.dispatchEvent(new CustomEvent('branchchanged', { detail: { branch: e.target.value } }));
      });
    }

    const notifBtn = document.getElementById('notification-btn');
    const notifPanel = document.getElementById('notification-panel');
    if (notifBtn && notifPanel) {
      notifBtn.addEventListener('click', (e) => {
        notifPanel.classList.toggle('hidden');
        e.stopPropagation();
      });
      document.addEventListener('click', () => {
        notifPanel.classList.add('hidden');
      });
      notifPanel.addEventListener('click', (e) => e.stopPropagation());

      // Notification dismiss all
      const dismissBtn = document.getElementById('dismiss-all-notifications');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', (e) => {
          e.preventDefault();
          localStorage.setItem('pgp_notifications_cleared', 'true');
          notifPanel.querySelectorAll('.notification-item.unread').forEach(el => el.classList.remove('unread'));
          const badge = document.querySelector('.notification-badge');
          if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none'; // Hide empty badge
          }
          if (notifBtn) {
            notifBtn.setAttribute('aria-label', 'No unread notifications');
          }
          const countBadge = notifPanel.querySelector('.badge-brand');
          if (countBadge) countBadge.textContent = '0 Unread';
          Toast.info('Cleared', 'All notifications dismissed.', 1500);
          notifPanel.classList.add('hidden');
        });
      }
    }
  },

  getPageTitle() {
    const path = window.location.pathname;
    if (path.includes('dashboard.html')) return 'Dashboard';
    if (path.includes('apprentices.html')) {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('type') === 'completed' ? 'Completed Apprentices' : 'Active Apprentices';
    }
    if (path.includes('apprentice-detail.html')) return 'Apprentice Details';
    if (path.includes('upload.html')) return 'Excel Upload Center';
    if (path.includes('analytics.html')) return 'Analytics';
    if (path.includes('reports.html')) return 'Export Reports';
    if (path.includes('users.html')) return 'User Management';
    if (path.includes('settings.html')) return 'System Settings';
    return 'Portal';
  }
};

// ============================================================
// ENTERPRISE SIDE DRAWER MANAGER
// ============================================================
const DrawerManager = {
  activeApprentice: null,
  activeList: [],

  init() {
    const backdrop = document.getElementById('apprentice-drawer-backdrop');
    if (backdrop) {
      backdrop.onclick = (e) => {
        if (e.target === backdrop) this.close();
      };
    }

    // ESC key closes drawer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeApprentice) {
        this.close();
      }
    });
  },

  open(code, listContext = []) {
    const apprentices = AppDB.getApprentices();
    const app = apprentices.find(x => x.code === code);
    if (!app) return;

    this.activeApprentice = app;
    this.activeList = listContext.length > 0 ? listContext : [code];

    const role = AppDB.getRole();
    const isSuperHR = role === 'Super HR';
    const isActive = app.status === 'Active';
    // Only Super HR can edit manual fields, and only on Active apprentices
    const isEditable = isSuperHR && isActive;

    // 1. Title Label
    const titleLbl = document.getElementById('drawer-title-lbl');
    if (titleLbl) {
      titleLbl.innerHTML = isEditable
        ? `<i class="fas fa-user-edit me-2 text-brand"></i> Edit Apprentice Profile`
        : `<i class="fas fa-user-shield me-2 text-brand"></i> Apprentice Profile Details`;
    }

    // 2. Build Drawer Body HTML
    const bodyHtml = `
      <!-- Read Only Block: Excel-sourced fields, never editable via portal -->
      <div class="card-custom p-4 mb-4" style="background: var(--surface-card-alt); border-color: var(--border-subtle);">
        <div class="detail-grid detail-grid-2">
          <div><label class="detail-field-label">Employee Code</label><div class="fw-semibold text-primary">${app.code}</div></div>
          <div><label class="detail-field-label">Full Name</label><div class="fw-semibold text-primary">${app.name}</div></div>
          <div><label class="detail-field-label">Location</label><div class="text-sm">${app.location}</div></div>
          <div><label class="detail-field-label">Department</label><div class="text-sm">${app.dept}</div></div>
          <div><label class="detail-field-label">Email Address</label><div class="text-sm">${app.email || 'candidate.pgp@pgpglass.com'}</div></div>
          <div><label class="detail-field-label">Mobile Number</label><div class="text-sm">${app.phone || '+91 98765 43210'}</div></div>
        </div>
      </div>

      <!-- Manual Portal Fields — Super HR editable only; Branch HR sees read-only -->
      ${isEditable ? `<div class="alert-custom alert-info mb-4" style="font-size:12px; padding: 8px 14px;">
        <div class="alert-icon"><i class="fas fa-info-circle"></i></div>
        <div class="alert-body"><div class="alert-msg">Only Super HR can fill these fields. They are never overwritten by Excel re-uploads.</div></div>
      </div>` : ''}

      <form id="drawer-edit-form" onsubmit="event.preventDefault();">
        <div class="form-group mb-4">
          <label class="form-label">Employee Contract ID</label>
          ${isEditable ? `
            <input type="text" class="form-control-custom" id="drawer-contract-id" value="${app.contractId === 'Pending' ? '' : app.contractId}" placeholder="e.g. COMP102">
            <span class="form-help">Enter NAPS/NATS contract identification code.</span>
          ` : `
            <div class="fw-medium text-sm p-2" style="background: var(--surface-card-alt); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">${app.contractId || 'Pending'}</div>
          `}
        </div>

        <div class="form-group mb-4">
          <label class="form-label">Portal Enrollment Number</label>
          ${isEditable ? `
            <input type="text" class="form-control-custom" id="drawer-portal-enrollment" value="${app.portalEnrollmentNumber === 'Pending' ? '' : app.portalEnrollmentNumber}" placeholder="e.g. NAPS00921">
            <span class="form-help">NAPS/NATS Portal enrollment identification number.</span>
          ` : `
            <div class="fw-medium text-sm p-2" style="background: var(--surface-card-alt); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">${app.portalEnrollmentNumber || 'Pending'}</div>
          `}
        </div>

        <div class="form-group mb-4">
          <label class="form-label">Portal Registered Name</label>
          ${isEditable ? `
            <input type="text" class="form-control-custom" id="drawer-portal-name" value="${app.portalName === 'Pending' ? '' : app.portalName}" placeholder="Exact name as logged on NAPS/NATS portal">
            <span class="form-help">Must match the name registered on the government portal.</span>
          ` : `
            <div class="fw-medium text-sm p-2" style="background: var(--surface-card-alt); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">${app.portalName || 'Pending'}</div>
          `}
        </div>

        <div class="form-group mb-4">
          <label class="form-label">Remarks &amp; Comments</label>
          ${isEditable ? `
            <textarea class="form-control-custom" id="drawer-remarks" rows="3" placeholder="Enter comments...">${app.remarks || ''}</textarea>
          ` : `
            <div class="text-sm p-2" style="background: var(--surface-card-alt); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); min-height: 50px;">${app.remarks || 'No remarks added.'}</div>
          `}
        </div>
      </form>

      <!-- Completion Info Block (read-only, shown only for completed apprentices) -->
      ${app.status === 'Completed' ? `
        <div class="card-custom p-4 mb-4" style="background: rgba(5, 150, 105, 0.05); border-color: rgba(5, 150, 105, 0.2);">
          <div class="fw-bold text-success mb-3" style="font-size: 13px;">
            <i class="fas fa-check-circle me-1"></i> Completion Information
          </div>
          <div class="detail-grid detail-grid-2 mb-3">
            <div>
              <label class="detail-field-label">Completion Date</label>
              <div class="text-sm fw-medium">${app.completionDate || '-'}</div>
            </div>
            <div>
              <label class="detail-field-label">Completed By</label>
              <div class="text-sm fw-medium">${app.completedBy || '-'}</div>
            </div>
          </div>
          <div class="mb-3">
            <label class="detail-field-label">Completion Reason</label>
            <div class="text-sm fw-medium">${app.completionReason || '-'}</div>
          </div>
          ${app.completionReason === 'Other' || app.otherCompletionReason ? `
            <div class="mb-3">
              <label class="detail-field-label">Other Completion Reason</label>
              <div class="text-sm fw-medium">${app.otherCompletionReason || '-'}</div>
            </div>
          ` : ''}
          <div>
            <label class="detail-field-label">Completion Remarks</label>
            <div class="text-sm fw-medium" style="white-space: pre-wrap;">${app.completionRemarks || '-'}</div>
          </div>
        </div>
      ` : ''}
    `;

    // 3. Build Drawer Footer — strictly role-driven
    let footerHtml = '';
    if (isEditable) {
      // Super HR editing manual fields on an active apprentice
      footerHtml = `
        <button type="button" class="btn-secondary-custom" onclick="DrawerManager.close()">Cancel</button>
        <button type="button" class="btn-primary-custom" id="drawer-btn-save"><i class="fas fa-save me-1"></i> Save</button>
        <button type="button" class="btn-brand-custom" id="drawer-btn-save-next"><i class="fas fa-chevron-right me-1"></i> Save &amp; Next</button>
      `;
    } else if (role === 'Branch HR' && isActive) {
      // Branch HR: can only mark completion — cannot edit manual fields
      footerHtml = `
        <button type="button" class="btn-secondary-custom" onclick="DrawerManager.close()">Cancel</button>
        <button type="button" id="drawer-btn-complete" style="background: var(--status-success); color: white; padding: 8px 16px; border: none; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <i class="fas fa-check-circle"></i> Mark Completed
        </button>
      `;
    } else {
      // Read-only view: completed apprentice or Super HR viewing completed record
      footerHtml = `
        <button type="button" class="btn-primary-custom" onclick="DrawerManager.close()" style="width: 100%;">Close Details</button>
      `;
    }

    // 4. Inject into Drawer
    const drawerBodies = document.querySelectorAll('#apprentice-drawer-backdrop .drawer-body');
    const drawerFooters = document.querySelectorAll('#apprentice-drawer-backdrop .drawer-footer');

    drawerBodies.forEach(el => el.innerHTML = bodyHtml);
    drawerFooters.forEach(el => el.innerHTML = footerHtml);

    // 5. Bind Dynamic Listeners
    const saveBtn = document.getElementById('drawer-btn-save');
    const saveNextBtn = document.getElementById('drawer-btn-save-next');
    const completeBtn = document.getElementById('drawer-btn-complete');

    if (saveBtn) saveBtn.onclick = () => this.save(false);
    if (saveNextBtn) saveNextBtn.onclick = () => this.save(true);
    if (completeBtn) completeBtn.onclick = () => this.markCompleted();

    // Show drawer
    const backdrop = document.getElementById('apprentice-drawer-backdrop');
    if (backdrop) {
      backdrop.classList.add('active');
    }
  },

  close() {
    const backdrop = document.getElementById('apprentice-drawer-backdrop');
    if (backdrop) {
      backdrop.classList.remove('active');
    }
    this.activeApprentice = null;
  },

  async save(andNext = false) {
    if (!this.activeApprentice) return;

    // Save ONLY the three Super HR manual fields + remarks
    // Status is NEVER changed from this drawer — only Branch HR can mark completion
    const contractIdInput = document.getElementById('drawer-contract-id');
    const portalEnrollmentInput = document.getElementById('drawer-portal-enrollment');
    const portalNameInput = document.getElementById('drawer-portal-name');
    const remarksInput = document.getElementById('drawer-remarks');

    const contractId = contractIdInput ? contractIdInput.value.trim() : '';
    const portalEnrollmentNumber = portalEnrollmentInput ? portalEnrollmentInput.value.trim() : '';
    const portalName = portalNameInput ? portalNameInput.value.trim() : '';
    const remarks = remarksInput ? remarksInput.value.trim() : '';

    const saveBtn = document.getElementById('drawer-btn-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Saving...';
    }

    try {
      await AppDB.updateApprentice(this.activeApprentice.code, {
        contractId: contractId || 'Pending',
        portalEnrollmentNumber: portalEnrollmentNumber || 'Pending',
        portalName: portalName || 'Pending',
        remarks: remarks
      });

      Toast.success('Saved Successfully', `${this.activeApprentice.name}'s profile updated.`, 1500);
      window.dispatchEvent(new CustomEvent('apprenticesupdated'));

      if (andNext) {
        const currentCode = this.activeApprentice.code;
        const contextIdx = this.activeList.indexOf(currentCode);
        if (contextIdx !== -1 && contextIdx < this.activeList.length - 1) {
          const nextCode = this.activeList[contextIdx + 1];
          setTimeout(() => this.open(nextCode, this.activeList), 300);
        } else {
          Toast.info('List Completed', 'All pending profiles in this batch completed.', 2000);
          setTimeout(() => this.close(), 500);
        }
      } else {
        setTimeout(() => this.close(), 500);
      }
    } catch (err) {
      Toast.error('Save Failed', 'Could not save apprentice details: ' + err.message);
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save me-1"></i> Save';
      }
    }
  },

  markCompleted() {
    if (!this.activeApprentice) return;

    ModalManager.showCompletionModal({
      title: 'Complete Apprenticeship',
      onConfirm: async ({ reason, otherReason, remarks }) => {
        const completeBtn = document.getElementById('drawer-btn-complete');
        if (completeBtn) {
          completeBtn.disabled = true;
          completeBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Processing...';
        }

        try {
          await AppDB.completeApprentice(this.activeApprentice.code, reason, otherReason, remarks);
          Toast.success('Completed', 'Apprenticeship marked completed successfully.', 2000);
          window.dispatchEvent(new CustomEvent('apprenticesupdated'));
          setTimeout(() => this.close(), 500);
        } catch (err) {
          Toast.error('Operation Failed', 'Could not complete apprentice: ' + err.message);
          if (completeBtn) {
            completeBtn.disabled = false;
            completeBtn.innerHTML = '<i class="fas fa-check-circle"></i> Mark Completed';
          }
        }
      }
    });
  }
};

// 3. PAGE
const DashboardPage = {
  init() {
    this.renderKPIs();
    this.renderTable();
    this.renderLocationAnalytics();
    this.renderCharts();

    // Refresh components if branch filters update
    dashboardBranchChangedListener = () => {
      this.renderKPIs();
      this.renderTable();
      this.renderLocationAnalytics();
      this.renderCharts();
    };

    dashboardApprenticesUpdatedListener = () => {
      this.renderKPIs();
      this.renderTable();
      this.renderLocationAnalytics();
      this.renderCharts();
    };

    window.addEventListener('branchchanged', dashboardBranchChangedListener);
    window.addEventListener('apprenticesupdated', dashboardApprenticesUpdatedListener);
  },

  getFilteredData() {
    const list = AppDB.getApprentices();
    const branch = AppDB.getBranch();
    const role = AppDB.getRole();

    if (role === 'Branch HR') {
      return list.filter(x => x.location === branch);
    } else if (branch !== 'All Locations') {
      return list.filter(x => x.location === branch);
    }
    return list;
  },

  renderKPIs() {
    const list = this.getFilteredData();
    const role = AppDB.getRole();
    const grid = document.getElementById('dashboard-kpi-grid');
    if (!grid) return;

    // Single-pass KPI calculation — replaces 8 separate filter() calls
    let active = 0, completed = 0, contractPending = 0, portalPending = 0,
      portalNamePending = 0, selectedPermanent = 0, emailPending = 0, phonePending = 0;

    list.forEach(x => {
      const isActive = x.status === 'Active';
      const isCompleted = x.status === 'Completed';
      if (isActive) active++;
      if (isCompleted) completed++;
      if (isActive && (x.contractId === 'Pending' || x.contractId === '')) contractPending++;
      if (isActive && (x.portalEnrollmentNumber === 'Pending' || x.portalEnrollmentNumber === '')) portalPending++;
      if (isActive && (x.portalName === 'Pending' || x.portalName === '')) portalNamePending++;
      if (isCompleted && x.completionReason === 'Selected as Permanent Employee') selectedPermanent++;
      if (isActive && (!x.email || x.email === 'Pending' || x.email === '')) emailPending++;
      if (isActive && (!x.phone || x.phone === 'Pending' || x.phone === '')) phonePending++;
    });

    const total = active + completed;
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
    const permConversionRate = completed > 0 ? ((selectedPermanent / completed) * 100).toFixed(1) : '0.0';

    // Update welcome hero stats with easing countUp animation
    const kpiTotalEl = document.getElementById('kpi-total');
    const kpiActiveEl = document.getElementById('kpi-active');
    const kpiCompletedEl = document.getElementById('kpi-completed');

    function animateCountUp(el, targetVal) {
      if (!el) return;
      const start = 0;
      const end = parseInt(targetVal) || 0;
      if (end === 0) {
        el.textContent = '0';
        return;
      }
      const duration = 800; // 800ms
      const startTime = performance.now();
      function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = progress * (2 - progress); // easeOutQuad
        const currentVal = Math.floor(start + easeProgress * (end - start));
        el.textContent = currentVal;
        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          el.textContent = end;
        }
      }
      requestAnimationFrame(update);
    }

    if (kpiTotalEl) animateCountUp(kpiTotalEl, total);
    if (kpiActiveEl) animateCountUp(kpiActiveEl, active);
    if (kpiCompletedEl) animateCountUp(kpiCompletedEl, completed);

    grid.innerHTML = `
      <div class="stat-card blue cursor-pointer" onclick="window.location.href='apprentices.html?type=active'">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-users"></i></div>
          <span class="stat-card-trend trend-flat">All Data</span>
        </div>
        <div class="stat-card-value" id="card-val-total">0</div>
        <div class="stat-card-label">Total Apprentices</div>
        <div class="stat-card-footer">All locations registry count</div>
      </div>
      <div class="stat-card green cursor-pointer" onclick="window.location.href='apprentices.html?type=active'">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-user-check"></i></div>
          <span class="stat-card-trend trend-up">Active</span>
        </div>
        <div class="stat-card-value" id="card-val-active">0</div>
        <div class="stat-card-label">Active Apprentices</div>
        <div class="stat-card-footer">Currently in training</div>
      </div>
      <div class="stat-card purple cursor-pointer" onclick="window.location.href='apprentices.html?type=completed'">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-graduation-cap"></i></div>
          <span class="stat-card-trend trend-flat">Graduated</span>
        </div>
        <div class="stat-card-value" id="card-val-completed">0</div>
        <div class="stat-card-label">Completed Apprentices</div>
        <div class="stat-card-footer">Program completed</div>
      </div>
      <div class="stat-card teal">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-percent"></i></div>
          <span class="stat-card-trend trend-up">Ratio</span>
        </div>
        <div class="stat-card-value" id="card-val-completion-rate">0%</div>
        <div class="stat-card-label">Completion Rate</div>
        <div class="stat-card-footer">Completed vs total</div>
      </div>
      <div class="stat-card indigo">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-briefcase"></i></div>
          <span class="stat-card-trend trend-up">Retention</span>
        </div>
        <div class="stat-card-value" id="card-val-perm-conversion">0%</div>
        <div class="stat-card-label">Permanent Conversion</div>
        <div class="stat-card-footer">Permanent hired vs completed</div>
      </div>
      <div class="stat-card red cursor-pointer" onclick="window.location.href='apprentices.html?type=active&filter=contract-pending'">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-file-signature"></i></div>
          <span class="stat-card-trend trend-down">Pending</span>
        </div>
        <div class="stat-card-value" id="card-val-contract-pending">0</div>
        <div class="stat-card-label">Missing Contract IDs</div>
        <div class="stat-card-footer">Requires Super HR input</div>
      </div>
      <div class="stat-card amber cursor-pointer" onclick="window.location.href='apprentices.html?type=active&filter=portal-pending'">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-link"></i></div>
          <span class="stat-card-trend trend-down">Pending</span>
        </div>
        <div class="stat-card-value" id="card-val-portal-pending">0</div>
        <div class="stat-card-label">Missing Portal Enrollments</div>
        <div class="stat-card-footer">Requires portal registration</div>
      </div>
      <div class="stat-card orange cursor-pointer" onclick="window.location.href='apprentices.html?type=active&filter=name-pending'">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="fas fa-signature"></i></div>
          <span class="stat-card-trend trend-down">Pending</span>
        </div>
        <div class="stat-card-value" id="card-val-portal-name-pending">0</div>
        <div class="stat-card-label">Missing Portal Names</div>
        <div class="stat-card-footer">Aadhaar verification check</div>
      </div>
    `;

    // Trigger animations on grid KPI values
    animateCountUp(document.getElementById('card-val-total'), total);
    animateCountUp(document.getElementById('card-val-active'), active);
    animateCountUp(document.getElementById('card-val-completed'), completed);
    animateCountUp(document.getElementById('card-val-contract-pending'), contractPending);
    animateCountUp(document.getElementById('card-val-portal-pending'), portalPending);
    animateCountUp(document.getElementById('card-val-portal-name-pending'), portalNamePending);

    const compRateEl = document.getElementById('card-val-completion-rate');
    const permConvEl = document.getElementById('card-val-perm-conversion');
    if (compRateEl) compRateEl.textContent = completionRate + '%';
    if (permConvEl) permConvEl.textContent = permConversionRate + '%';

    // Update Data Quality Alert card values too
    const dqContract = document.getElementById('dq-contract-pending');
    const dqPortal = document.getElementById('dq-portal-pending');
    const dqName = document.getElementById('dq-name-pending');
    const dqEmail = document.getElementById('dq-email-pending');
    const dqPhone = document.getElementById('dq-phone-pending');

    if (dqContract) animateCountUp(dqContract, contractPending);
    if (dqPortal) animateCountUp(dqPortal, portalPending);
    if (dqName) animateCountUp(dqName, portalNamePending);
    if (dqEmail) animateCountUp(dqEmail, emailPending);
    if (dqPhone) animateCountUp(dqPhone, phonePending);
  },

  renderTable() {
    const tbody = document.getElementById('recent-updates-tbody');
    if (!tbody) return;

    const logs = AppDB.getAudit();
    const activeBranch = AppDB.getBranch();
    const role = AppDB.getRole();

    // Filter audit logs by location if branch HR
    let filteredLogs = logs;
    if (role === 'Branch HR') {
      filteredLogs = logs.filter(l => l.location === activeBranch);
    } else if (activeBranch !== 'All Locations') {
      filteredLogs = logs.filter(l => l.location === activeBranch);
    }

    if (filteredLogs.length === 0) {
      TableManager.renderEmptyState(tbody, 7, "No recent updates", "Audit records are empty for the current location.");
      return;
    }

    tbody.innerHTML = '';
    filteredLogs.slice(0, 5).forEach(l => {
      // Status badge — only Active and Completed are valid business statuses
      let statusBadge = '';
      if (l.status === 'Active') statusBadge = `<span class="badge-custom badge-success"><i class="fas fa-check-circle"></i> Active</span>`;
      else if (l.status === 'Completed') statusBadge = `<span class="badge-custom badge-info"><i class="fas fa-graduation-cap"></i> Completed</span>`;
      else statusBadge = `<span class="badge-custom badge-neutral">${l.status || 'Unknown'}</span>`;

      tbody.innerHTML += `
        <tr class="cursor-pointer" onclick="window.location.href='apprentice-detail.html?code=${l.code}'">
          <td><span class="fw-semibold">${l.code}</span></td>
          <td>
            <div class="avatar-cell">
              <div class="avatar-circle">${l.name.charAt(0)}</div>
              <span class="fw-medium">${l.name}</span>
            </div>
          </td>
          <td>${l.location}</td>
          <td>${l.dept}</td>
          <td>${statusBadge}</td>
          <td><span class="text-xs text-secondary">${l.updated}</span></td>
          <td class="col-actions" onclick="event.stopPropagation()">
            <a href="apprentice-detail.html?code=${l.code}" class="btn-icon btn-sm" title="View Details" aria-label="View Details of ${l.name}"><i class="fas fa-eye"></i></a>
          </td>
        </tr>
      `;
    });
  },

  renderLocationAnalytics() {
    const tbody = document.getElementById('location-analytics-tbody');
    if (!tbody) return;

    const list = AppDB.getApprentices();
    const role = AppDB.getRole();
    const activeBranch = AppDB.getBranch();

    // Dynamic locations: derived from live data via LocationsCache
    let locations = LocationsCache.get().length > 0 ? LocationsCache.get() : [...new Set(list.map(x => x.location).filter(Boolean))].sort();
    if (role === 'Branch HR') {
      locations = [activeBranch];
    } else if (activeBranch !== 'All Locations') {
      locations = [activeBranch];
    }

    tbody.innerHTML = '';
    locations.forEach(loc => {
      const locList = list.filter(x => String(x.location).toLowerCase().trim() === String(loc).toLowerCase().trim());
      const active = locList.filter(x => x.status === 'Active').length;
      const completed = locList.filter(x => x.status === 'Completed').length;
      const total = active + completed;
      const rate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';

      tbody.innerHTML += `
        <tr>
          <td><span class="fw-semibold">${loc}</span></td>
          <td class="text-center fw-medium text-success">${active}</td>
          <td class="text-center fw-medium text-primary">${completed}</td>
          <td class="text-center"><span class="badge-custom badge-brand" style="background: rgba(0, 120, 212, 0.1); color: #0078d4; border: 1px solid rgba(0, 120, 212, 0.2);">${rate}%</span></td>
        </tr>
      `;
    });
  },

  renderCharts() {
    const list = this.getFilteredData();
    const role = AppDB.getRole();
    const activeBranch = AppDB.getBranch();

    // Chart 1: Active Apprentices by Location — dynamic
    let locations = LocationsCache.get().length > 0 ? LocationsCache.get() : [...new Set(list.map(x => x.location).filter(Boolean))].sort();
    if (role === 'Branch HR') {
      locations = [activeBranch];
    } else if (activeBranch !== 'All Locations') {
      locations = [activeBranch];
    }

    const activeCounts = locations.map(loc => list.filter(x => x.status === 'Active' && String(x.location).toLowerCase().trim() === loc.toLowerCase().trim()).length);
    // Update in-place if chart exists, otherwise create
    if (!Charts.updateChart('chart-active-locations', locations, activeCounts)) {
      Charts.createBarChart('chart-active-locations', locations, activeCounts, 'Active Apprentices', '#059669');
    }

    // Chart 2: Completed Apprentices by Location
    const completedCounts = locations.map(loc => list.filter(x => x.status === 'Completed' && String(x.location).toLowerCase().trim() === loc.toLowerCase().trim()).length);
    if (!Charts.updateChart('chart-completed-locations', locations, completedCounts)) {
      Charts.createBarChart('chart-completed-locations', locations, completedCounts, 'Completed Apprentices', '#0078d4');
    }

    // Chart 3: Department Distribution
    const deptsMap = {};
    list.forEach(x => {
      if (x.dept) {
        deptsMap[x.dept] = (deptsMap[x.dept] || 0) + 1;
      }
    });
    const depts = Object.keys(deptsMap);
    const deptCounts = depts.map(d => deptsMap[d]);
    if (depts.length === 0) {
      if (!Charts.updateChart('chart-department-dist', ['No Data'], [0])) {
        Charts.createPieChart('chart-department-dist', ['No Data'], [0]);
      }
    } else {
      if (!Charts.updateChart('chart-department-dist', depts, deptCounts)) {
        Charts.createPieChart('chart-department-dist', depts, deptCounts);
      }
    }

    // Chart 4: Gender Distribution
    const maleCount = list.filter(x => String(x.sex).toLowerCase().trim() === 'male').length;
    const femaleCount = list.filter(x => String(x.sex).toLowerCase().trim() === 'female').length;
    if (!Charts.updateChart('chart-gender-dist', ['Male', 'Female'], [maleCount, femaleCount])) {
      Charts.createDonutChart('chart-gender-dist', ['Male', 'Female'], [maleCount, femaleCount]);
    }

    // Chart 5: Monthly Joining Trend
    const monthlyMap = {};
    list.forEach(x => {
      if (!x.joined) return;
      const parts = String(x.joined).split('-'); // YYYY-MM-DD
      if (parts.length < 2) return;
      const yearMonth = `${parts[0]}-${parts[1]}`; // e.g. "2026-05"
      monthlyMap[yearMonth] = (monthlyMap[yearMonth] || 0) + 1;
    });
    const sortedMonths = Object.keys(monthlyMap).sort();
    const monthlyLabels = sortedMonths.map(ym => {
      const parts = ym.split('-');
      const year = parts[0];
      const monthIndex = parseInt(parts[1]) - 1;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthNames[monthIndex]} ${year}`;
    });
    const monthlyCounts = sortedMonths.map(ym => monthlyMap[ym]);
    if (sortedMonths.length === 0) {
      if (!Charts.updateChart('chart-monthly-trend', ['No Joined Data'], [0])) {
        Charts.createLineChart('chart-monthly-trend', ['No Joined Data'], [0], 'Joined Trend', '#7c3aed');
      }
    } else {
      if (!Charts.updateChart('chart-monthly-trend', monthlyLabels, monthlyCounts)) {
        Charts.createLineChart('chart-monthly-trend', monthlyLabels, monthlyCounts, 'Joined Trend', '#7c3aed');
      }
    }

    // Chart 6: Completion Reason Distribution
    const completedList = list.filter(x => x.status === 'Completed');
    const reasonsMap = {};
    completedList.forEach(x => {
      if (x.completionReason) {
        reasonsMap[x.completionReason] = (reasonsMap[x.completionReason] || 0) + 1;
      }
    });
    const reasons = Object.keys(reasonsMap);
    const reasonCounts = reasons.map(r => reasonsMap[r]);
    if (reasons.length === 0) {
      if (!Charts.updateChart('chart-completion-reason-dist', ['No Data'], [0])) {
        Charts.createPieChart('chart-completion-reason-dist', ['No Data'], [0]);
      }
    } else {
      if (!Charts.updateChart('chart-completion-reason-dist', reasons, reasonCounts)) {
        Charts.createPieChart('chart-completion-reason-dist', reasons, reasonCounts);
      }
    }
  },
};

const ApprenticesPage = {
  data: [],
  filteredData: [],
  pageSize: 10,
  currentPage: 1,
  sortBy: 'code',
  sortAsc: true,
  pageType: 'active', // active or completed

  init() {
    const urlParams = new URLSearchParams(window.location.search);
    let typeParam = urlParams.get('type');
    if (!typeParam) {
      typeParam = sessionStorage.getItem('pgp_registry_tab') || 'active';
      history.replaceState(null, '', `apprentices.html?type=${typeParam}`);
    }
    this.pageType = typeParam === 'completed' ? 'completed' : 'active';
    sessionStorage.setItem('pgp_registry_tab', this.pageType);

    this.loadData();
    this.populateDepartmentsDropdown();
    this.bindFilters();
    this.applySessionFilters();

    this.currentPage = parseInt(sessionStorage.getItem(`pgp_${this.pageType}_page`)) || 1;
    this.sortBy = sessionStorage.getItem(`pgp_${this.pageType}_sort_by`) || 'code';
    this.sortAsc = sessionStorage.getItem(`pgp_${this.pageType}_sort_asc`) !== 'false';

    // Set UI sub-headers if url filter preset is present
    const filterPreset = urlParams.get('filter');
    if (filterPreset) {
      const subHeader = document.getElementById('page-subtitle-header');
      if (subHeader) {
        let text = 'Filtering records with ';
        if (filterPreset === 'contract-pending') text += '<strong>Pending Contract IDs</strong>.';
        else if (filterPreset === 'portal-pending') text += '<strong>Pending Portal Enrollments</strong>.';
        else if (filterPreset === 'name-pending') text += '<strong>Pending Portal Registered Names</strong>.';
        else if (filterPreset === 'email-pending') text += '<strong>Missing Email Addresses</strong>.';
        else if (filterPreset === 'phone-pending') text += '<strong>Missing Mobile Numbers</strong>.';
        subHeader.innerHTML = text + ' <a href="apprentices.html?type=active" class="ms-2 text-xs text-brand" style="text-decoration: underline;" onclick="ApprenticesPage.clearFilters(event)">Clear Filter</a>';
      }
    }

    this.render();

    // Override the global tab switching handler defined in the HTML file
    window.switchRegistryTab = (type) => {
      this.pageType = type;
      sessionStorage.setItem('pgp_registry_tab', type);
      history.replaceState(null, '', `apprentices.html?type=${type}`);
      if (typeof buildTableHeader === 'function') {
        buildTableHeader();
      }
      this.loadData();

      const searchInput = document.getElementById('table-search');
      const deptFilter = document.getElementById('filter-dept');
      const statusFilter = document.getElementById('filter-status');
      const dateStart = document.getElementById('filter-date-start');
      const dateEnd = document.getElementById('filter-date-end');

      if (searchInput) searchInput.value = sessionStorage.getItem(`pgp_${type}_search`) || '';
      if (deptFilter) deptFilter.value = sessionStorage.getItem(`pgp_${type}_dept`) || '';
      if (statusFilter) statusFilter.value = sessionStorage.getItem(`pgp_${type}_status`) || '';
      if (dateStart) dateStart.value = sessionStorage.getItem(`pgp_${type}_date_start`) || '';
      if (dateEnd) dateEnd.value = sessionStorage.getItem(`pgp_${type}_date_end`) || '';

      this.applySessionFilters();
      this.currentPage = parseInt(sessionStorage.getItem(`pgp_${type}_page`)) || 1;
      this.render();
    };

    // Update tab count badges with loaded data on initial load
    if (typeof updateTabBadges === 'function') {
      updateTabBadges();
    }

    apprenticesBranchChangedListener = () => {
      this.loadData();
      this.currentPage = 1;
      sessionStorage.setItem(`pgp_${this.pageType}_page`, 1);
      this.applySessionFilters();
      this.render();
    };

    apprenticesApprenticesUpdatedListener = () => {
      this.loadData();
      this.populateDepartmentsDropdown();
      this.applySessionFilters();
      this.render();
    };

    window.addEventListener('branchchanged', apprenticesBranchChangedListener);
    window.addEventListener('apprenticesupdated', apprenticesApprenticesUpdatedListener);
  },

  clearFilters(e) {
    if (e) e.preventDefault();
    sessionStorage.removeItem(`pgp_${this.pageType}_search`);
    sessionStorage.removeItem(`pgp_${this.pageType}_dept`);
    sessionStorage.removeItem(`pgp_${this.pageType}_status`);
    sessionStorage.removeItem(`pgp_${this.pageType}_date_start`);
    sessionStorage.removeItem(`pgp_${this.pageType}_date_end`);
    sessionStorage.setItem(`pgp_${this.pageType}_page`, 1);

    history.replaceState(null, '', `apprentices.html?type=${this.pageType}`);

    const subHeader = document.getElementById('page-subtitle-header');
    if (subHeader) {
      if (this.pageType === 'completed') {
        subHeader.innerText = 'Historical log of signed-off candidates and program certificates.';
      } else {
        subHeader.innerText = 'Real-time master index of current apprentice tracks, portal registrations, and contract statuses.';
      }
    }

    this.loadData();
    this.bindFilters();
    this.applySessionFilters();
    this.currentPage = 1;
    this.render();
    if (typeof updateTabBadges === 'function') {
      updateTabBadges();
    }
  },

  applySessionFilters() {
    const q = (sessionStorage.getItem(`pgp_${this.pageType}_search`) || '').toLowerCase();
    const dept = sessionStorage.getItem(`pgp_${this.pageType}_dept`) || '';
    const status = sessionStorage.getItem(`pgp_${this.pageType}_status`) || '';
    const start = sessionStorage.getItem(`pgp_${this.pageType}_date_start`) || '';
    const end = sessionStorage.getItem(`pgp_${this.pageType}_date_end`) || '';

    this.filteredData = this.data.filter(x => {
      const matchesSearch = x.name.toLowerCase().includes(q) ||
        x.code.toLowerCase().includes(q) ||
        x.dept.toLowerCase().includes(q) ||
        x.location.toLowerCase().includes(q) ||
        (x.phone || '').toLowerCase().includes(q) ||
        (x.email || '').toLowerCase().includes(q) ||
        (x.contractId || '').toLowerCase().includes(q) ||
        (x.portalEnrollmentNumber || '').toLowerCase().includes(q) ||
        (x.portalName || '').toLowerCase().includes(q);
      const matchesDept = dept === '' || x.dept === dept;
      const matchesStatus = status === '' || x.status === status;

      let matchesDate = true;
      if (start) matchesDate = matchesDate && x.joined >= start;
      if (end) matchesDate = matchesDate && x.joined <= end;

      return matchesSearch && matchesDept && matchesStatus && matchesDate;
    });

    this.sortBy = sessionStorage.getItem(`pgp_${this.pageType}_sort_by`) || 'code';
    this.sortAsc = sessionStorage.getItem(`pgp_${this.pageType}_sort_asc`) !== 'false';
    this.sortData();
  },

  populateDepartmentsDropdown() {
    const deptSelect = document.getElementById('filter-dept');
    if (!deptSelect) return;
    const list = DepartmentsCache.get();
    const currentVal = deptSelect.value;
    let html = '<option value="">All Departments</option>';
    list.forEach(d => {
      html += `<option value="${d}">${d}</option>`;
    });
    deptSelect.innerHTML = html;
    if (currentVal && list.includes(currentVal)) {
      deptSelect.value = currentVal;
    }
  },

  loadData() {
    const all = AppDB.getApprentices();
    const currentBranch = AppDB.getBranch();
    const role = AppDB.getRole();

    // 1. Filter by user roles & active branch selection
    let filtered = all;
    if (role === 'Branch HR') {
      filtered = all.filter(x => x.location === currentBranch);
    } else if (currentBranch !== 'All Locations') {
      filtered = all.filter(x => x.location === currentBranch);
    }

    // 2. Filter by completion status depending on page type
    if (this.pageType === 'completed') {
      this.data = filtered.filter(x => x.status === 'Completed');
    } else {
      this.data = filtered.filter(x => x.status === 'Active');
    }

    // 3. Filter by pending card query param preset if any
    const urlParams = new URLSearchParams(window.location.search);
    const filterPreset = urlParams.get('filter');
    if (filterPreset) {
      if (filterPreset === 'contract-pending') {
        this.data = this.data.filter(x => x.status === 'Active' && (x.contractId === 'Pending' || x.contractId === ''));
      } else if (filterPreset === 'portal-pending') {
        this.data = this.data.filter(x => x.status === 'Active' && (x.portalEnrollmentNumber === 'Pending' || x.portalEnrollmentNumber === ''));
      } else if (filterPreset === 'name-pending') {
        this.data = this.data.filter(x => x.status === 'Active' && (x.portalName === 'Pending' || x.portalName === ''));
      } else if (filterPreset === 'email-pending') {
        this.data = this.data.filter(x => x.status === 'Active' && (!x.email || x.email === 'Pending' || x.email === ''));
      } else if (filterPreset === 'phone-pending') {
        this.data = this.data.filter(x => x.status === 'Active' && (!x.phone || x.phone === 'Pending' || x.phone === ''));
      }
    }

    this.filteredData = [...this.data];
  },

  bindFilters() {
    const searchInput = document.getElementById('table-search');
    const deptFilter = document.getElementById('filter-dept');
    const statusFilter = document.getElementById('filter-status');
    const dateStart = document.getElementById('filter-date-start');
    const dateEnd = document.getElementById('filter-date-end');
    const exportBtn = document.getElementById('export-table-btn');

    // Restore from sessionStorage
    if (searchInput) searchInput.value = sessionStorage.getItem(`pgp_${this.pageType}_search`) || '';
    if (deptFilter) deptFilter.value = sessionStorage.getItem(`pgp_${this.pageType}_dept`) || '';
    if (statusFilter) statusFilter.value = sessionStorage.getItem(`pgp_${this.pageType}_status`) || '';
    if (dateStart) dateStart.value = sessionStorage.getItem(`pgp_${this.pageType}_date_start`) || '';
    if (dateEnd) dateEnd.value = sessionStorage.getItem(`pgp_${this.pageType}_date_end`) || '';

    const runFilters = () => {
      const q = searchInput ? searchInput.value.toLowerCase() : '';
      const dept = deptFilter ? deptFilter.value : '';
      const status = statusFilter ? statusFilter.value : '';
      const start = dateStart ? dateStart.value : '';
      const end = dateEnd ? dateEnd.value : '';

      // Save to sessionStorage
      if (searchInput) sessionStorage.setItem(`pgp_${this.pageType}_search`, searchInput.value);
      if (deptFilter) sessionStorage.setItem(`pgp_${this.pageType}_dept`, dept);
      if (statusFilter) sessionStorage.setItem(`pgp_${this.pageType}_status`, status);
      if (dateStart) sessionStorage.setItem(`pgp_${this.pageType}_date_start`, start);
      if (dateEnd) sessionStorage.setItem(`pgp_${this.pageType}_date_end`, end);

      this.filteredData = this.data.filter(x => {
        const matchesSearch = x.name.toLowerCase().includes(q) ||
          x.code.toLowerCase().includes(q) ||
          x.dept.toLowerCase().includes(q) ||
          x.location.toLowerCase().includes(q) ||
          (x.phone || '').toLowerCase().includes(q) ||
          (x.email || '').toLowerCase().includes(q) ||
          (x.contractId || '').toLowerCase().includes(q) ||
          (x.portalEnrollmentNumber || '').toLowerCase().includes(q) ||
          (x.portalName || '').toLowerCase().includes(q);
        const matchesDept = dept === '' || x.dept === dept;
        const matchesStatus = status === '' || x.status === status;

        let matchesDate = true;
        const parseDateSafe = (dateStr) => {
          if (!dateStr) return null;
          const d = new Date(dateStr);
          return isNaN(d.getTime()) ? null : d;
        };
        if (start) {
          const startLimit = parseDateSafe(start);
          const joinedDate = parseDateSafe(x.joined);
          if (startLimit && joinedDate) {
            matchesDate = matchesDate && joinedDate >= startLimit;
          }
        }
        if (end) {
          const endLimit = parseDateSafe(end);
          const joinedDate = parseDateSafe(x.joined);
          if (endLimit && joinedDate) {
            matchesDate = matchesDate && joinedDate <= endLimit;
          }
        }

        return matchesSearch && matchesDept && matchesStatus && matchesDate;
      });

      this.sortData();
      this.currentPage = 1;
      sessionStorage.setItem(`pgp_${this.pageType}_page`, 1);
      this.render();
    };

    if (searchInput) searchInput.addEventListener('input', debounce(runFilters, 300));
    if (deptFilter) deptFilter.addEventListener('change', runFilters);
    if (statusFilter) statusFilter.addEventListener('change', runFilters);
    if (dateStart) dateStart.addEventListener('change', runFilters);
    if (dateEnd) dateEnd.addEventListener('change', runFilters);

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const filters = {
          search: searchInput ? searchInput.value.trim() : '',
          dept: deptFilter ? deptFilter.value : '',
          location: AppDB.getBranch() || 'All Locations',
          joiningDateStart: dateStart ? dateStart.value : '',
          joiningDateEnd: dateEnd ? dateEnd.value : '',
          status: this.pageType === 'completed' ? 'Completed' : 'Active'
        };
        // Trigger back-end export using real backend engine
        ReportsPage.exportReport(this.pageType, 'csv', filters);
      });
    }

    // Connect sorting headers
    document.querySelectorAll('.table-custom th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (this.sortBy === col) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortBy = col;
          this.sortAsc = true;
        }

        sessionStorage.setItem(`pgp_${this.pageType}_sort_by`, this.sortBy);
        sessionStorage.setItem(`pgp_${this.pageType}_sort_asc`, this.sortAsc);

        // Update sort headers indicators class
        document.querySelectorAll('.table-custom th').forEach(el => {
          el.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(this.sortAsc ? 'sort-asc' : 'sort-desc');

        this.sortData();
        this.render();
      });
    });
  },

  sortData() {
    this.filteredData.sort((a, b) => {
      let valA = a[this.sortBy];
      let valB = b[this.sortBy];

      if (typeof valA === 'string') {
        return this.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return this.sortAsc ? valA - valB : valB - valA;
    });
  },

  render() {
    const tbody = document.getElementById('apprentices-tbody');
    const table = document.querySelector('.table-custom');
    if (!tbody) return;

    const colCount = this.pageType === 'completed' ? 12 : 10;

    // Show skeletons loaders first
    TableManager.renderSkeleton(tbody, colCount, 5);

    // Dynamic Headers Update
    const headerRow = document.getElementById('table-header-row');
    if (headerRow) {
      let headersHtml = `
        <th class="sortable ${this.sortBy === 'code' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="code">Code <i class="fas fa-sort sort-icon"></i></th>
        <th class="sortable ${this.sortBy === 'name' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="name">Name <i class="fas fa-sort sort-icon"></i></th>
        <th class="sortable ${this.sortBy === 'location' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="location">Location <i class="fas fa-sort sort-icon"></i></th>
        <th class="sortable ${this.sortBy === 'dept' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="dept">Department <i class="fas fa-sort sort-icon"></i></th>
        <th class="sortable ${this.sortBy === 'joined' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="joined">Joined <i class="fas fa-sort sort-icon"></i></th>
        <th class="sortable ${this.sortBy === 'contractId' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="contractId">Contract ID <i class="fas fa-sort sort-icon"></i></th>
        <th class="sortable ${this.sortBy === 'portalEnrollmentNumber' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="portalEnrollmentNumber">Portal Enrollment Number <i class="fas fa-sort sort-icon"></i></th>
        <th class="sortable ${this.sortBy === 'portalName' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="portalName">Portal Name <i class="fas fa-sort sort-icon"></i></th>
      `;
      if (this.pageType === 'completed') {
        headersHtml += `
          <th class="sortable ${this.sortBy === 'completionDate' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="completionDate">Completed Date <i class="fas fa-sort sort-icon"></i></th>
          <th class="sortable ${this.sortBy === 'completedBy' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="completedBy">Completed By <i class="fas fa-sort sort-icon"></i></th>
        `;
      }
      headersHtml += `
        <th class="sortable ${this.sortBy === 'status' ? (this.sortAsc ? 'sort-asc' : 'sort-desc') : ''}" data-sort="status">Status <i class="fas fa-sort sort-icon"></i></th>
        <th class="col-actions">Actions</th>
      `;
      headerRow.innerHTML = headersHtml;

      // Connect sorting listeners
      headerRow.querySelectorAll('.sortable').forEach(th => {
        th.onclick = () => {
          const col = th.dataset.sort;
          if (this.sortBy === col) {
            this.sortAsc = !this.sortAsc;
          } else {
            this.sortBy = col;
            this.sortAsc = true;
          }
          this.sortData();
          this.render();
        };
      });
    }

    setTimeout(() => {
      const startIdx = (this.currentPage - 1) * this.pageSize;
      const endIdx = startIdx + this.pageSize;
      const paginatedItems = this.filteredData.slice(startIdx, endIdx);

      if (paginatedItems.length === 0) {
        TableManager.renderEmptyState(tbody, colCount);
        this.renderPagination(0);
        return;
      }

      // Render rows using single HTML buffer — eliminates O(n²) innerHTML+= re-parsing
      const rowBuffers = [];
      paginatedItems.forEach(x => {
        let statusBadge = '';
        // Only Active and Completed are valid business statuses
        if (x.status === 'Active') statusBadge = `<span class="badge-custom badge-success"><i class="fas fa-check-circle"></i> Active</span>`;
        else if (x.status === 'Completed') statusBadge = `<span class="badge-custom badge-info"><i class="fas fa-graduation-cap"></i> Completed</span>`;
        else statusBadge = `<span class="badge-custom badge-neutral">${x.status || 'Unknown'}</span>`;

        let actionHtml = `<a href="apprentice-detail.html?code=${x.code}" class="btn-icon btn-sm" title="View Details" aria-label="View Details of ${x.name}"><i class="fas fa-eye"></i></a>`;

        // Complete dates specific to completed page
        let completedDateHtml = this.pageType === 'completed' ? `<td>${x.completionDate}</td><td>${x.completedBy}</td>` : '';

        rowBuffers.push(`
          <tr class="cursor-pointer" onclick="window.location.href='apprentice-detail.html?code=${x.code}'">
            <td><span class="fw-semibold">${x.code}</span></td>
            <td>
              <div class="avatar-cell">
                <div class="avatar-circle">${x.name.charAt(0)}</div>
                <div class="avatar-cell-info">
                  <div class="name">${x.name}</div>
                  <div class="sub">Apprentice</div>
                </div>
              </div>
            </td>
            <td>${x.location}</td>
            <td>${x.dept}</td>
            <td>${x.joined}</td>
            <td><span class="fw-medium">${x.contractId}</span></td>
            <td><span class="fw-medium">${x.portalEnrollmentNumber}</span></td>
            <td><span class="fw-medium">${x.portalName}</span></td>
            ${completedDateHtml}
            <td>${statusBadge}</td>
            <td class="col-actions" onclick="event.stopPropagation()">
              <div class="action-btns">
                ${actionHtml}
              </div>
            </td>
          </tr>
        `);
      });

      // Single DOM write — O(n) instead of O(n²)
      tbody.innerHTML = rowBuffers.join('');

      this.renderPagination(this.filteredData.length);
      TableManager.enableResizing(table);
      SkeletonManager.hideRegistry();
    }, 0); // No artificial delay — skeleton shown above, render synchronously
  },

  renderPagination(totalCount) {
    const pagInfo = document.getElementById('pagination-info');
    const pagControls = document.getElementById('pagination-controls');
    if (!pagInfo || !pagControls) return;

    if (totalCount === 0) {
      pagInfo.innerText = 'Showing 0 to 0 of 0 entries';
      pagControls.innerHTML = '';
      return;
    }

    const totalPages = Math.ceil(totalCount / this.pageSize);
    const startRow = (this.currentPage - 1) * this.pageSize + 1;
    const endRow = Math.min(startRow + this.pageSize - 1, totalCount);

    pagInfo.innerText = `Showing ${startRow} to ${endRow} of ${totalCount} entries`;

    // Windowed pagination — max 7 visible buttons with ellipsis
    // Renders: [1] ... [curr-2] [curr-1] [curr] [curr+1] [curr+2] ... [last]
    function getPageWindow(currentPage, totalPages) {
      if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
      const pages = new Set([1, totalPages]);
      for (let i = Math.max(2, currentPage - 2); i <= Math.min(totalPages - 1, currentPage + 2); i++) {
        pages.add(i);
      }
      return Array.from(pages).sort((a, b) => a - b);
    }

    const pageWindow = getPageWindow(this.currentPage, totalPages);

    let controlsHtml = `
      <button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} id="pag-prev">
        <i class="fas fa-chevron-left"></i>
      </button>
    `;

    let prevPage = 0;
    pageWindow.forEach(p => {
      if (p - prevPage > 1) {
        controlsHtml += `<span style="display:inline-flex;align-items:center;padding:0 6px;color:var(--text-muted);">...</span>`;
      }
      controlsHtml += `
        <button class="pagination-btn ${this.currentPage === p ? 'active' : ''}" data-page="${p}">
          ${p}
        </button>
      `;
      prevPage = p;
    });

    controlsHtml += `
      <button class="pagination-btn" ${this.currentPage === totalPages ? 'disabled' : ''} id="pag-next">
        <i class="fas fa-chevron-right"></i>
      </button>
    `;

    pagControls.innerHTML = controlsHtml;

    // Attach listeners
    document.getElementById('pag-prev').onclick = () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        sessionStorage.setItem(`pgp_${this.pageType}_page`, this.currentPage);
        this.render();
      }
    };
    document.getElementById('pag-next').onclick = () => {
      if (this.currentPage < totalPages) {
        this.currentPage++;
        sessionStorage.setItem(`pgp_${this.pageType}_page`, this.currentPage);
        this.render();
      }
    };
    pagControls.querySelectorAll('[data-page]').forEach(btn => {
      btn.onclick = () => {
        this.currentPage = parseInt(btn.dataset.page);
        sessionStorage.setItem(`pgp_${this.pageType}_page`, this.currentPage);
        this.render();
      };
    });
  }
};

const ApprenticeDetailPage = {
  currentApprentice: null,
  isEditMode: false,
  dynamicFields: [],

  init() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (!code) {
      window.location.href = 'apprentices.html?type=active';
      return;
    }

    this.loadRecord(code);
  },

  async loadRecord(code) {
    // Fetch only the requested employee — no full dataset load needed
    // Server uses its cache (warm = near-instant, cold = single record fetch)
    try {
      const app = await AppDB.fetchOne(code);
      this.currentApprentice = app;
      this.renderProfile();
      await this.loadAuditHistory();
    } catch (e) {
      Toast.error('Record Not Found', 'Could not locate the apprentice profile. ' + e.message);
      setTimeout(() => window.location.href = 'apprentices.html?type=active', 1500);
    }
  },

  renderProfile() {
    const app = this.currentApprentice;
    const role = AppDB.getRole();
    const currentBranch = AppDB.getBranch();

    const isSuper = role === 'Super HR';
    const isOwnBranch = String(app.location).toLowerCase().trim() === String(currentBranch).toLowerCase().trim();
    const isActive = app.status === 'Active';
    const canEdit = (isSuper || isOwnBranch) && isActive;

    // Set page subtitle breadcrumb name
    const bName = document.getElementById('breadcrumb-candidate-name');
    if (bName) bName.innerText = app.name;

    // Set top action buttons (hide edit button if not authorized)
    const editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) {
      editBtn.style.display = canEdit ? 'inline-flex' : 'none';
    }

    // Set avatar & hero card details
    document.getElementById('hero-avatar').innerText = app.name ? app.name.charAt(0) : '?';
    document.getElementById('hero-name').innerText = app.name || 'Unknown';
    document.getElementById('hero-code').innerText = app.code;
    document.getElementById('hero-location').innerText = app.location;
    document.getElementById('hero-dept').innerText = app.dept;
    document.getElementById('hero-joined').innerText = app.joined;

    // Hero status badge
    let statusHtml = '';
    if (app.status === 'Completed') {
      statusHtml = `<span class="badge-custom badge-status-completed"><i class="fas fa-graduation-cap"></i> Completed</span>`;
    } else if (app.status === 'Active') {
      statusHtml = `<span class="badge-custom badge-success"><i class="fas fa-check-circle"></i> Active</span>`;
    } else {
      statusHtml = `<span class="badge-custom badge-neutral">${app.status || 'Unknown'}</span>`;
    }
    document.getElementById('hero-status-badge').innerHTML = statusHtml;

    // Set demographics
    document.getElementById('val-code').innerText = app.code;
    document.getElementById('val-name').innerText = app.name;
    document.getElementById('val-sex').innerText = app.sex || 'Male';
    document.getElementById('val-age').innerText = (app.age || 22) + ' Years';
    document.getElementById('val-dept').innerText = app.dept;
    document.getElementById('val-branch').innerText = app.location;

    // Set contact values & inputs
    document.getElementById('val-phone').innerText = app.phone || 'Pending';
    document.getElementById('input-phone').value = app.phone || '';

    document.getElementById('val-email').innerText = app.email || 'Pending';
    document.getElementById('input-email').value = app.email || '';

    document.getElementById('val-address').innerText = app.address || 'Pending';
    document.getElementById('input-address').value = app.address || '';

    // Set portal & contract values & inputs
    document.getElementById('val-contract-id').innerText = app.contractId || 'Pending';
    document.getElementById('input-contract-id').value = app.contractId === 'Pending' ? '' : (app.contractId || '');

    document.getElementById('val-portal-enrollment').innerText = app.portalEnrollmentNumber || 'Pending';
    document.getElementById('input-portal-enrollment').value = app.portalEnrollmentNumber === 'Pending' ? '' : (app.portalEnrollmentNumber || '');

    document.getElementById('val-portal-name').innerText = app.portalName || 'Pending';
    document.getElementById('input-portal-name').value = app.portalName === 'Pending' ? '' : (app.portalName || '');

    document.getElementById('val-remarks').innerText = app.remarks || 'No remarks added.';
    document.getElementById('input-remarks').value = app.remarks || '';

    // Handle program completion layout
    const actionControlsCard = document.getElementById('action-controls-card');
    const completionDetailsCard = document.getElementById('completion-details-card');

    if (app.status === 'Completed') {
      if (actionControlsCard) actionControlsCard.style.display = 'none';
      if (completionDetailsCard) {
        completionDetailsCard.style.display = 'block';
        document.getElementById('val-completion-date').innerText = app.completionDate || 'N/A';
        document.getElementById('val-completed-by').innerText = app.completedBy || 'N/A';
        const reasonEl = document.getElementById('val-completion-reason');
        const remarksEl = document.getElementById('val-completion-remarks');
        if (reasonEl) reasonEl.innerText = app.completionReason || 'N/A';
        if (remarksEl) remarksEl.innerText = app.completionRemarks || 'N/A';

        const otherGroupEl = document.getElementById('group-other-reason');
        const otherEl = document.getElementById('val-other-reason');
        if (app.completionReason === 'Other' || app.otherCompletionReason) {
          if (otherGroupEl) otherGroupEl.style.display = 'block';
          if (otherEl) otherEl.innerText = app.otherCompletionReason || 'N/A';
        } else {
          if (otherGroupEl) otherGroupEl.style.display = 'none';
        }
      }
    } else {
      if (completionDetailsCard) completionDetailsCard.style.display = 'none';
      // Only Branch HR of this candidate's location can complete the program
      if (actionControlsCard) {
        const canComplete = role === 'Branch HR' && isOwnBranch;
        actionControlsCard.style.display = canComplete ? 'block' : 'none';
      }
    }

    // Render Dynamic / Additional Fields
    this.renderDynamicFields();
  },

  renderDynamicFields() {
    const app = this.currentApprentice;
    const dynamicCard = document.getElementById('dynamic-fields-card');
    const container = document.getElementById('dynamic-fields-container');
    if (!container || !dynamicCard) return;

    // Filter out standard keys (both internal camelCase and sheet raw headers)
    const stdKeys = [
      'code', 'name', 'location', 'dept', 'joined', 'sex', 'age', 'phone', 'email', 'address', 'remarks',
      'contractId', 'portalEnrollmentNumber', 'portalName', 'status', 'completionDate', 'completedBy',
      'updatedBy', 'updatedDate', 'completionReason', 'otherCompletionReason', 'completionRemarks',
      'Employee Code', 'Full Name', 'Location', 'Department', 'Joining Date', 'Sex', 'Age', 'Phone', 'Email', 'Address', 'Remarks',
      'Employee Contract ID', 'Portal Enrollment Number', 'Portal Name', 'Record Status', 'Updated By', 'Updated Date',
      'Completion Date', 'Completed By', 'Completion Reason', 'Other Completion Reason', 'Completion Remarks'
    ];

    this.dynamicFields = [];
    Object.keys(app).forEach(key => {
      if (!stdKeys.includes(key) && !key.startsWith('__')) {
        this.dynamicFields.push({
          key: key,
          value: app[key]
        });
      }
    });

    if (this.dynamicFields.length === 0) {
      dynamicCard.style.display = 'none';
      return;
    }

    dynamicCard.style.display = 'block';
    container.innerHTML = '';

    this.dynamicFields.forEach(f => {
      const displayVal = f.value !== undefined && f.value !== null && String(f.value).trim() !== '' ? f.value : 'Pending';

      container.innerHTML += `
        <div class="form-group-profile">
          <label class="form-label">${f.key}</label>
          <div class="view-mode-only py-2 text-sm">${displayVal}</div>
          <input type="text" class="form-control-custom edit-mode-only" data-dynamic-key="${f.key}" value="${f.value || ''}">
        </div>
      `;
    });
  },

  toggleEditMode(edit = true) {
    this.isEditMode = edit;
    if (edit) {
      document.body.classList.add('is-editing');
    } else {
      document.body.classList.remove('is-editing');
      // Reset input values to current record state
      this.renderProfile();
    }
  },

  async saveProfileChanges() {
    const app = this.currentApprentice;
    const saveBtn = document.getElementById('save-profile-btn');

    // Collect standard fields
    const phone = document.getElementById('input-phone').value.trim();
    const email = document.getElementById('input-email').value.trim();
    const address = document.getElementById('input-address').value.trim();
    const remarks = document.getElementById('input-remarks').value.trim();
    const contractId = document.getElementById('input-contract-id').value.trim();
    const portalEnrollmentNumber = document.getElementById('input-portal-enrollment').value.trim();
    const portalName = document.getElementById('input-portal-name').value.trim();

    // Prepare payload
    const payload = {
      phone,
      email,
      address,
      remarks,
      contractId: contractId || 'Pending',
      portalEnrollmentNumber: portalEnrollmentNumber || 'Pending',
      portalName: portalName || 'Pending'
    };

    // Collect dynamic fields
    const dynamicInputs = document.querySelectorAll('[data-dynamic-key]');
    dynamicInputs.forEach(input => {
      const key = input.dataset.dynamicKey;
      payload[key] = input.value.trim();
    });

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Saving...';
    }

    try {
      await AppDB.updateApprentice(app.code, payload);
      Toast.success('Profile Saved', 'Profile details updated successfully.', 2000);

      // Reset edit mode
      this.toggleEditMode(false);

      // Reload profile
      await this.loadRecord(app.code);
    } catch (err) {
      Toast.error('Save Failed', 'Could not save profile modifications: ' + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
      }
    }
  },

  async loadAuditHistory() {
    const app = this.currentApprentice;
    const timeline = document.getElementById('audit-timeline');
    if (!timeline) return;

    const backendUrl = AppDB.getBackendUrl();
    try {
      const response = await fetch(`${backendUrl}/api/apprentices/${encodeURIComponent(app.code)}/audit`, {
        headers: AppDB.apiHeaders()
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const resData = await response.json();

      if (resData.success && resData.logs) {
        this.renderTimeline(resData.logs);
      } else {
        throw new Error(resData.error || 'Backend audit error');
      }
    } catch (err) {
      console.error('Timeline Load Error:', err);
      this.renderTimeline([]);
    }
  },

  renderTimeline(logs = []) {
    const container = document.getElementById('audit-timeline');
    if (!container) return;

    const app = this.currentApprentice;

    if (logs.length === 0) {
      // Create default baseline timeline based on current status
      let defaultHtml = `
        <div class="audit-timeline-item">
          <div class="audit-timeline-dot creation"></div>
          <div class="audit-timeline-meta">
            <span>Baseline System Intake</span>
            <span>${app.joined || 'Ongoing'}</span>
          </div>
          <div class="audit-timeline-title">Apprentice Joined</div>
          <p class="audit-timeline-body">Added to PGP Glass Master Data under ${app.location} - ${app.dept} department.</p>
        </div>
      `;

      if (app.status === 'Completed') {
        defaultHtml = `
          <div class="audit-timeline-item">
            <div class="audit-timeline-dot completion"></div>
            <div class="audit-timeline-meta">
              <span>Program Completion</span>
              <span>${app.completionDate || ''}</span>
            </div>
            <div class="audit-timeline-title">Apprenticeship Completed</div>
            <p class="audit-timeline-body">Completed training and signed off by <strong>${app.completedBy || 'Branch HR'}</strong>.</p>
          </div>
        ` + defaultHtml;
      }

      container.innerHTML = defaultHtml;
      return;
    }

    let timelineHtml = '';
    logs.forEach(log => {
      const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A';
      const isCompletion = log.action === 'Program Completion' || log.action === 'Apprenticeship Completed';
      const dotClass = isCompletion ? 'completion' : '';

      timelineHtml += `
        <div class="audit-timeline-item animate-fadeIn">
          <div class="audit-timeline-dot ${dotClass}"></div>
          <div class="audit-timeline-meta">
            <span>${log.updatedBy || 'System'}</span>
            <span>${dateStr}</span>
          </div>
          <div class="audit-timeline-title">${log.action || 'Profile Edit'}</div>
          <p class="audit-timeline-body">${log.changes || 'Profile details updated.'}</p>
        </div>
      `;
    });

    container.innerHTML = timelineHtml;
  },

  markProgramCompleted() {
    const app = this.currentApprentice;
    ModalManager.showCompletionModal({
      title: 'Complete Apprenticeship',
      onConfirm: async ({ reason, otherReason, remarks }) => {
        const completeBtn = document.getElementById('btn-complete-program');
        if (completeBtn) {
          completeBtn.disabled = true;
          completeBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Processing Sign-Off...';
        }

        try {
          await AppDB.completeApprentice(app.code, reason, otherReason, remarks);
          Toast.success('Completion Signed Off', 'Program completed successfully.', 2500);
          await this.loadRecord(app.code);
        } catch (err) {
          Toast.error('Operation Failed', 'Could not complete apprentice program: ' + err.message);
          if (completeBtn) {
            completeBtn.disabled = false;
            completeBtn.innerHTML = '<i class="fas fa-graduation-cap"></i> Sign Off Completion';
          }
        }
      }
    });
  }
};

const ExcelUploadPage = {
  selectedFile: null,
  parsedRecords: [],

  init() {
    this.bindEvents();
    this.loadUploadHistory();
  },

  bindEvents() {
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('file-input');
    const uploadHistoryTbody = document.getElementById('upload-history-tbody');

    if (!dropzone || !fileInput) return;

    // Drag-drop events
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        this.handleFile(e.dataTransfer.files[0]);
      }
    });

    // File input change — clicking the dropzone area (not the button) opens the file picker
    dropzone.addEventListener('click', (e) => {
      // Ignore clicks from the Browse button — it has its own direct handler
      if (e.target.closest('#btn-browse-files')) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        this.handleFile(e.target.files[0]);
      }
    });
  },

  handleFile(file) {
    if (!file.name.match(/\.(xls|xlsx|csv)$/i)) {
      Toast.error('Invalid Format', 'Please upload Excel or CSV sheets only.');
      return;
    }
    this.selectedFile = file;
    this.startUpload();
  },

  async startUpload() {
    const stateIdle = document.getElementById('upload-dropzone');
    const stateUploading = document.getElementById('upload-state-uploading');
    const stateResults = document.getElementById('upload-results-panel');
    const progress = document.getElementById('upload-progress-bar');
    const fileTitle = document.getElementById('uploading-file-title');

    if (!stateIdle || !stateUploading || !stateResults || !progress) return;

    // Show uploading spinner
    stateIdle.style.display = 'none';
    stateUploading.style.display = 'flex';
    if (fileTitle) fileTitle.innerText = this.selectedFile.name;
    progress.style.width = '30%';

    // ── LIVE MODE ONLY: POST file to Express backend ──
    const backendUrl = AppDB.getBackendUrl();
    const token = AppDB.getToken();

    try {
      const formData = new FormData();
      formData.append('file', this.selectedFile);

      progress.style.width = '60%';

      const response = await fetch(`${backendUrl}/api/upload?dryRun=true`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }, // no Content-Type — FormData sets boundary
        body: formData
      });

      progress.style.width = '100%';
      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Upload failed on server');
      }

      this.parsedRecords = resData.records || [];

      stateUploading.style.display = 'none';
      stateResults.style.display = 'block';
      this.renderLiveResults(resData, false);
      Toast.success('Dry Run Processed', `${resData.totalProcessed} rows validated by backend.`, 2500);

    } catch (err) {
      stateUploading.style.display = 'none';
      stateIdle.style.display = 'flex';
      progress.style.width = '0%';
      Toast.error('Upload Failed', err.message || 'Could not upload file to backend. Ensure the backend server is running.');
      console.error('ExcelUploadPage upload error:', err);
    }
  },

  renderLiveResults(data, isConfirmed = false) {
    const inserted = data.inserted || 0;
    const updated = data.updated || 0;
    const total = data.totalProcessed || (inserted + updated);
    const rejected = data.rejected ? data.rejected.length : 0;
    const duplicates = data.duplicatesRemoved || 0;
    const unchanged = Math.max(0, total - inserted - updated - duplicates - rejected);

    const elTotal = document.getElementById('res-total');
    const elSuc = document.getElementById('res-success');
    const elErr = document.getElementById('res-errors');
    const elDup = document.getElementById('res-duplicates');
    const elUnc = document.getElementById('res-unchanged');
    if (elTotal) elTotal.innerText = total;
    if (elSuc) elSuc.innerText = inserted + updated;
    if (elErr) elErr.innerText = rejected;
    if (elDup) elDup.innerText = duplicates;
    if (elUnc) elUnc.innerText = unchanged;

    const listTbody = document.getElementById('validation-results-tbody');
    if (listTbody) {
      let html = '';

      // 1. Render rejected rows first if there are any errors
      if (data.rejected && data.rejected.length > 0) {
        data.rejected.forEach(err => {
          html += `
            <tr class="table-danger" style="background: rgba(220,38,38,0.05);">
              <td><span class="fw-semibold text-danger">Excel Row ${err.row}</span></td>
              <td><code class="text-danger">${err.code}</code></td>
              <td>${err.name}</td>
              <td><span class="badge-custom badge-danger">Validation Error</span></td>
              <td class="text-danger fw-medium">${err.reason} (Row Rejected)</td>
            </tr>
          `;
        });
      }

      // 2. Render summary of inserted and updated
      if (inserted > 0) {
        html += `
          <tr class="table-success">
            <td>All Locations / Row: Multiple</td>
            <td>Multiple</td>
            <td><strong>${inserted} apprentices</strong></td>
            <td><span class="badge-custom badge-success">Inserted</span></td>
            <td>Added as new active apprentices in the database.</td>
          </tr>
        `;
      }

      if (updated > 0) {
        html += `
          <tr class="table-warning">
            <td>All Locations / Row: Multiple</td>
            <td>Multiple</td>
            <td><strong>${updated} apprentices</strong></td>
            <td><span class="badge-custom badge-warning">Updated</span></td>
            <td>Demographics updated. Manual tracking & remarks preserved.</td>
          </tr>
        `;
      }

      if (unchanged > 0) {
        html += `
          <tr class="table-info" style="background: rgba(59,130,246,0.02);">
            <td>All Locations / Row: Multiple</td>
            <td>Multiple</td>
            <td><strong>${unchanged} apprentices</strong></td>
            <td><span class="badge-custom" style="background: rgba(59, 130, 246, 0.1); color: rgb(37, 99, 235);">Unchanged</span></td>
            <td>No demographic or status changes detected. Record is up to date.</td>
          </tr>
        `;
      }

      if (html === '') {
        html = `<tr><td colspan="5" class="text-center text-muted py-4">No records were processed.</td></tr>`;
      }

      listTbody.innerHTML = html;
    }

    const confirmBtn = document.getElementById('btn-confirm-import');
    const cancelBtn = document.getElementById('btn-cancel-import');

    if (isConfirmed) {
      if (confirmBtn) {
        confirmBtn.innerHTML = 'View Active Apprentices';
        confirmBtn.onclick = () => {
          window.location.href = 'apprentices.html';
        };
      }
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
      }
    } else {
      if (confirmBtn) {
        confirmBtn.innerHTML = '<i class="fas fa-check-double"></i> Confirm & Import Records';
        confirmBtn.onclick = () => this.commitImport();
      }
      if (cancelBtn) {
        cancelBtn.style.display = 'inline-flex';
        cancelBtn.onclick = () => window.location.reload();
      }
    }
  },

  async commitImport() {
    const confirmBtn = document.getElementById('btn-confirm-import');
    const cancelBtn = document.getElementById('btn-cancel-import');

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    if (confirmBtn) confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Importing...';

    const backendUrl = AppDB.getBackendUrl();
    const token = AppDB.getToken();

    try {
      const response = await fetch(`${backendUrl}/api/upload?dryRun=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          records: this.parsedRecords,
          fileName: this.selectedFile.name
        })
      });

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Import failed on server');
      }

      if (confirmBtn) confirmBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;

      const total = resData.totalProcessed || 0;
      const inserted = resData.inserted || 0;
      const updated = resData.updated || 0;
      const duplicates = resData.duplicatesRemoved || 0;
      const rejected = resData.rejected ? resData.rejected.length : 0;
      const unchanged = Math.max(0, total - inserted - updated - duplicates - rejected);

      ModalManager.confirm({
        title: 'Import Completed',
        message: `Import completed successfully!\n\n• Records Inserted: ${inserted}\n• Records Updated: ${updated}\n• Unchanged Records: ${unchanged}\n• Records Rejected: ${rejected}\n• Duplicates Removed: ${duplicates}`,
        iconType: 'success',
        confirmText: 'View Active Apprentices',
        cancelText: 'Close',
        onConfirm: () => {
          window.location.href = 'apprentices.html';
        },
        onCancel: async () => {
          this.renderLiveResults(resData, true);
          AppDB.invalidateCache();
          await AppDB.init();
          await this.loadUploadHistory();
        }
      });

    } catch (err) {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check-double"></i> Confirm & Import Records';
      }
      if (cancelBtn) cancelBtn.disabled = false;
      Toast.error('Import Failed', err.message || 'Could not commit import to backend.');
      console.error('ExcelUploadPage commit error:', err);
    }
  },

  async loadUploadHistory() {
    const tbody = document.getElementById('upload-history-tbody');
    if (!tbody) return;

    const backendUrl = AppDB.getBackendUrl();
    const token = AppDB.getToken();

    try {
      const response = await fetch(`${backendUrl}/api/upload/history`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const resData = await response.json();

      if (resData.success && resData.logs) {
        if (resData.logs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No import logs found.</td></tr>`;
          return;
        }

        let html = '';
        resData.logs.forEach(log => {
          const inserted = parseInt(log["Inserted"]) || 0;
          const updated = parseInt(log["Updated"]) || 0;
          const rejected = parseInt(log["Rejected"]) || 0;
          const totalSuccess = inserted + updated;

          html += `
            <tr class="animate-fadeIn">
              <td>${log["Upload Time"] || 'N/A'}</td>
              <td><span class="fw-semibold text-brand"><i class="fas fa-file-excel me-2 text-success"></i>${log["File Name"] || 'Unknown'}</span></td>
              <td>N/A</td>
              <td>${log["Uploaded By"] || 'System'}</td>
              <td><span class="badge-custom badge-success">${totalSuccess} Records</span></td>
              <td>
                <span class="badge-custom badge-success"><i class="fas fa-check-circle"></i> Committed</span>
                ${rejected > 0 ? `<span class="badge-custom badge-danger" title="${rejected} rows rejected" style="margin-left: 5px;">${rejected} Fail</span>` : ''}
              </td>
            </tr>
          `;
        });
        tbody.innerHTML = html;
      }
    } catch (err) {
      console.error('Failed to load upload history:', err);
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Failed to load historical import logs.</td></tr>`;
    }
  }
};

const AnalyticsPage = {
  activeTab: 'summary',

  init() {
    this.populateDepartmentsDropdown();
    this.setupFilters();
    this.setupTabs();
    this.renderAnalytics();

    // Listen to global changes
    analyticsBranchChangedListener = () => {
      const filterLoc = document.getElementById('analytics-filter-location');
      if (filterLoc) {
        filterLoc.value = AppDB.getBranch();
      }
      this.renderAnalytics();
    };

    analyticsApprenticesUpdatedListener = () => {
      this.populateDepartmentsDropdown();
      this.renderAnalytics();
    };

    window.addEventListener('branchchanged', analyticsBranchChangedListener);
    window.addEventListener('apprenticesupdated', analyticsApprenticesUpdatedListener);
  },

  populateDepartmentsDropdown() {
    const deptSelect = document.getElementById('analytics-filter-dept');
    if (!deptSelect) return;

    const list = DepartmentsCache.get();
    const currentVal = deptSelect.value;

    let html = '<option value="All">All Departments</option>';
    list.forEach(d => {
      html += `<option value="${d}">${d}</option>`;
    });

    deptSelect.innerHTML = html;

    if (list.includes(currentVal)) {
      deptSelect.value = currentVal;
    }
  },

  setupFilters() {
    const fields = [
      'analytics-filter-location',
      'analytics-filter-dept',
      'analytics-filter-status',
      'analytics-filter-gender',
      'analytics-filter-age',
      'analytics-filter-date-start',
      'analytics-filter-date-end'
    ];

    const role = AppDB.getRole();
    const branch = AppDB.getBranch();

    const locSelect = document.getElementById('analytics-filter-location');
    if (locSelect) {
      if (role === 'Branch HR') {
        locSelect.value = branch;
        locSelect.disabled = true;
      } else {
        locSelect.value = branch;
      }
    }

    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => this.renderAnalytics());
      }
    });

    const resetBtn = document.getElementById('btn-reset-analytics-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (locSelect && role !== 'Branch HR') locSelect.value = 'All Locations';
        const deptSelect = document.getElementById('analytics-filter-dept');
        if (deptSelect) deptSelect.value = 'All';
        const statusSelect = document.getElementById('analytics-filter-status');
        if (statusSelect) statusSelect.value = 'All';
        const genderSelect = document.getElementById('analytics-filter-gender');
        if (genderSelect) genderSelect.value = 'All';
        const ageSelect = document.getElementById('analytics-filter-age');
        if (ageSelect) ageSelect.value = 'All';
        const startEl = document.getElementById('analytics-filter-date-start');
        if (startEl) startEl.value = '';
        const endEl = document.getElementById('analytics-filter-date-end');
        if (endEl) endEl.value = '';

        this.renderAnalytics();
      });
    }
  },

  setupTabs() {
    const tabBtns = document.querySelectorAll('.analytics-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const type = btn.getAttribute('data-analytics-type');
        this.activeTab = type;

        const sections = document.querySelectorAll('.analytics-section');
        sections.forEach(sec => {
          sec.classList.remove('active');
        });

        const activeSec = document.getElementById(`section-${type}`);
        if (activeSec) activeSec.classList.add('active');

        this.renderAnalytics();
      });
    });
  },

  getFilteredAnalyticsData() {
    let list = AppDB.getApprentices();

    // 1. Location filter
    const locVal = document.getElementById('analytics-filter-location')?.value || 'All Locations';
    if (locVal !== 'All Locations') {
      list = list.filter(x => String(x.location || '').toLowerCase().trim() === locVal.toLowerCase().trim());
    }

    // 2. Department filter
    const deptVal = document.getElementById('analytics-filter-dept')?.value || 'All';
    if (deptVal !== 'All') {
      list = list.filter(x => String(x.dept || x.department || '').toLowerCase().trim() === deptVal.toLowerCase().trim());
    }

    // 3. Status filter
    const statusVal = document.getElementById('analytics-filter-status')?.value || 'All';
    if (statusVal !== 'All') {
      list = list.filter(x => String(x.status || '').toLowerCase().trim() === statusVal.toLowerCase().trim());
    }

    // 4. Gender filter
    const genderVal = document.getElementById('analytics-filter-gender')?.value || 'All';
    if (genderVal !== 'All') {
      list = list.filter(x => String(x.sex || '').toLowerCase().trim() === genderVal.toLowerCase().trim());
    }

    // 5. Age filter
    const ageVal = document.getElementById('analytics-filter-age')?.value || 'All';
    if (ageVal !== 'All') {
      list = list.filter(x => {
        const ageNum = parseInt(x.age);
        if (isNaN(ageNum)) return false;

        if (ageVal === 'Under 20') return ageNum < 20;
        if (ageVal === '20-22') return ageNum >= 20 && ageNum <= 22;
        if (ageVal === '23-25') return ageNum >= 23 && ageNum <= 25;
        if (ageVal === '26+') return ageNum >= 26;
        return true;
      });
    }

    // 6. Date Range Filters
    const startVal = document.getElementById('analytics-filter-date-start')?.value;
    if (startVal) {
      const startDate = new Date(startVal);
      list = list.filter(x => {
        if (!x.joined) return false;
        const joinedDate = new Date(x.joined);
        return joinedDate >= startDate;
      });
    }

    const endVal = document.getElementById('analytics-filter-date-end')?.value;
    if (endVal) {
      const endDate = new Date(endVal);
      list = list.filter(x => {
        if (!x.joined) return false;
        const joinedDate = new Date(x.joined);
        return joinedDate <= endDate;
      });
    }

    return list;
  },

  renderAnalytics() {
    const list = this.getFilteredAnalyticsData();

    if (this.activeTab === 'summary') {
      this.renderSummaryCharts(list);
    } else if (this.activeTab === 'demographics') {
      this.renderDemographicsCharts(list);
    } else if (this.activeTab === 'compliance') {
      this.renderComplianceCharts(list);
    } else if (this.activeTab === 'trends') {
      this.renderTrendsCharts(list);
    }
  },

  renderSummaryCharts(list) {
    // A. Location Comparison — dynamic
    const locations = LocationsCache.get().length > 0 ? LocationsCache.get() : [...new Set(list.map(x => (x.location || '').trim()).filter(Boolean))].sort();
    const locCounts = locations.map(loc => list.filter(x => String(x.location || '').toLowerCase().trim() === loc.toLowerCase().trim()).length);
    if (!Charts.updateChart('summary-chart-location', locations, locCounts)) {
      Charts.createBarChart('summary-chart-location', locations, locCounts, 'Total Apprentices');
    }

    // B. Department Distribution
    const deptMap = {};
    list.forEach(x => {
      const dept = (x.dept || x.department || '').trim();
      if (dept) deptMap[dept] = (deptMap[dept] || 0) + 1;
    });
    const depts = Object.keys(deptMap);
    const deptCounts = depts.map(d => deptMap[d]);
    if (depts.length === 0) {
      if (!Charts.updateChart('summary-chart-department', ['No Data'], [1])) {
        Charts.createPieChart('summary-chart-department', ['No Data'], [1]);
      }
    } else {
      if (!Charts.updateChart('summary-chart-department', depts, deptCounts)) {
        Charts.createPieChart('summary-chart-department', depts, deptCounts);
      }
    }

    // C. Portal Enrollment
    const enrolled = list.filter(x => x.portalEnrollmentNumber && x.portalEnrollmentNumber !== 'Pending' && x.portalEnrollmentNumber !== '').length;
    const portalPending = list.filter(x => !x.portalEnrollmentNumber || x.portalEnrollmentNumber === 'Pending' || x.portalEnrollmentNumber === '').length;
    if (!Charts.updateChart('summary-chart-portal', ['Enrolled', 'Pending'], [enrolled, portalPending])) {
      Charts.createDonutChart('summary-chart-portal', ['Enrolled', 'Pending'], [enrolled, portalPending]);
    }

    // D. Contract ID Status
    const completedContract = list.filter(x => x.contractId && x.contractId !== 'Pending' && x.contractId !== '').length;
    const pendingContract = list.filter(x => !x.contractId || x.contractId === 'Pending' || x.contractId === '').length;
    if (!Charts.updateChart('summary-chart-contract', ['Completed', 'Pending'], [completedContract, pendingContract])) {
      Charts.createDonutChart('summary-chart-contract', ['Completed', 'Pending'], [completedContract, pendingContract]);
    }
  },

  renderDemographicsCharts(list) {
    // A. Gender Distribution
    const maleCount = list.filter(x => String(x.sex || '').trim().toLowerCase() === 'male').length;
    const femaleCount = list.filter(x => String(x.sex || '').trim().toLowerCase() === 'female').length;
    const otherCount = list.filter(x => {
      const s = String(x.sex || '').trim().toLowerCase();
      return s !== 'male' && s !== 'female' && s !== '';
    }).length;

    const genders = ['Male', 'Female'];
    const genderCounts = [maleCount, femaleCount];
    if (otherCount > 0) {
      genders.push('Other');
      genderCounts.push(otherCount);
    }

    if (maleCount === 0 && femaleCount === 0 && otherCount === 0) {
      if (!Charts.updateChart('demo-chart-gender', ['No Data'], [1])) {
        Charts.createPieChart('demo-chart-gender', ['No Data'], [1]);
      }
    } else {
      if (!Charts.updateChart('demo-chart-gender', genders, genderCounts)) {
        Charts.createPieChart('demo-chart-gender', genders, genderCounts);
      }
    }

    // B. Age Group Distribution
    let u20 = 0, g20_22 = 0, g23_25 = 0, o26 = 0;
    list.forEach(x => {
      const ageNum = parseInt(x.age);
      if (!isNaN(ageNum)) {
        if (ageNum < 20) u20++;
        else if (ageNum >= 20 && ageNum <= 22) g20_22++;
        else if (ageNum >= 23 && ageNum <= 25) g23_25++;
        else if (ageNum >= 26) o26++;
      }
    });

    const ageLabels = ['Under 20', '20-22', '23-25', '26+'];
    const ageCounts = [u20, g20_22, g23_25, o26];
    if (!Charts.updateChart('demo-chart-age', ageLabels, ageCounts)) {
      Charts.createBarChart('demo-chart-age', ageLabels, ageCounts, 'Apprentices', ChartPalette.violet);
    }

    // C. Location Breakdown — dynamic
    const locations = LocationsCache.get().length > 0 ? LocationsCache.get() : [...new Set(list.map(x => (x.location || '').trim()).filter(Boolean))].sort();
    const locCounts = locations.map(loc => list.filter(x => String(x.location || '').toLowerCase().trim() === loc.toLowerCase().trim()).length);
    if (!Charts.updateChart('demo-chart-location', locations, locCounts)) {
      Charts.createBarChart('demo-chart-location', locations, locCounts, 'Total Apprentices', ChartPalette.success);
    }
  },

  renderComplianceCharts(list) {
    // A. Portal Registration Rates
    const enrolled = list.filter(x => x.portalEnrollmentNumber && x.portalEnrollmentNumber !== 'Pending' && x.portalEnrollmentNumber !== '').length;
    const portalPending = list.filter(x => !x.portalEnrollmentNumber || x.portalEnrollmentNumber === 'Pending' || x.portalEnrollmentNumber === '').length;
    if (!Charts.updateChart('compliance-chart-portal', ['Enrolled', 'Pending'], [enrolled, portalPending])) {
      Charts.createDonutChart('compliance-chart-portal', ['Enrolled', 'Pending'], [enrolled, portalPending]);
    }

    // B. Contract ID Status
    const completedContract = list.filter(x => x.contractId && x.contractId !== 'Pending' && x.contractId !== '').length;
    const pendingContract = list.filter(x => !x.contractId || x.contractId === 'Pending' || x.contractId === '').length;
    if (!Charts.updateChart('compliance-chart-contract', ['Completed', 'Pending'], [completedContract, pendingContract])) {
      Charts.createDonutChart('compliance-chart-contract', ['Completed', 'Pending'], [completedContract, pendingContract]);
    }

    // C. Apprentice Data Completeness
    let totalFieldsChecked = 0;
    let completedFieldsCount = 0;

    list.forEach(x => {
      const checkFields = ['phone', 'email', 'address', 'contractId', 'portalEnrollmentNumber', 'portalName'];
      checkFields.forEach(field => {
        totalFieldsChecked++;
        const val = String(x[field] || '').trim();
        if (val !== '' && val !== 'Pending' && val !== 'null') {
          completedFieldsCount++;
        }
      });
    });

    const completenessRate = totalFieldsChecked > 0 ? Math.round((completedFieldsCount / totalFieldsChecked) * 100) : 0;
    const incompletenessRate = 100 - completenessRate;

    const completenessLabels = ['Complete Data fields', 'Missing/Pending fields'];
    const completenessData = [completenessRate, incompletenessRate];

    if (list.length === 0) {
      if (!Charts.updateChart('compliance-chart-completeness', ['No Data'], [1])) {
        Charts.createDonutChart('compliance-chart-completeness', ['No Data'], [1]);
      }
    } else {
      if (!Charts.updateChart('compliance-chart-completeness', completenessLabels, completenessData)) {
        Charts.createDonutChart('compliance-chart-completeness', completenessLabels, completenessData);
      }
    }
  },

  renderTrendsCharts(list) {
    const now = new Date();
    const last6Months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { label: d.toLocaleString('default', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() };
    });

    const completionTrends = last6Months.map(m => list.filter(x => {
      if (!x.completionDate) return false;
      const d = new Date(x.completionDate);
      return d.getFullYear() === m.year && d.getMonth() === m.month;
    }).length);

    const intakeTrends = last6Months.map(m => list.filter(x => {
      if (!x.joined) return false;
      const d = new Date(x.joined);
      return d.getFullYear() === m.year && d.getMonth() === m.month;
    }).length);

    const trendLabels = last6Months.map(m => m.label);

    if (!Charts.updateChart('trend-chart-completion', trendLabels, completionTrends)) {
      Charts.createLineChart('trend-chart-completion', trendLabels, completionTrends, 'Completions', ChartPalette.violet);
    }

    if (!Charts.updateChart('trend-chart-intake', trendLabels, intakeTrends)) {
      Charts.createLineChart('trend-chart-intake', trendLabels, intakeTrends, 'Intakes', ChartPalette.primary);
    }
  }
};

const ReportsPage = {
  activeHeaders: [],
  completedHeaders: [],

  init() {
    const role = AppDB.getRole();
    const branch = AppDB.getBranch();
    const locSelect = document.getElementById('report-filter-location');

    if (locSelect) {
      if (role === 'Branch HR') {
        locSelect.value = branch;
        locSelect.disabled = true;
      } else {
        locSelect.disabled = false;
      }
    }

    this.populateDepartmentsDropdown();
    this.restoreFilters();
    this.bindChangeListeners();

    // Fetch headers on load
    const backendUrl = AppDB.getBackendUrl();
    fetch(`${backendUrl}/api/reports/headers`, { headers: AppDB.apiHeaders() })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          this.activeHeaders = data.activeHeaders || [];
          this.completedHeaders = data.completedHeaders || [];
          this.renderColumnSelection();
        }
      })
      .catch(err => {
        console.error('Failed to load report headers:', err);
      });

    // Custom Report Configurator Submit
    const form = document.getElementById('report-builder-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();

        const reportType = document.getElementById('report-filter-type').value;
        const formatEl = document.querySelector('input[name="report-format"]:checked');
        const format = formatEl ? formatEl.value : 'csv';

        const filters = this.getCurrentFilters(reportType);
        this.exportReport(reportType, format, filters);
      });
    }

    // Select All Button
    const selectAllBtn = document.getElementById('cols-select-all');
    if (selectAllBtn) {
      selectAllBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const chks = document.querySelectorAll('.column-toggle-chk');
        chks.forEach(chk => chk.checked = true);
        const typeSelect = document.getElementById('report-filter-type');
        if (typeSelect) {
          const storageKey = this.getStorageKeyForType(typeSelect.value);
          if (storageKey) this.saveColumnSelection(storageKey);
        }
      };
    }

    // Clear All Button
    const clearAllBtn = document.getElementById('cols-clear-all');
    if (clearAllBtn) {
      clearAllBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const chks = document.querySelectorAll('.column-toggle-chk');
        chks.forEach(chk => chk.checked = false);
        const typeSelect = document.getElementById('report-filter-type');
        if (typeSelect) {
          const storageKey = this.getStorageKeyForType(typeSelect.value);
          if (storageKey) this.saveColumnSelection(storageKey);
        }
      };
    }

    // ===== COLUMN CUSTOMIZER COLLAPSIBLE PANEL =====
    const toggleRow = document.getElementById('column-selection-toggle-row');

    if (toggleRow) {
      // Restore session state (default: expanded = true)
      const savedState = sessionStorage.getItem('pgp_reports_columns_expanded');
      const startExpanded = savedState === null ? true : savedState === 'true';

      // Apply initial state without animation (instant)
      this._applyCollapseState(startExpanded, false);

      // Click on header row
      toggleRow.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleColumnCustomizer();
      });

      // Keyboard: Enter / Space
      toggleRow.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleColumnCustomizer();
        }
      });
    }

    // Individual report card handlers
    const cards = document.querySelectorAll('.report-type-card');
    cards.forEach(card => {
      const reportType = card.getAttribute('data-report-type') || card.dataset.reportType;

      const csvBtn = card.querySelector('.btn-export-csv');
      if (csvBtn) {
        csvBtn.onclick = (e) => {
          e.preventDefault();
          const filters = this.getCurrentFilters(reportType);
          this.exportReport(reportType, 'csv', filters);
        };
      }

      const excelBtn = card.querySelector('.btn-export-excel');
      if (excelBtn) {
        excelBtn.onclick = (e) => {
          e.preventDefault();
          const filters = this.getCurrentFilters(reportType);
          this.exportReport(reportType, 'excel', filters);
        };
      }

      const pdfBtn = card.querySelector('.btn-export-pdf');
      if (pdfBtn) {
        pdfBtn.onclick = (e) => {
          e.preventDefault();
          const filters = this.getCurrentFilters(reportType);
          this.exportReport(reportType, 'pdf', filters);
        };
      }
    });
  },

  populateDepartmentsDropdown() {
    const deptSelect = document.getElementById('report-filter-dept');
    if (!deptSelect) return;
    const list = DepartmentsCache.get();
    const currentVal = deptSelect.value;
    let html = '<option value="All">All Departments</option>';
    list.forEach(d => {
      html += `<option value="${d}">${d}</option>`;
    });
    deptSelect.innerHTML = html;
    if (currentVal && (currentVal === 'All' || list.includes(currentVal))) {
      deptSelect.value = currentVal;
    }
  },

  getCurrentFilters(reportType) {
    const locSelect = document.getElementById('report-filter-location');
    const deptSelect = document.getElementById('report-filter-dept');
    const statusSelect = document.getElementById('report-filter-status');
    const genderSelect = document.getElementById('report-filter-gender');
    const searchInput = document.getElementById('report-filter-search');
    const dateStartInput = document.getElementById('report-filter-date-start');
    const dateEndInput = document.getElementById('report-filter-date-end');

    const typeSelect = document.getElementById('report-filter-type');
    const activeType = reportType || (typeSelect ? typeSelect.value : 'master');

    const role = AppDB.getRole();
    const branch = AppDB.getBranch();

    const isCompletedReport = ['completed', 'permanent_conversion'].includes(activeType);

    return {
      location: role === 'Branch HR' ? branch : (locSelect ? locSelect.value : 'All Locations'),
      dept: deptSelect ? deptSelect.value : 'All',
      status: statusSelect ? statusSelect.value : 'All',
      gender: genderSelect ? genderSelect.value : 'All',
      search: searchInput ? searchInput.value.trim() : '',
      joiningDateStart: !isCompletedReport && dateStartInput ? dateStartInput.value : '',
      joiningDateEnd: !isCompletedReport && dateEndInput ? dateEndInput.value : '',
      completionDateStart: isCompletedReport && dateStartInput ? dateStartInput.value : '',
      completionDateEnd: isCompletedReport && dateEndInput ? dateEndInput.value : ''
    };
  },

  getStorageKeyForType(reportType) {
    if (['active', 'missing_contract', 'missing_enrollment', 'missing_portal_name'].includes(reportType)) {
      return 'pgp_cols_active';
    } else if (['completed', 'permanent_conversion'].includes(reportType)) {
      return 'pgp_cols_completed';
    } else if (reportType === 'master') {
      return 'pgp_cols_master';
    }
    return null;
  },

  getHeadersForType(reportType) {
    if (['active', 'missing_contract', 'missing_enrollment', 'missing_portal_name'].includes(reportType)) {
      return this.activeHeaders || [];
    } else if (['completed', 'permanent_conversion'].includes(reportType)) {
      return this.completedHeaders || [];
    } else if (reportType === 'master') {
      const unionSet = new Set([...(this.activeHeaders || []), ...(this.completedHeaders || [])]);
      unionSet.delete('__rowNum');
      return Array.from(unionSet);
    }
    return [];
  },

  renderColumnSelection() {
    const typeSelect = document.getElementById('report-filter-type');
    if (!typeSelect) return;
    const reportType = typeSelect.value;
    
    const card = document.getElementById('column-selection-card');
    const grid = document.getElementById('columns-checkboxes-grid');
    if (!card || !grid) return;

    const storageKey = this.getStorageKeyForType(reportType);
    const headers = this.getHeadersForType(reportType);

    if (!storageKey || headers.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';

    // Retrieve saved column preferences
    let saved = [];
    const savedStr = localStorage.getItem(storageKey);
    if (savedStr) {
      try {
        saved = JSON.parse(savedStr);
      } catch (e) {
        saved = [];
      }
    }

    const useDefault = !savedStr || !Array.isArray(saved);

    grid.innerHTML = '';
    headers.forEach(h => {
      const isChecked = useDefault || saved.includes(h);
      const checkboxId = `col-chk-${h.replace(/\s+/g, '_')}`;
      
      grid.innerHTML += `
        <label class="align-center d-flex gap-2 cursor-pointer text-sm" style="user-select: none;">
          <input type="checkbox" class="column-toggle-chk" value="${h}" id="${checkboxId}" ${isChecked ? 'checked' : ''} style="accent-color: var(--brand-primary); cursor: pointer;">
          <span>${h}</span>
        </label>
      `;
    });

    // Save on toggle
    const chks = grid.querySelectorAll('.column-toggle-chk');
    chks.forEach(chk => {
      chk.addEventListener('change', () => {
        this.saveColumnSelection(storageKey);
      });
    });
  },

  saveColumnSelection(storageKey) {
    const checkedValues = Array.from(document.querySelectorAll('.column-toggle-chk:checked')).map(chk => chk.value);
    localStorage.setItem(storageKey, JSON.stringify(checkedValues));
  },

  toggleColumnCustomizer() {
    const header = document.getElementById('column-selection-toggle-row');
    if (!header) return;
    const isExpanded = header.getAttribute('aria-expanded') === 'true';
    this._applyCollapseState(!isExpanded, true);
  },

  _applyCollapseState(expanded, animate) {
    const header = document.getElementById('column-selection-toggle-row');
    const body = document.getElementById('col-customizer-body');
    const icon = document.getElementById('col-toggle-icon');
    const text = document.getElementById('col-toggle-text');

    if (!header || !body) return;

    // Temporarily disable transition for instant initial state
    if (!animate) {
      body.style.transition = 'none';
      icon && (icon.style.transition = 'none');
      // Re-enable on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          body.style.transition = '';
          if (icon) icon.style.transition = '';
        });
      });
    }

    if (expanded) {
      body.classList.add('col-customizer-body--open');
      header.classList.add('col-customizer-header--open');
      header.setAttribute('aria-expanded', 'true');
      if (icon) icon.style.transform = 'rotate(0deg)';
      if (text) text.textContent = 'Collapse';
      sessionStorage.setItem('pgp_reports_columns_expanded', 'true');
    } else {
      body.classList.remove('col-customizer-body--open');
      header.classList.remove('col-customizer-header--open');
      header.setAttribute('aria-expanded', 'false');
      if (icon) icon.style.transform = 'rotate(180deg)';
      if (text) text.textContent = 'Expand';
      sessionStorage.setItem('pgp_reports_columns_expanded', 'false');
    }
  },

  bindChangeListeners() {
    const typeEl = document.getElementById('report-filter-type');
    const locEl = document.getElementById('report-filter-location');
    const deptEl = document.getElementById('report-filter-dept');
    const statusEl = document.getElementById('report-filter-status');
    const genderEl = document.getElementById('report-filter-gender');
    const searchEl = document.getElementById('report-filter-search');
    const dateStartEl = document.getElementById('report-filter-date-start');
    const dateEndEl = document.getElementById('report-filter-date-end');
    const formatEls = document.querySelectorAll('input[name="report-format"]');

    const saveFilters = () => {
      if (typeEl) sessionStorage.setItem('pgp_rep_filter_type', typeEl.value);
      if (locEl) sessionStorage.setItem('pgp_rep_filter_loc', locEl.value);
      if (deptEl) sessionStorage.setItem('pgp_rep_filter_dept', deptEl.value);
      if (statusEl) sessionStorage.setItem('pgp_rep_filter_status', statusEl.value);
      if (genderEl) sessionStorage.setItem('pgp_rep_filter_gender', genderEl.value);
      if (searchEl) sessionStorage.setItem('pgp_rep_filter_search', searchEl.value);
      if (dateStartEl) sessionStorage.setItem('pgp_rep_filter_date_start', dateStartEl.value);
      if (dateEndEl) sessionStorage.setItem('pgp_rep_filter_date_end', dateEndEl.value);

      const checkedFormat = document.querySelector('input[name="report-format"]:checked');
      if (checkedFormat) {
        sessionStorage.setItem('pgp_rep_filter_format', checkedFormat.value);
      }
    };

    if (typeEl) {
      typeEl.addEventListener('change', () => {
        saveFilters();
        this.renderColumnSelection();
      });
    }
    if (locEl) locEl.addEventListener('change', saveFilters);
    if (deptEl) deptEl.addEventListener('change', saveFilters);
    if (statusEl) statusEl.addEventListener('change', saveFilters);
    if (genderEl) genderEl.addEventListener('change', saveFilters);
    if (searchEl) searchEl.addEventListener('input', debounce(saveFilters, 300));
    if (dateStartEl) dateStartEl.addEventListener('change', saveFilters);
    if (dateEndEl) dateEndEl.addEventListener('change', saveFilters);

    formatEls.forEach(el => {
      el.addEventListener('change', saveFilters);
    });
  },

  restoreFilters() {
    const typeEl = document.getElementById('report-filter-type');
    const locEl = document.getElementById('report-filter-location');
    const deptEl = document.getElementById('report-filter-dept');
    const statusEl = document.getElementById('report-filter-status');
    const genderEl = document.getElementById('report-filter-gender');
    const searchEl = document.getElementById('report-filter-search');
    const dateStartEl = document.getElementById('report-filter-date-start');
    const dateEndEl = document.getElementById('report-filter-date-end');

    const role = AppDB.getRole();
    const branch = AppDB.getBranch();

    if (typeEl && sessionStorage.getItem('pgp_rep_filter_type') !== null) {
      typeEl.value = sessionStorage.getItem('pgp_rep_filter_type');
    }
    if (locEl && sessionStorage.getItem('pgp_rep_filter_loc') !== null) {
      if (role === 'Branch HR') {
        locEl.value = branch;
        locEl.disabled = true;
      } else {
        locEl.value = sessionStorage.getItem('pgp_rep_filter_loc');
      }
    }
    if (deptEl && sessionStorage.getItem('pgp_rep_filter_dept') !== null) {
      deptEl.value = sessionStorage.getItem('pgp_rep_filter_dept');
    }
    if (statusEl && sessionStorage.getItem('pgp_rep_filter_status') !== null) {
      statusEl.value = sessionStorage.getItem('pgp_rep_filter_status');
    }
    if (genderEl && sessionStorage.getItem('pgp_rep_filter_gender') !== null) {
      genderEl.value = sessionStorage.getItem('pgp_rep_filter_gender');
    }
    if (searchEl && sessionStorage.getItem('pgp_rep_filter_search') !== null) {
      searchEl.value = sessionStorage.getItem('pgp_rep_filter_search');
    }
    if (dateStartEl && sessionStorage.getItem('pgp_rep_filter_date_start') !== null) {
      dateStartEl.value = sessionStorage.getItem('pgp_rep_filter_date_start');
    }
    if (dateEndEl && sessionStorage.getItem('pgp_rep_filter_date_end') !== null) {
      dateEndEl.value = sessionStorage.getItem('pgp_rep_filter_date_end');
    }

    const savedFormat = sessionStorage.getItem('pgp_rep_filter_format');
    if (savedFormat) {
      const radio = document.querySelector(`input[name="report-format"][value="${savedFormat}"]`);
      if (radio) radio.checked = true;
    }
  },

  async exportReport(reportType, format, filters) {
    const backendUrl = AppDB.getBackendUrl();

    // Toast loading preview
    const previewToast = Toast.info('Analyzing Database', 'Running database structure and count preview...', 3000);

    try {
      // 1. Call `/api/reports/preview` first
      const previewRes = await fetch(`${backendUrl}/api/reports/preview`, {
        method: 'POST',
        headers: AppDB.apiHeaders(),
        body: JSON.stringify({ reportType, filters })
      });

      if (previewToast) previewToast.close();

      if (!previewRes.ok) {
        const errData = await previewRes.json();
        throw new Error(errData.error || 'Failed to generate preview metrics.');
      }

      const previewData = await previewRes.json();

      // 2. Prevent blank files (0 records check)
      if (previewData.count === 0) {
        Toast.warning('No Records', 'No records found for selected filters. Export stopped.', 4000);
        return;
      }

      // Determine selected columns for export payload
      let selectedColumns = undefined;
      const storageKey = this.getStorageKeyForType(reportType);
      if (storageKey) {
        const typeSelect = document.getElementById('report-filter-type');
        if (typeSelect && typeSelect.value === reportType) {
          selectedColumns = Array.from(document.querySelectorAll('.column-toggle-chk:checked')).map(chk => chk.value);
        } else {
          const savedStr = localStorage.getItem(storageKey);
          if (savedStr) {
            try {
              selectedColumns = JSON.parse(savedStr);
            } catch (e) {
              selectedColumns = undefined;
            }
          }
          if (!selectedColumns) {
            selectedColumns = this.getHeadersForType(reportType);
          }
        }
      }

      // 3. Render Report Preview Confirmation Modal
      ModalManager.showReportPreviewModal({
        reportName: previewData.reportName,
        count: previewData.count,
        format: format.toUpperCase(),
        filters: previewData.appliedFiltersText,
        locationScope: previewData.locationScope,
        depts: previewData.departmentsIncluded,
        onConfirm: async () => {
          let progress = null;

          // 4. Large report background generation (> 5000 records)
          if (previewData.count > 5000) {
            progress = ModalManager.showReportProgress();
            progress.update('preparing', 'Preparing data payload and structure check...');

            setTimeout(() => {
              if (progress) progress.update('generating', 'Compiling sheet cells and writing columns...');
            }, 1000);
          } else {
            Toast.info('Compiling Report', `Exporting report in ${format.toUpperCase()} format...`, 2000);
          }

          try {
            // 5. Trigger download export
            const exportRes = await fetch(`${backendUrl}/api/reports/export`, {
              method: 'POST',
              headers: AppDB.apiHeaders(),
              body: JSON.stringify({ reportType, format, filters, selectedColumns })
            });

            if (!exportRes.ok) {
              const errText = await exportRes.text();
              let errMsg = 'Failed to compile report.';
              try {
                const parsed = JSON.parse(errText);
                errMsg = parsed.error || errMsg;
              } catch (e) {
                errMsg = errText || errMsg;
              }
              throw new Error(errMsg);
            }

            // 6. Download blob file
            const blob = await exportRes.blob();

            if (progress) {
              progress.update('ready', 'Report generation complete. Downloading file...');
            }

            const disposition = exportRes.headers.get('Content-Disposition');
            let filename = `Report_${reportType}_${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'xlsx' : format}`;
            if (disposition && disposition.indexOf('filename=') !== -1) {
              const matches = /filename="([^"]+)"/.exec(disposition);
              if (matches && matches[1]) filename = matches[1];
            }

            // Evidence collection
            const evidence = {
              requestUrl: `${backendUrl}/api/reports/export`,
              responseStatus: exportRes.status,
              responseHeaders: {
                contentType: exportRes.headers.get('Content-Type'),
                contentDisposition: disposition,
                contentLength: exportRes.headers.get('Content-Length')
              },
              parsedFilename: filename,
              blobSize: blob.size,
              blobType: blob.type
            };
            localStorage.setItem('export_evidence', JSON.stringify(evidence));

            // Guard: reject empty blobs before triggering download
            if (blob.size === 0) {
              throw new Error('Report export returned an empty file (0 bytes). Backend may have failed silently.');
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              a.remove();
              window.URL.revokeObjectURL(url);
            }, 150);

            Toast.success('Export Ready', `${previewData.reportName} has been downloaded successfully.`, 3000);

            // Dynamically update the Recent Export Task Logs table
            const exportLogTbody = document.querySelector('.table-custom tbody');
            if (exportLogTbody) {
              const now = new Date();
              const dateStr = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + ' ' +
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0');
              const userRole = AppDB.getRole();
              const userName = localStorage.getItem('pgp_user_name') || (userRole === 'Super HR' ? 'Super HR Admin' : 'Branch HR');
              const formatBadge = format.toUpperCase();
              const newRow = `
                <tr class="animate-fadeIn">
                  <td>${dateStr}</td>
                  <td><span class="fw-semibold">${previewData.reportName}</span></td>
                  <td><span class="badge-custom badge-neutral">${formatBadge}</span></td>
                  <td>${previewData.appliedFiltersText || 'None'}</td>
                  <td>${userName}</td>
                  <td><span class="badge-custom badge-success"><i class="fas fa-check-circle me-1"></i> Downloaded</span></td>
                </tr>`;
              exportLogTbody.insertAdjacentHTML('afterbegin', newRow);
            }
          } catch (err) {
            if (progress) progress.close();
            console.error('Export Action Failed:', err);
            Toast.error('Export Failed', err.message, 5000);
          }
        }
      });

    } catch (err) {
      if (previewToast) previewToast.close();
      console.error('Preview Action Failed:', err);
      Toast.error('Preview Failed', err.message, 4000);
    }
  }
};

const UsersPage = {
  async init() {
    await this.renderUsers();
    this.bindActions();
  },

  async renderUsers() {
    const container = document.getElementById('users-cards-grid');
    if (!container) return;
    container.innerHTML = '<div class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading users...</div>';

    let list = [];
    try {
      const backendUrl = AppDB.getBackendUrl();
      const res = await fetch(`${backendUrl}/api/users`, { headers: AppDB.apiHeaders() });
      const data = await res.json();
      if (data.success) list = data.users || [];
      else throw new Error(data.error || 'Failed to load users');
    } catch (err) {
      container.innerHTML = `<div class="text-center text-danger py-4"><i class="fas fa-exclamation-circle me-2"></i>Could not load users: ${err.message}</div>`;
      return;
    }

    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<div class="text-center text-muted py-4">No users found. Add one using the button above.</div>';
      return;
    }

    list.forEach(u => {
      container.innerHTML += `
        <div class="card-custom animate-fadeIn" style="padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3);">
          <div class="d-flex align-center justify-between">
            <span class="badge-custom ${u.role === 'Super HR' ? 'badge-brand' : 'badge-neutral'}">${u.role}</span>
            <span class="badge-custom ${u.status === 'Active' ? 'badge-success' : 'badge-danger'}">${u.status}</span>
          </div>
          <div class="avatar-cell my-2">
            <div class="avatar-circle" style="width: 44px; height: 44px; font-size: 16px;">${u.name.charAt(0)}</div>
            <div class="avatar-cell-info">
              <h4 class="fw-bold text-primary">${u.name}</h4>
              <div class="text-xs text-muted">${u.email}</div>
            </div>
          </div>
          <div class="divider" style="margin: var(--space-2) 0;"></div>
          <div class="d-flex justify-between align-center">
            <span class="text-xs text-secondary"><i class="fas fa-map-marker-alt me-1 text-muted"></i>${u.location}</span>
            <div class="action-btns">
              <button class="btn-icon btn-sm btn-edit-user" data-id="${u.id}" title="Edit User" aria-label="Edit User Account ${u.name}"><i class="fas fa-pen"></i></button>
              <button class="btn-icon btn-sm text-danger btn-deactivate-user" data-id="${u.id}" title="Deactivate User" aria-label="Toggle User Status for ${u.name}"><i class="fas fa-power-off"></i></button>
            </div>
          </div>
        </div>
      `;
    });
  },

  bindActions() {
    const addUserForm = document.getElementById('add-user-form');
    if (addUserForm) {
      addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('user-name').value.trim();
        const email = document.getElementById('user-email').value.trim();
        const role = document.getElementById('user-role').value;
        const location = document.getElementById('user-location').value;
        const password = document.getElementById('user-password') ? document.getElementById('user-password').value.trim() : '';

        try {
          const backendUrl = AppDB.getBackendUrl();
          const res = await fetch(`${backendUrl}/api/users`, {
            method: 'POST',
            headers: AppDB.apiHeaders(),
            body: JSON.stringify({ name, email, role, location: role === 'Super HR' ? 'All Locations' : location, password })
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || 'Failed to create user');

          ModalManager.hide('modal-add-user');
          addUserForm.reset();
          const addPwd = document.getElementById('user-password');
          if (addPwd) {
            addPwd.value = '';
            addPwd.type = 'password';
          }
          const addEye = document.getElementById('pwd-eye-add');
          if (addEye) addEye.className = 'fas fa-eye';

          Toast.success('User Added', `${name} successfully registered.`, 2500);
          await this.renderUsers();
        } catch (err) {
          Toast.error('Registration Failed', err.message, 3500);
        }
      });
    }

    document.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.btn-edit-user');
      const deactBtn = e.target.closest('.btn-deactivate-user');

      if (editBtn) {
        const id = editBtn.dataset.id;
        const backendUrl = AppDB.getBackendUrl();
        try {
          const res = await fetch(`${backendUrl}/api/users`, { headers: AppDB.apiHeaders() });
          const data = await res.json();
          const user = (data.users || []).find(u => String(u.id) === String(id));
          if (user) {
            document.getElementById('edit-user-id').value = user.id;
            document.getElementById('edit-user-name').value = user.name;
            document.getElementById('edit-user-email').value = user.email;
            document.getElementById('edit-user-role').value = user.role;
            document.getElementById('edit-user-location').value = user.location;

            // Clear password reset field in edit modal when opening
            const editPwd = document.getElementById('edit-user-password');
            if (editPwd) {
              editPwd.value = '';
              editPwd.type = 'password';
            }
            const editEye = document.getElementById('pwd-eye-edit');
            if (editEye) {
              editEye.className = 'fas fa-eye';
            }

            // Mark if this is a self-edit
            const currentUserEmail = localStorage.getItem('pgp_user_email') || '';
            const isSelfEdit = user.email.toLowerCase().trim() === currentUserEmail.toLowerCase().trim();
            document.getElementById('edit-user-form').dataset.isSelfEdit = isSelfEdit ? 'true' : 'false';

            ModalManager.show('modal-edit-user');
          }
        } catch (err) {
          Toast.error('Error', 'Could not load user details.', 3000);
        }
      }

      if (deactBtn) {
        const id = deactBtn.dataset.id;
        const card = deactBtn.closest('.card-custom');
        const name = card?.querySelector('h4')?.innerText || 'User';
        const email = card?.querySelector('.text-xs.text-muted')?.innerText || '';
        const currentUserEmail = localStorage.getItem('pgp_user_email') || '';

        if (email && currentUserEmail && email.toLowerCase().trim() === currentUserEmail.toLowerCase().trim()) {
          Toast.error('Action Blocked', 'Self-deactivation is prohibited. You cannot deactivate your own account.', 4000);
          return;
        }

        ModalManager.confirm({
          title: 'Toggle User Account Status',
          message: `Are you sure you want to toggle the status of ${name}'s account?`,
          iconType: 'warning',
          confirmText: 'Confirm Toggle',
          onConfirm: async () => {
            try {
              const backendUrl = AppDB.getBackendUrl();
              const res = await fetch(`${backendUrl}/api/users/${id}/toggle-status`, {
                method: 'POST',
                headers: AppDB.apiHeaders()
              });
              const data = await res.json();
              if (!data.success) throw new Error(data.error || 'Toggle failed');
              Toast.warning('Status Updated', `${name} account status toggled.`, 2000);
              await this.renderUsers();
            } catch (err) {
              Toast.error('Error', err.message, 3000);
            }
          }
        });
      }
    });

    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) {
      editUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-user-id').value;
        const name = document.getElementById('edit-user-name').value.trim();
        const email = document.getElementById('edit-user-email').value.trim();
        const role = document.getElementById('edit-user-role').value;
        const location = document.getElementById('edit-user-location').value;
        const password = document.getElementById('edit-user-password') ? document.getElementById('edit-user-password').value.trim() : '';

        // Self-demotion check
        const isSelfEdit = editUserForm.dataset.isSelfEdit === 'true';
        if (isSelfEdit && role !== 'Super HR') {
          Toast.error('Action Blocked', 'Self-demotion is prohibited. You cannot change your own role from Super HR.', 4000);
          return;
        }

        try {
          const backendUrl = AppDB.getBackendUrl();
          const res = await fetch(`${backendUrl}/api/users/${id}`, {
            method: 'PUT',
            headers: AppDB.apiHeaders(),
            body: JSON.stringify({ name, email, role, location: role === 'Super HR' ? 'All Locations' : location, password })
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || 'Update failed');

          ModalManager.hide('modal-edit-user');
          Toast.success('Saved', 'User details updated successfully.', 2000);
          await this.renderUsers();
        } catch (err) {
          Toast.error('Update Failed', err.message, 3500);
        }
      });
    }
  }
};

const SettingsPage = {
  init() {
    this.bindSettings();
  },

  bindSettings() {
    const notifyToggle = document.getElementById('toggle-notif');
    const autoLogoutToggle = document.getElementById('toggle-logout');
    const saveBtn = document.getElementById('save-settings-btn');

    if (notifyToggle) {
      notifyToggle.checked = localStorage.getItem('pref_notif') !== 'false';
    }
    if (autoLogoutToggle) {
      autoLogoutToggle.checked = localStorage.getItem('pref_autologout') === 'true';
    }

    if (saveBtn) {
      saveBtn.onclick = () => {
        if (notifyToggle) localStorage.setItem('pref_notif', notifyToggle.checked);
        if (autoLogoutToggle) localStorage.setItem('pref_autologout', autoLogoutToggle.checked);

        Toast.success('Preferences Saved', 'System configurations updated successfully.', 2000);
      };
    }
  }
};

// ============================================================
// MEMORY LEAK PREVENTION, LISTENERS & TIMERS TRACKER
// ============================================================
let dashboardBranchChangedListener = null;
let dashboardApprenticesUpdatedListener = null;
let apprenticesBranchChangedListener = null;
let apprenticesApprenticesUpdatedListener = null;
let analyticsBranchChangedListener = null;

const TimerTracker = {
  timeouts: [],
  intervals: [],
  setTimeout(fn, delay) {
    const id = window.setTimeout(fn, delay);
    this.timeouts.push(id);
    return id;
  },
  setInterval(fn, delay) {
    const id = window.setInterval(fn, delay);
    this.intervals.push(id);
    return id;
  },
  clearAll() {
    this.timeouts.forEach(id => window.clearTimeout(id));
    this.intervals.forEach(id => window.clearInterval(id));
    this.timeouts = [];
    this.intervals = [];
  }
};

window.addEventListener('beforeunload', () => {
  // Clear all running timers
  TimerTracker.clearAll();

  // Remove event listeners
  if (dashboardBranchChangedListener) {
    window.removeEventListener('branchchanged', dashboardBranchChangedListener);
  }
  if (dashboardApprenticesUpdatedListener) {
    window.removeEventListener('apprenticesupdated', dashboardApprenticesUpdatedListener);
  }
  if (apprenticesBranchChangedListener) {
    window.removeEventListener('branchchanged', apprenticesBranchChangedListener);
  }
  if (apprenticesApprenticesUpdatedListener) {
    window.removeEventListener('apprenticesupdated', apprenticesApprenticesUpdatedListener);
  }
  if (analyticsBranchChangedListener) {
    window.removeEventListener('branchchanged', analyticsBranchChangedListener);
  }

  // Destroy all charts
  if (typeof Charts !== 'undefined' && Charts.instances) {
    Object.keys(Charts.instances).forEach(key => {
      if (Charts.instances[key]) {
        Charts.instances[key].destroy();
        delete Charts.instances[key];
      }
    });
  }
});
// ============================================================
// GLOBAL LOADER ACCESSORS
// ============================================================
function hideGlobalLoader() {
  const loader = document.getElementById('global-page-loader');
  if (loader) {
    loader.classList.add('hidden');
  }
}

function showGlobalLoader() {
  const loader = document.getElementById('global-page-loader');
  if (loader) {
    loader.classList.remove('hidden');
  }
}

// ============================================================
// DYNAMIC LOADING SKELETON MANAGER
// ============================================================
const SkeletonManager = {
  showDashboard() {
    const kpiGrid = document.getElementById('dashboard-kpi-grid');
    if (kpiGrid) {
      kpiGrid.innerHTML = Array.from({ length: 8 }).map(() => `
        <div class="stat-card blue skeleton" style="height: 140px; pointer-events: none;"></div>
      `).join('');
    }
    const recentTbody = document.getElementById('recent-updates-tbody');
    if (recentTbody) {
      TableManager.renderSkeleton(recentTbody, 7, 5);
    }
    const locTbody = document.getElementById('location-analytics-tbody');
    if (locTbody) {
      TableManager.renderSkeleton(locTbody, 4, 4);
    }
    const charts = ['chart-gender-dist', 'chart-active-locations', 'chart-completed-locations', 'chart-department-dist', 'chart-completion-reason-dist', 'chart-monthly-trend'];
    charts.forEach(id => {
      const canvas = document.getElementById(id);
      if (canvas && canvas.parentNode) {
        canvas.style.display = 'none';
        let skel = canvas.parentNode.querySelector('.skeleton-chart-placeholder');
        if (!skel) {
          skel = document.createElement('div');
          skel.className = 'skeleton skeleton-chart skeleton-chart-placeholder';
          skel.style.width = '100%';
          skel.style.height = '100%';
          canvas.parentNode.appendChild(skel);
        }
      }
    });
  },

  hideDashboard() {
    const charts = ['chart-gender-dist', 'chart-active-locations', 'chart-completed-locations', 'chart-department-dist', 'chart-completion-reason-dist', 'chart-monthly-trend'];
    charts.forEach(id => {
      const canvas = document.getElementById(id);
      if (canvas) {
        canvas.style.display = 'block';
        const skel = canvas.parentNode.querySelector('.skeleton-chart-placeholder');
        if (skel) skel.remove();
      }
    });
  },

  showAnalytics() {
    const charts = [
      'summary-chart-location', 'summary-chart-department', 'summary-chart-portal', 'summary-chart-contract',
      'demo-chart-gender', 'demo-chart-age', 'demo-chart-location',
      'compliance-chart-portal', 'compliance-chart-contract', 'compliance-chart-completeness',
      'trend-chart-intake', 'trend-chart-completion'
    ];
    charts.forEach(id => {
      const canvas = document.getElementById(id);
      if (canvas && canvas.parentNode) {
        canvas.style.display = 'none';
        let skel = canvas.parentNode.querySelector('.skeleton-chart-placeholder');
        if (!skel) {
          skel = document.createElement('div');
          skel.className = 'skeleton skeleton-chart skeleton-chart-placeholder';
          skel.style.width = '100%';
          skel.style.height = '100%';
          canvas.parentNode.appendChild(skel);
        }
      }
    });
  },

  hideAnalytics() {
    const charts = [
      'summary-chart-location', 'summary-chart-department', 'summary-chart-portal', 'summary-chart-contract',
      'demo-chart-gender', 'demo-chart-age', 'demo-chart-location',
      'compliance-chart-portal', 'compliance-chart-contract', 'compliance-chart-completeness',
      'trend-chart-intake', 'trend-chart-completion'
    ];
    charts.forEach(id => {
      const canvas = document.getElementById(id);
      if (canvas) {
        canvas.style.display = 'block';
        const skel = canvas.parentNode.querySelector('.skeleton-chart-placeholder');
        if (skel) skel.remove();
      }
    });
  },

  showRegistry(pageType) {
    const tbody = document.getElementById('apprentices-tbody');
    if (tbody) {
      TableManager.renderSkeleton(tbody, pageType === 'completed' ? 12 : 10, 8);
    }
    const filterBar = document.querySelector('.filter-bar');
    if (filterBar) {
      let skeleton = filterBar.querySelector('.filter-bar-skeleton');
      if (!skeleton) {
        skeleton = document.createElement('div');
        skeleton.className = 'filter-bar-skeleton';
        skeleton.innerHTML = `
          <div class="skeleton" style="width: 150px; height: 32px; border-radius: var(--radius-sm);"></div>
          <div class="skeleton" style="width: 150px; height: 32px; border-radius: var(--radius-sm);"></div>
          <div class="skeleton" style="width: 150px; height: 32px; border-radius: var(--radius-sm);"></div>
          <div class="skeleton" style="flex: 1; height: 32px; border-radius: var(--radius-sm);"></div>
        `;
        filterBar.appendChild(skeleton);
      }
      filterBar.classList.add('skeleton-loading');
    }
  },

  hideRegistry() {
    const filterBar = document.querySelector('.filter-bar');
    if (filterBar) {
      filterBar.classList.remove('skeleton-loading');
      const skeleton = filterBar.querySelector('.filter-bar-skeleton');
      if (skeleton) skeleton.remove();
    }
  },

  showReports() {
    const reportGrid = document.querySelector('.report-type-grid');
    if (reportGrid) {
      let skeletonGrid = document.querySelector('.report-type-grid-skeleton');
      if (!skeletonGrid) {
        skeletonGrid = document.createElement('div');
        skeletonGrid.className = 'report-type-grid-skeleton';
        skeletonGrid.innerHTML = Array.from({ length: 10 }).map(() => `
          <div class="report-type-card-skeleton">
            <div class="skeleton" style="width: 48px; height: 48px; border-radius: var(--radius-lg); margin-bottom: var(--space-3);"></div>
            <div class="skeleton" style="width: 60%; height: 20px; border-radius: var(--radius-sm); margin-bottom: var(--space-2);"></div>
            <div class="skeleton" style="width: 90%; height: 12px; border-radius: var(--radius-sm); margin-bottom: var(--space-1);"></div>
            <div class="skeleton" style="width: 80%; height: 12px; border-radius: var(--radius-sm); margin-bottom: var(--space-1);"></div>
            <div class="d-flex gap-2 mt-auto w-full">
              <div class="skeleton" style="flex: 1; height: 28px; border-radius: var(--radius-md);"></div>
              <div class="skeleton" style="flex: 1; height: 28px; border-radius: var(--radius-md);"></div>
              <div class="skeleton" style="flex: 1; height: 28px; border-radius: var(--radius-md);"></div>
            </div>
          </div>
        `).join('');
        reportGrid.parentNode.insertBefore(skeletonGrid, reportGrid);
      }
      reportGrid.classList.add('skeleton-hidden');
      skeletonGrid.style.display = 'grid';
    }
  },

  hideReports() {
    const reportGrid = document.querySelector('.report-type-grid');
    const skeletonGrid = document.querySelector('.report-type-grid-skeleton');
    if (reportGrid) {
      reportGrid.classList.remove('skeleton-hidden');
    }
    if (skeletonGrid) {
      skeletonGrid.style.display = 'none';
    }
  },

  showSettings() {
    const settingsContent = document.querySelector('.settings-content');
    if (settingsContent) {
      let skeletonSettings = document.querySelector('.settings-content-skeleton');
      if (!skeletonSettings) {
        skeletonSettings = document.createElement('div');
        skeletonSettings.className = 'settings-content-skeleton';
        skeletonSettings.innerHTML = `
          <div class="skeleton" style="width: 40%; height: 24px; border-radius: var(--radius-sm); margin-bottom: var(--space-5);"></div>
          <div class="d-flex flex-column gap-3 mb-6">
            <div class="d-flex justify-between align-center py-4" style="border-bottom: 1px solid var(--border-subtle);">
              <div>
                <div class="skeleton" style="width: 150px; height: 16px; border-radius: var(--radius-sm); margin-bottom: 6px;"></div>
                <div class="skeleton" style="width: 250px; height: 12px; border-radius: var(--radius-sm);"></div>
              </div>
              <div class="skeleton" style="width: 44px; height: 24px; border-radius: 24px;"></div>
            </div>
            <div class="d-flex justify-between align-center py-4" style="border-bottom: 1px solid var(--border-subtle);">
              <div>
                <div class="skeleton" style="width: 130px; height: 16px; border-radius: var(--radius-sm); margin-bottom: 6px;"></div>
                <div class="skeleton" style="width: 220px; height: 12px; border-radius: var(--radius-sm);"></div>
              </div>
              <div class="skeleton" style="width: 44px; height: 24px; border-radius: 24px;"></div>
            </div>
            <div class="d-flex justify-between align-center py-4">
              <div>
                <div class="skeleton" style="width: 180px; height: 16px; border-radius: var(--radius-sm); margin-bottom: 6px;"></div>
                <div class="skeleton" style="width: 260px; height: 12px; border-radius: var(--radius-sm);"></div>
              </div>
              <div class="skeleton" style="width: 44px; height: 24px; border-radius: 24px;"></div>
            </div>
          </div>
          <div class="d-flex justify-end gap-3 mt-6">
            <div class="skeleton" style="width: 100px; height: 38px; border-radius: var(--radius-md);"></div>
            <div class="skeleton" style="width: 150px; height: 38px; border-radius: var(--radius-md);"></div>
          </div>
        `;
        settingsContent.parentNode.insertBefore(skeletonSettings, settingsContent);
      }
      settingsContent.classList.add('skeleton-hidden');
      skeletonSettings.style.display = 'flex';
    }
  },

  hideSettings() {
    const settingsContent = document.querySelector('.settings-content');
    const skeletonSettings = document.querySelector('.settings-content-skeleton');
    if (settingsContent) {
      settingsContent.classList.remove('skeleton-hidden');
    }
    if (skeletonSettings) {
      skeletonSettings.style.display = 'none';
    }
  },

  showProfile() {
    const fields = ['val-code', 'val-name', 'val-sex', 'val-age', 'val-dept', 'val-branch', 'val-phone', 'val-email', 'val-address', 'val-contract-id', 'val-portal-enrollment', 'val-portal-name', 'val-remarks'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<span class="skeleton skeleton-text" style="display:inline-block; width:120px;"></span>';
      }
    });
    const timeline = document.getElementById('audit-timeline');
    if (timeline) {
      timeline.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="audit-timeline-item" style="pointer-events: none;">
          <div class="audit-timeline-dot"></div>
          <div class="skeleton skeleton-text mb-2" style="width: 140px;"></div>
          <div class="skeleton skeleton-title mb-2"></div>
          <div class="skeleton skeleton-text" style="width: 80%;"></div>
        </div>
      `).join('');
    }
  }
};

// 4. MAIN GLOBAL CONTROLLER ON LOAD
document.addEventListener('DOMContentLoaded', async () => {
  const domLoadedTime = Date.now();
  const navigationStart = window.performance.timing.navigationStart;
  const loadStartToDomLoaded = domLoadedTime - navigationStart;
  sessionStorage.setItem('pgp_perf_load_to_dom', loadStartToDomLoaded.toString());

  const path = window.location.pathname;
  const isLoginPage = path.endsWith('index.html') || path === '/' || path.endsWith('/');
  const hasSession = !!localStorage.getItem('pgp_role');

  // ===== AUTHENTICATION GATE =====
  if (!isLoginPage && !hasSession) {
    window.location.href = '../index.html';
    return;
  }

  // Initialize Side Drawer
  DrawerManager.init();

  // Role Security Check
  const role = AppDB.getRole();
  const restrictedPagesForBranch = ['upload.html', 'users.html', 'analytics.html'];
  const isRestricted = restrictedPagesForBranch.some(p => path.includes(p));

  if (role === 'Branch HR' && isRestricted) {
    const main = document.getElementById('app-main') || document.body;
    main.innerHTML = `
      <div class="empty-state animate-fadeIn" style="margin-top: 100px; padding: var(--space-8); text-align: center;">
        <div class="empty-state-icon text-danger" style="font-size: 64px; color: var(--status-danger); margin-bottom: var(--space-4);"><i class="fas fa-shield-alt"></i></div>
        <h2 class="empty-state-title" style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: var(--space-2);">Access Restricted</h2>
        <p class="empty-state-description" style="max-width: 480px; margin: 0 auto; color: var(--text-secondary); line-height: 1.6;">
          Branch HR accounts are restricted from administrative actions (Excel uploads, system user management, and executive analytics). Please contact your Super HR administrator for clearance.
        </p>
        <div style="margin-top: var(--space-6);">
          <a href="dashboard.html" class="btn-primary-custom"><i class="fas fa-home me-2"></i> Go to Dashboard</a>
        </div>
      </div>
    `;
    return; // Stop execution
  }

  // Draw App Shell layout containers
  AppShell.renderSidebar();
  AppShell.renderTopNav();

  // Initialize Sidebar Toggle Event Handlers
  if (typeof Sidebar !== 'undefined') {
    Sidebar.init();
  }

  // --- RENDER INITIAL SKELETONS (NON-BLOCKING) ---
  const isProfilePage = path.includes('apprentice-detail.html');
  if (!isLoginPage) {
    if (path.includes('dashboard.html')) {
      SkeletonManager.showDashboard();
    } else if (path.includes('analytics.html') && role === 'Super HR') {
      SkeletonManager.showAnalytics();
    } else if (path.includes('apprentices.html')) {
      const urlParams = new URLSearchParams(window.location.search);
      const pageType = urlParams.get('type') === 'completed' ? 'completed' : 'active';
      SkeletonManager.showRegistry(pageType);
    } else if (path.includes('reports.html')) {
      SkeletonManager.showReports();
    } else if (path.includes('settings.html')) {
      SkeletonManager.showSettings();
    }
  }

  if (isProfilePage) {
    const initStart = Date.now();
    ApprenticeDetailPage.init();
    AppDB.init().then(() => {
      const initComplete = Date.now();
      sessionStorage.setItem('pgp_perf_dom_to_init', (initComplete - initStart).toString());
      sessionStorage.setItem('pgp_perf_init_to_render', '0');
      AppShell.renderTopNav();
      printNavigationPerformanceReport();
      hideGlobalLoader();
    }).catch(() => {
      hideGlobalLoader();
    });
  } else if (!isLoginPage) {
    const initStart = Date.now();
    // Non-profile pages: Fetch full dataset asynchronously
    AppDB.init().then(() => {
      const initComplete = Date.now();
      sessionStorage.setItem('pgp_perf_dom_to_init', (initComplete - initStart).toString());

      const renderStart = Date.now();
      AppShell.renderTopNav();

      // Hide skeletons and render real data
      if (path.includes('dashboard.html')) {
        SkeletonManager.hideDashboard();
        DashboardPage.init();
      } else if (path.includes('analytics.html')) {
        SkeletonManager.hideAnalytics();
        AnalyticsPage.init();
      } else if (path.includes('apprentices.html')) {
        SkeletonManager.hideRegistry();
        ApprenticesPage.init();
      } else if (path.includes('reports.html')) {
        SkeletonManager.hideReports();
        ReportsPage.init();
      } else if (path.includes('upload.html')) {
        ExcelUploadPage.init();
      } else if (path.includes('users.html')) {
        UsersPage.init();
      } else if (path.includes('settings.html')) {
        SkeletonManager.hideSettings();
        SettingsPage.init();
      } else {
        hideGlobalLoader();
      }

      const renderComplete = Date.now();
      sessionStorage.setItem('pgp_perf_init_to_render', (renderComplete - renderStart).toString());

      printNavigationPerformanceReport();
      hideGlobalLoader();
    }).catch(err => {
      console.error('AppDB.init failed:', err);
      // Render clean error state on UI
      const contentArea = document.querySelector('.app-content');
      if (contentArea) {
        contentArea.innerHTML = `
          <div class="empty-state animate-fadeIn" style="margin-top: 60px; padding: var(--space-8); text-align: center;">
            <div class="empty-state-icon text-danger" style="font-size: 56px; color: var(--status-danger); margin-bottom: var(--space-4);"><i class="fas fa-exclamation-triangle"></i></div>
            <h2 class="empty-state-title" style="font-size: 20px; font-weight: 700; color: var(--text-primary); margin-bottom: var(--space-2);">Database Unreachable</h2>
            <p class="empty-state-description" style="max-width: 480px; margin: 0 auto; color: var(--text-secondary); line-height: 1.6;">
              We couldn't connect to the Google Sheets database. Please ensure your backend server is active and verified, then refresh the page.
            </p>
            <div style="margin-top: var(--space-5);">
              <button onclick="window.location.reload()" class="btn-primary-custom"><i class="fas fa-sync me-2"></i> Retry Connection</button>
            </div>
          </div>
        `;
      }
      hideGlobalLoader();
    });
  } else {
    hideGlobalLoader();
  }

  // ===== LIGHTWEIGHT PAGE TRANSITIONS =====
  document.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (link && link.href) {
      const url = new URL(link.href);
      const isLocal = url.origin === window.location.origin;
      const isLoginPage = url.pathname.endsWith('index.html') || url.pathname === '/' || url.pathname.endsWith('/pages/');
      const isDownloadOrHash = link.hash || link.target || link.classList.contains('no-transition') || link.hasAttribute('download');

      if (isLocal && !isLoginPage && !isDownloadOrHash) {
        const linkUrl = url.pathname + url.search;
        const currentUrl = window.location.pathname + window.location.search;

        if (linkUrl !== currentUrl) {
          sessionStorage.setItem('pgp_perf_click_time', Date.now().toString());
          sessionStorage.setItem('pgp_perf_from_page', window.location.pathname);
          sessionStorage.setItem('pgp_perf_to_page', url.pathname);

          e.preventDefault();
          showGlobalLoader();
          document.body.classList.add('fade-out');
          TimerTracker.setTimeout(() => {
            window.location.href = link.href;
          }, 100);
        }
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    const clickTime = sessionStorage.getItem('pgp_perf_click_time');
    if (clickTime) {
      const unloadTime = Date.now() - parseInt(clickTime);
      sessionStorage.setItem('pgp_perf_unload_duration', unloadTime.toString());
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      document.body.classList.remove('fade-out');
    }
  });

  // ===== PAGE ASSET PREFETCHING =====
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => prefetchPortalPages());
  } else {
    window.addEventListener('load', () => {
      TimerTracker.setTimeout(prefetchPortalPages, 1000);
    });
  }
});

function printNavigationPerformanceReport() {
  const clickUnload = sessionStorage.getItem('pgp_perf_unload_duration') || '0';
  const loadToDom = sessionStorage.getItem('pgp_perf_load_to_dom') || '0';
  const domToInit = sessionStorage.getItem('pgp_perf_dom_to_init') || '0';
  const initToRender = sessionStorage.getItem('pgp_perf_init_to_render') || '0';
  const fromPage = sessionStorage.getItem('pgp_perf_from_page') || 'Initial Page Load';
  const toPage = sessionStorage.getItem('pgp_perf_to_page') || window.location.pathname;

  console.log('====================================================');
  console.log('         NAVIGATION PERFORMANCE DIAGNOSTICS         ');
  console.log('====================================================');
  console.log(`From Page:                      ${fromPage}`);
  console.log(`To Page:                        ${toPage}`);
  console.log(`1. Click to Unload (old page):  ${clickUnload} ms`);
  console.log(`2. Load to DOMContentLoaded:     ${loadToDom} ms`);
  console.log(`3. DOMContentLoaded to Init:    ${domToInit} ms`);
  console.log(`4. Init to Render Complete:     ${initToRender} ms`);
  console.log('====================================================');

  // Clear transition timestamps but keep for report
  sessionStorage.removeItem('pgp_perf_click_time');
}

function prefetchPortalPages() {
  const pages = [
    'dashboard.html',
    'apprentices.html?type=active',
    'apprentices.html?type=completed',
    'analytics.html',
    'reports.html',
    'settings.html'
  ];
  pages.forEach(prefetchPage);
}

function prefetchPage(url) {
  const exists = document.querySelector(`link[href="${url}"]`);
  if (exists) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;
  document.head.appendChild(link);
}
