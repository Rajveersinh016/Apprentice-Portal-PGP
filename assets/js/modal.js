/* ============================================================
   PGP GLASS — Centralized Modal Manager
   ============================================================ */

const ModalManager = {
  show(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('animate-fadeIn');
      document.body.style.overflow = 'hidden'; // Lock background scroll
    }
  },

  hide(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('animate-fadeIn');
      
      // Check if any other modal is open before unlocking scroll
      const openModals = Array.from(document.querySelectorAll('.modal-backdrop-custom'))
        .filter(m => m.style.display === 'flex');
      if (openModals.length === 0) {
        document.body.style.overflow = '';
      }
    }
  },

  // Dynamic confirmation modal prompt
  confirm({ title, message, iconType = 'warning', confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel }) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop-custom';
    modal.style.zIndex = '1000'; // Override default z-index to be on top of other modals

    // Set matching colors for the warning/danger types
    let typeClass = 'warning';
    let iconClass = 'fa-exclamation-triangle';
    if (iconType === 'danger') {
      typeClass = 'danger';
      iconClass = 'fa-trash-alt';
    } else if (iconType === 'success') {
      typeClass = 'success';
      iconClass = 'fa-check-circle';
    } else if (iconType === 'info') {
      typeClass = 'info';
      iconClass = 'fa-info-circle';
    }

    modal.innerHTML = `
      <div class="modal-custom modal-sm">
        <div class="modal-body-custom" style="text-align: center; padding: var(--space-6);">
          <div class="confirm-modal-icon ${typeClass}">
            <i class="fas ${iconClass}"></i>
          </div>
          <h3 class="mb-2 text-xl fw-bold">${title}</h3>
          <p class="text-secondary text-sm" style="line-height: var(--lh-relaxed);">${message}</p>
        </div>
        <div class="modal-footer-custom" style="justify-content: center; gap: var(--space-3); padding-bottom: var(--space-6);">
          <button class="btn-secondary-custom" id="confirm-no" style="min-width: 100px;">${cancelText}</button>
          <button class="${typeClass === 'danger' ? 'btn-danger-custom' : 'btn-primary-custom'}" id="confirm-yes" style="min-width: 100px;">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const cleanUp = () => {
      modal.remove();
      const openModals = Array.from(document.querySelectorAll('.modal-backdrop-custom'))
        .filter(m => m.style.display === 'flex');
      if (openModals.length === 0) {
        document.body.style.overflow = '';
      }
    };

    document.getElementById('confirm-no').onclick = () => {
      cleanUp();
      if (onCancel) onCancel();
    };

    document.getElementById('confirm-yes').onclick = () => {
      cleanUp();
      if (onConfirm) onConfirm();
    };
  },

  showCompletionModal({ title = 'Complete Apprenticeship', onConfirm, onCancel }) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop-custom';
    modal.style.zIndex = '1000'; // Override default z-index to be on top of other modals
    modal.style.display = 'flex'; // Make it visible immediately

    modal.innerHTML = `
      <div class="modal-custom modal-md" style="max-width: 500px; width: 100%;">
        <div class="modal-header-custom" style="padding: var(--space-5) var(--space-6); border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <h3 class="text-lg fw-bold" style="margin: 0; display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
            <i class="fas fa-graduation-cap text-success"></i> ${title}
          </h3>
          <button id="completion-close-btn" style="background: none; border: none; font-size: 18px; color: var(--text-muted); cursor: pointer;"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body-custom" style="padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4);">
          <div class="form-group-profile">
            <label class="form-label" style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 6px;">Completion Reason <span style="color: var(--status-danger);">*</span></label>
            <select class="form-control-custom" id="completion-reason" style="width: 100%; height: 38px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary); padding: 0 var(--space-3); font-size: 13.5px; font-weight: 500;">
              <option value="" disabled selected>Select Completion Reason</option>
              <option value="Successfully Completed Apprenticeship">Successfully Completed Apprenticeship</option>
              <option value="Selected as Permanent Employee">Selected as Permanent Employee</option>
              <option value="Selected as Fixed Term Employee (FTC)">Selected as Fixed Term Employee (FTC)</option>
              <option value="Selected as Trainee">Selected as Trainee</option>
              <option value="Contract Completed">Contract Completed</option>
              <option value="Voluntary Resignation">Voluntary Resignation</option>
              <option value="Absconded">Absconded</option>
              <option value="Performance Issues">Performance Issues</option>
              <option value="Attendance Issues">Attendance Issues</option>
              <option value="Disciplinary Action">Disciplinary Action</option>
              <option value="Medical Reasons">Medical Reasons</option>
              <option value="Higher Education">Higher Education</option>
              <option value="Other">Other</option>
            </select>
            <span id="completion-reason-error" style="color: #dc2626; font-size: 12px; display: none; margin-top: 4px;">Completion reason is required.</span>
          </div>
          
          <div class="form-group-profile" id="other-reason-group" style="margin-top: 16px; display: none;">
            <label class="form-label" style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 6px;">Other Reason Description <span style="color: var(--status-danger);">*</span></label>
            <input type="text" class="form-control-custom" id="other-reason-description" placeholder="Enter other completion reason description..." style="width: 100%; height: 38px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary); padding: 0 var(--space-3); font-size: 13.5px; font-weight: 500;">
            <span id="other-reason-error" style="color: #dc2626; font-size: 12px; display: none; margin-top: 4px;">Other reason description is required.</span>
          </div>

          <div class="form-group-profile" style="margin-top: 16px;">
            <label class="form-label" style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 6px;">Completion Remarks <span style="color: var(--status-danger);">*</span></label>
            <textarea class="form-control-custom" id="completion-remarks" rows="4" placeholder="Enter mandatory completion remarks (minimum 10 characters)..." style="width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary); padding: var(--space-3); font-size: 13.5px; font-weight: 500; height: auto; min-height: 100px; resize: vertical;"></textarea>
            <span id="completion-error" style="color: #dc2626; font-size: 12px; display: none; margin-top: 4px;">Remarks are required.</span>
          </div>
        </div>
        <div class="modal-footer-custom" style="justify-content: flex-end; gap: var(--space-3); padding: var(--space-4) var(--space-6); border-top: 1px solid var(--border-subtle); display: flex;">
          <button class="btn-secondary-custom" id="completion-no" style="min-width: 100px;">Cancel</button>
          <button class="btn-success-custom" id="completion-yes" style="min-width: 120px; background: #059669; color: white; border: none; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; height: 38px;">Sign Off Completion</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const cleanUp = () => {
      modal.remove();
      const openModals = Array.from(document.querySelectorAll('.modal-backdrop-custom'))
        .filter(m => m.style.display === 'flex');
      if (openModals.length === 0) {
        document.body.style.overflow = '';
      }
    };

    const reasonSelect = document.getElementById('completion-reason');
    const otherGroup = document.getElementById('other-reason-group');

    reasonSelect.addEventListener('change', () => {
      if (reasonSelect.value === 'Other') {
        otherGroup.style.display = 'block';
      } else {
        otherGroup.style.display = 'none';
      }
    });

    document.getElementById('completion-no').onclick = () => {
      cleanUp();
      if (onCancel) onCancel();
    };

    document.getElementById('completion-close-btn').onclick = () => {
      cleanUp();
      if (onCancel) onCancel();
    };

    document.getElementById('completion-yes').onclick = () => {
      const reason = reasonSelect.value;
      const otherReason = document.getElementById('other-reason-description').value.trim();
      const remarks = document.getElementById('completion-remarks').value.trim();
      
      const reasonErrorSpan = document.getElementById('completion-reason-error');
      const otherErrorSpan = document.getElementById('other-reason-error');
      const remarksErrorSpan = document.getElementById('completion-error');
      
      let hasError = false;

      if (!reason) {
        reasonErrorSpan.style.display = 'block';
        hasError = true;
      } else {
        reasonErrorSpan.style.display = 'none';
      }

      if (reason === 'Other' && !otherReason) {
        otherErrorSpan.style.display = 'block';
        hasError = true;
      } else {
        otherErrorSpan.style.display = 'none';
      }

      // Validate remarks quality
      const weakRemarks = ['ok', 'done', 'completed', 'yes', 'test', 'na', 'n/a'];
      const normalizedRemarks = remarks.toLowerCase();

      if (!remarks || remarks.length < 10 || weakRemarks.includes(normalizedRemarks)) {
        remarksErrorSpan.innerText = "Please provide meaningful completion remarks (minimum 10 characters).";
        remarksErrorSpan.style.display = 'block';
        hasError = true;
      } else {
        remarksErrorSpan.style.display = 'none';
      }

      if (hasError) return;

      cleanUp();
      if (onConfirm) onConfirm({ reason, otherReason, remarks });
    };
  },

  showReportPreviewModal({ reportName, count, format, filters, locationScope, depts, onConfirm, onCancel }) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop-custom';
    modal.style.zIndex = '1000';
    modal.style.display = 'flex';

    modal.innerHTML = `
      <div class="modal-custom modal-md" style="max-width: 500px; width: 100%;">
        <div class="modal-header-custom" style="padding: var(--space-5) var(--space-6); border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <h3 class="text-lg fw-bold" style="margin: 0; display: flex; align-items: center; gap: 8px; color: var(--text-primary);">
            <i class="fas fa-file-invoice text-primary"></i> Report Export Preview
          </h3>
          <button id="preview-close-btn" style="background: none; border: none; font-size: 18px; color: var(--text-muted); cursor: pointer;"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body-custom" style="padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4);">
          <div style="background: var(--bg-neutral-light); padding: var(--space-4); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <tr style="border-bottom: 1px solid var(--border-subtle);"><td style="padding: 8px 0; font-weight: 600; color: var(--text-secondary);">Report Template</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: var(--text-primary);">${reportName}</td></tr>
              <tr style="border-bottom: 1px solid var(--border-subtle);"><td style="padding: 8px 0; font-weight: 600; color: var(--text-secondary);">Expected Records</td><td style="padding: 8px 0; text-align: right; font-weight: 700; color: var(--brand-primary);">${count}</td></tr>
              <tr style="border-bottom: 1px solid var(--border-subtle);"><td style="padding: 8px 0; font-weight: 600; color: var(--text-secondary);">Format</td><td style="padding: 8px 0; text-align: right; font-weight: 700; text-transform: uppercase; color: var(--text-primary);">${format}</td></tr>
              <tr style="border-bottom: 1px solid var(--border-subtle);"><td style="padding: 8px 0; font-weight: 600; color: var(--text-secondary);">Location Scope</td><td style="padding: 8px 0; text-align: right; font-weight: 500; color: var(--text-primary);">${locationScope}</td></tr>
              <tr style="border-bottom: 1px solid var(--border-subtle);"><td style="padding: 8px 0; font-weight: 600; color: var(--text-secondary);">Department</td><td style="padding: 8px 0; text-align: right; font-weight: 500; color: var(--text-primary);">${depts}</td></tr>
              <tr><td style="padding: 8px 0; font-weight: 600; color: var(--text-secondary); vertical-align: top;">Active Filters</td><td style="padding: 8px 0; text-align: right; font-weight: 500; color: var(--text-muted); font-style: italic; max-width: 250px; word-break: break-all;">${filters}</td></tr>
            </table>
          </div>
          <div style="font-size: 11.5px; color: var(--text-muted); display: flex; align-items: start; gap: 6px; line-height: 1.5;">
            <i class="fas fa-info-circle" style="color: var(--brand-primary); margin-top: 2px;"></i>
            <span>This preview displays count and structure validation checks calculated dynamically. Confirming will export all available core, custom, and dynamic fields.</span>
          </div>
        </div>
        <div class="modal-footer-custom" style="justify-content: flex-end; gap: var(--space-3); padding: var(--space-4) var(--space-6); border-top: 1px solid var(--border-subtle); display: flex;">
          <button class="btn-secondary-custom" id="preview-no" style="min-width: 100px;">Cancel</button>
          <button class="btn-primary-custom" id="preview-yes" style="min-width: 140px; display: flex; align-items: center; justify-content: center; gap: 6px; height: 38px;"><i class="fas fa-file-download"></i> Confirm Export</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const cleanUp = () => {
      modal.remove();
      const openModals = Array.from(document.querySelectorAll('.modal-backdrop-custom'))
        .filter(m => m.style.display === 'flex');
      if (openModals.length === 0) {
        document.body.style.overflow = '';
      }
    };

    document.getElementById('preview-no').onclick = () => {
      cleanUp();
      if (onCancel) onCancel();
    };

    document.getElementById('preview-close-btn').onclick = () => {
      cleanUp();
      if (onCancel) onCancel();
    };

    document.getElementById('preview-yes').onclick = () => {
      cleanUp();
      if (onConfirm) onConfirm();
    };
  },

  showReportProgress() {
    const loaderId = 'report-progress-loader';
    let container = document.getElementById(loaderId);
    if (!container) {
      container = document.createElement('div');
      container.id = loaderId;
      container.style.position = 'fixed';
      container.style.bottom = '24px';
      container.style.right = '24px';
      container.style.background = 'var(--surface-card)';
      container.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)';
      container.style.border = '1px solid var(--border-subtle)';
      container.style.borderRadius = 'var(--radius-lg)';
      container.style.padding = '16px 20px';
      container.style.zIndex = '9999';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.gap = '14px';
      container.style.minWidth = '300px';
      container.className = 'animate-fadeIn';
      document.body.appendChild(container);
    }
    
    const updateState = (state, text) => {
      let iconHtml = '<i class="fas fa-spinner fa-spin text-primary" style="font-size: 18px;"></i>';
      if (state === 'ready') {
        iconHtml = '<i class="fas fa-check-circle text-success" style="font-size: 20px;"></i>';
      }
      
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--bg-neutral-light);">
          ${iconHtml}
        </div>
        <div style="flex: 1;">
          <div style="font-size: 13.5px; font-weight: 600; color: var(--text-primary);">Exporting Apprentice Data</div>
          <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 2px;">${text}</div>
        </div>
      `;
      
      if (state === 'ready') {
        setTimeout(() => {
          container.classList.remove('animate-fadeIn');
          container.classList.add('animate-fadeOut');
          setTimeout(() => {
            container.remove();
          }, 400);
        }, 3000);
      }
    };
    
    return {
      update: updateState,
      close: () => {
        container.remove();
      }
    };
  }
};

// Add general click-outside-to-close listener on modal backdrops
document.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('modal-backdrop-custom')) {
    ModalManager.hide(e.target.id);
  }
});
