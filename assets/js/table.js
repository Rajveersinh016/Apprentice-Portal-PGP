/* ============================================================
   PGP GLASS — Data Table Manager & Grid Controls
   ============================================================ */

const TableManager = {
  // Enables column resizing on a table
  enableResizing(tableElement) {
    if (!tableElement) return;
    const cols = tableElement.querySelectorAll('thead th');
    
    cols.forEach(col => {
      // Avoid adding duplicate handles
      if (col.querySelector('.resize-handle')) return;
      
      const resizer = document.createElement('div');
      resizer.className = 'resize-handle';
      resizer.style.position = 'absolute';
      resizer.style.top = '0';
      resizer.style.right = '0';
      resizer.style.bottom = '0';
      resizer.style.width = '4px';
      resizer.style.cursor = 'col-resize';
      resizer.style.userSelect = 'none';
      col.appendChild(resizer);

      let startX, startWidth;

      const onPointerMove = (e) => {
        const width = startWidth + (e.clientX - startX);
        col.style.width = `${width}px`;
        col.style.minWidth = `${width}px`;
      };

      const onPointerUp = () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        resizer.classList.remove('resizing');
      };

      resizer.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startWidth = col.offsetWidth;
        resizer.classList.add('resizing');
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        e.preventDefault();
      });
    });
  },

  // Generates loading skeleton rows inside tbody
  renderSkeleton(tbodyElement, columnCount, rowCount = 5) {
    if (!tbodyElement) return;
    let html = '';
    for (let r = 0; r < rowCount; r++) {
      html += '<tr>';
      for (let c = 0; c < columnCount; c++) {
        if (c === 0) {
          // Avatar skeleton for the first column
          html += `
            <td>
              <div class="avatar-cell">
                <div class="skeleton skeleton-avatar"></div>
                <div class="avatar-cell-info" style="width: 100px;">
                  <div class="skeleton skeleton-text mb-1"></div>
                  <div class="skeleton skeleton-text" style="width: 60%"></div>
                </div>
              </div>
            </td>
          `;
        } else {
          html += `<td><div class="skeleton skeleton-text" style="width: ${40 + Math.random() * 50}%"></div></td>`;
        }
      }
      html += '</tr>';
    }
    tbodyElement.innerHTML = html;
  },

  // Renders a beautiful empty state
  renderEmptyState(tbodyElement, columnCount, title = "No records found", description = "Try adjusting your search query or active filters.") {
    if (!tbodyElement) return;
    tbodyElement.innerHTML = `
      <tr>
        <td colspan="${columnCount}" style="padding: 0;">
          <div class="empty-state animate-fadeIn">
            <div class="empty-state-icon">
              <i class="fas fa-folder-open"></i>
            </div>
            <div class="empty-state-title">${title}</div>
            <div class="empty-state-description">${description}</div>
          </div>
        </td>
      </tr>
    `;
  },

  // Helper to convert table rows into a CSV string and trigger a download
  exportToCSV(data, filename = 'export.csv') {
    if (!data || !data.length) return;
    
    const headers = Object.keys(data[0]);
    const csvRows = [];
    
    // Header row
    csvRows.push(headers.map(header => `"${header.replace(/"/g, '""')}"`).join(','));
    
    // Data rows
    for (const row of data) {
      const values = headers.map(header => {
        const val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
        return `"${val.replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    }
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
};
