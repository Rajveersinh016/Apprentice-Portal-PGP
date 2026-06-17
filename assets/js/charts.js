/* ============================================================
   PGP GLASS — Charting Engine (Chart.js Integration)
   ============================================================ */

// Harmonized Enterprise Palette
const ChartPalette = {
  primary: '#0078d4',
  violet: '#7c3aed',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#3b82f6',
  gray: '#6b7280',
  lightGray: '#e5e7eb',
  darkGray: '#2d3448',
  lightText: '#e6edf3',
  darkText: '#111827'
};

const Charts = {
  instances: {},

  // Detects dark mode from document element
  isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  },

  // Get color configurations depending on active theme
  getThemeColors() {
    const isDark = this.isDarkMode();
    return {
      text: isDark ? ChartPalette.lightText : ChartPalette.darkText,
      grid: isDark ? ChartPalette.darkGray : ChartPalette.lightGray,
      tooltipBg: isDark ? '#1c2333' : '#ffffff',
      tooltipBorder: isDark ? '#2d3448' : '#e5e7eb',
      tooltipText: isDark ? '#e6edf3' : '#111827'
    };
  },

  // Safe registration of chart instances to prevent conflicts
  register(id, chart) {
    if (this.instances[id]) {
      this.instances[id].destroy();
    }
    this.instances[id] = chart;
  },

  // 1. General Bar Chart
  createBarChart(canvasId, labels, dataValues, labelText = 'Count', color = ChartPalette.primary) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.instances[canvasId]) {
      this.instances[canvasId].destroy();
      delete this.instances[canvasId];
    }

    const colors = this.getThemeColors();
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: labelText,
          data: dataValues,
          backgroundColor: color,
          hoverBackgroundColor: color === ChartPalette.primary ? '#005a9e' : '#047857',
          borderRadius: 6,
          maxBarThickness: 32
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            titleColor: colors.tooltipText,
            bodyColor: colors.tooltipText,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: colors.text, font: { family: 'Inter', size: 11 } }
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.text, font: { family: 'Inter', size: 11 } }
          }
        }
      }
    });

    this.register(canvasId, chart);
  },

  // 2. General Line Chart
  createLineChart(canvasId, labels, dataValues, labelText = 'Trend', color = ChartPalette.violet) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.instances[canvasId]) {
      this.instances[canvasId].destroy();
      delete this.instances[canvasId];
    }

    const colors = this.getThemeColors();
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: labelText,
          data: dataValues,
          borderColor: color,
          backgroundColor: color === ChartPalette.violet ? 'rgba(124, 58, 237, 0.05)' : 'rgba(0, 120, 212, 0.05)',
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointBackgroundColor: color,
          pointBorderColor: this.isDarkMode() ? '#161b27' : '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            titleColor: colors.tooltipText,
            bodyColor: colors.tooltipText,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: colors.text, font: { family: 'Inter', size: 11 } }
          },
          y: {
            grid: { color: colors.grid },
            ticks: { color: colors.text, font: { family: 'Inter', size: 11 } }
          }
        }
      }
    });

    this.register(canvasId, chart);
  },

  // 3. General Pie Chart
  createPieChart(canvasId, labels, dataValues) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.instances[canvasId]) {
      this.instances[canvasId].destroy();
      delete this.instances[canvasId];
    }

    const colors = this.getThemeColors();
    const chart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          data: dataValues,
          backgroundColor: [
            ChartPalette.primary,
            ChartPalette.violet,
            ChartPalette.success,
            ChartPalette.warning,
            ChartPalette.danger,
            ChartPalette.info,
            '#0891b2',
            '#4f46e5',
            '#e65100',
            '#ec4899',
            '#14b8a6',
            '#f59e0b'
          ],
          borderColor: this.isDarkMode() ? '#161b27' : '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: colors.text,
              font: { family: 'Inter', size: 11 },
              padding: 10,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            titleColor: colors.tooltipText,
            bodyColor: colors.tooltipText,
            padding: 10
          }
        }
      }
    });

    this.register(canvasId, chart);
  },

  // 4. General Donut Chart
  createDonutChart(canvasId, labels, dataValues) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.instances[canvasId]) {
      this.instances[canvasId].destroy();
      delete this.instances[canvasId];
    }

    const colors = this.getThemeColors();
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: dataValues,
          backgroundColor: [
            ChartPalette.primary,
            ChartPalette.success,
            ChartPalette.violet,
            ChartPalette.warning,
            ChartPalette.danger,
            ChartPalette.info
          ],
          borderColor: this.isDarkMode() ? '#161b27' : '#ffffff',
          borderWidth: 2,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: colors.text,
              font: { family: 'Inter', size: 11 },
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            titleColor: colors.tooltipText,
            bodyColor: colors.tooltipText,
            padding: 10
          }
        }
      }
    });

    this.register(canvasId, chart);
  },

  // Update existing chart labels + data IN PLACE (no destroy/recreate)
  // Returns true if the chart existed and was updated.
  // Returns false if chart doesn't exist yet (caller must create it).
  updateChart(canvasId, labels, dataValues) {
    const chart = this.instances[canvasId];
    if (!chart) return false;
    chart.data.labels = labels;
    if (chart.data.datasets && chart.data.datasets.length > 0) {
      chart.data.datasets[0].data = dataValues;
    }
    chart.update('active'); // smooth transition animation
    return true;
  },

  // Triggered when theme updates dynamically
  updateThemeColors() {
    const colors = this.getThemeColors();
    const isDark = this.isDarkMode();

    Object.values(this.instances).forEach(chart => {
      // 1. Update text colors in Legend
      if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
        chart.options.plugins.legend.labels.color = colors.text;
      }
      
      // 2. Update tooltips
      if (chart.options.plugins && chart.options.plugins.tooltip) {
        chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
        chart.options.plugins.tooltip.borderColor = colors.tooltipBorder;
        chart.options.plugins.tooltip.titleColor = colors.tooltipText;
        chart.options.plugins.tooltip.bodyColor = colors.tooltipText;
      }

      // 3. Update scales for line & bar charts
      if (chart.options.scales) {
        if (chart.options.scales.x && chart.options.scales.x.ticks) {
          chart.options.scales.x.ticks.color = colors.text;
        }
        if (chart.options.scales.y) {
          if (chart.options.scales.y.ticks) {
            chart.options.scales.y.ticks.color = colors.text;
          }
          if (chart.options.scales.y.grid) {
            chart.options.scales.y.grid.color = colors.grid;
          }
        }
      }

      // 4. Update dataset borders for donuts
      if (chart.config.type === 'doughnut' || chart.config.type === 'pie') {
        chart.data.datasets.forEach(dataset => {
          dataset.borderColor = isDark ? '#161b27' : '#ffffff';
        });
      }

      chart.update();
    });
  }
};

// Listen to custom themechanged event
window.addEventListener('themechanged', () => {
  Charts.updateThemeColors();
});
