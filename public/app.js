// Initialize Socket.IO connection
const socket = io();

// Error handling utility
function showError(message, duration = 5000) {
  // Create error toast if it doesn't exist
  let errorToast = document.getElementById('error-toast');
  if (!errorToast) {
    errorToast = document.createElement('div');
    errorToast.id = 'error-toast';
    errorToast.className = 'error-toast';
    document.body.appendChild(errorToast);
  }
  
  errorToast.textContent = message;
  errorToast.classList.add('show');
  
  setTimeout(() => {
    errorToast.classList.remove('show');
  }, duration);
}

// Loading state utility
function setLoading(elementId, isLoading) {
  const element = document.getElementById(elementId);
  if (element) {
    if (isLoading) {
      element.classList.add('loading');
      element.setAttribute('aria-busy', 'true');
    } else {
      element.classList.remove('loading');
      element.setAttribute('aria-busy', 'false');
    }
  }
}

// HTML sanitization utility
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Safe text content setter
function setTextContent(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = text;
  }
}

// Chart instances
const charts = {};

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Chart update debounce timers
const chartDebounceTimers = {
  cost: null,
  token: null,
  lines: null
};

// Initialize charts
function initializeCharts() {
  // Cost chart
  const costCtx = document.getElementById('cost-chart').getContext('2d');
  charts.cost = new Chart(costCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: '#DB4D6D',
        backgroundColor: 'rgba(219, 77, 109, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { display: false },
        y: { display: false }
      }
    }
  });

  // Token usage chart
  const tokenCtx = document.getElementById('token-chart').getContext('2d');
  charts.token = new Chart(tokenCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: '#8A9A5B',
        backgroundColor: 'rgba(138, 154, 91, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { display: false },
        y: { display: false }
      }
    }
  });

  // Lines of code chart
  const linesCtx = document.getElementById('lines-chart').getContext('2d');
  charts.lines = new Chart(linesCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: '#8A9A5B',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { display: false },
        y: { display: false }
      }
    }
  });

  // Removed cumulative chart - now using cards for trends
}

// Trends data storage
const trendsData = {
  daily: { cost: 0, tokens: 0, lines: 0, costAvg: 0, tokensAvg: 0, linesAvg: 0 },
  weekly: { cost: 0, tokens: 0, lines: 0, costAvg: 0, tokensAvg: 0, linesAvg: 0 },
  monthly: { cost: 0, tokens: 0, lines: 0, costAvg: 0, tokensAvg: 0, linesAvg: 0 }
};

let currentPeriod = 'daily';

// Update trends display
function updateTrendsDisplay() {
  const data = trendsData[currentPeriod];
  const periodText = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);
  
  // Update cost card
  document.getElementById('trend-cost-value').textContent = `$${data.cost.toFixed(2)}`;
  document.getElementById('trend-cost-total').textContent = `$${data.cost.toFixed(2)}`;
  document.getElementById('trend-cost-avg').textContent = `$${data.costAvg.toFixed(2)}`;
  document.getElementById('trend-cost-subtitle').textContent = periodText;
  
  // Update token card
  document.getElementById('trend-token-value').textContent = data.tokens.toLocaleString();
  document.getElementById('trend-token-total').textContent = data.tokens.toLocaleString();
  document.getElementById('trend-token-avg').textContent = Math.round(data.tokensAvg).toLocaleString();
  document.getElementById('trend-token-subtitle').textContent = periodText;
  
  // Update lines card
  document.getElementById('trend-lines-value').textContent = data.lines.toLocaleString();
  document.getElementById('trend-lines-total').textContent = data.lines.toLocaleString();
  document.getElementById('trend-lines-avg').textContent = Math.round(data.linesAvg).toLocaleString();
  document.getElementById('trend-lines-subtitle').textContent = periodText;
  
  // Update added/removed lines
  document.getElementById('trend-lines-added').textContent = (data.linesAdded || 0).toLocaleString();
  document.getElementById('trend-lines-removed').textContent = (data.linesRemoved || 0).toLocaleString();
}

// Debounced chart update functions
const debouncedChartUpdates = {
  cost: debounce((value, timestamp) => {
    if (charts.cost && charts.cost.data) {
      charts.cost.data.labels.push(timestamp);
      charts.cost.data.datasets[0].data.push(value);
      
      // Keep only data from last 10 minutes
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      while (charts.cost.data.labels.length > 0) {
        const firstTimestamp = new Date(charts.cost.data.labels[0]).getTime();
        if (firstTimestamp < tenMinutesAgo) {
          charts.cost.data.labels.shift();
          charts.cost.data.datasets[0].data.shift();
        } else {
          break;
        }
      }
      
      charts.cost.update('none'); // No animation for performance
    }
  }, 500),
  
  token: debounce((value, timestamp) => {
    if (charts.token && charts.token.data) {
      charts.token.data.labels.push(timestamp);
      charts.token.data.datasets[0].data.push(value);
      
      // Keep only data from last 10 minutes
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      while (charts.token.data.labels.length > 0) {
        const firstTimestamp = new Date(charts.token.data.labels[0]).getTime();
        if (firstTimestamp < tenMinutesAgo) {
          charts.token.data.labels.shift();
          charts.token.data.datasets[0].data.shift();
        } else {
          break;
        }
      }
      
      charts.token.update('none');
    }
  }, 500),
  
  lines: debounce((value, timestamp) => {
    if (charts.lines && charts.lines.data) {
      charts.lines.data.labels.push(timestamp);
      charts.lines.data.datasets[0].data.push(value);
      
      // Keep only data from last 10 minutes
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      while (charts.lines.data.labels.length > 0) {
        const firstTimestamp = new Date(charts.lines.data.labels[0]).getTime();
        if (firstTimestamp < tenMinutesAgo) {
          charts.lines.data.labels.shift();
          charts.lines.data.datasets[0].data.shift();
        } else {
          break;
        }
      }
      
      charts.lines.update('none');
    }
  }, 500)
};

// Historical model token data function removed - feature deprecated

// Load historical data from Supabase
async function loadHistoricalData(period) {
  try {
    setLoading('trend-cost-card', true);
    setLoading('trend-token-card', true);
    setLoading('trend-lines-card', true);
    
    const response = await fetch(`/api/metrics/historical?period=${period}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch historical data: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Calculate totals and averages
    const costTotal = data.cost.reduce((sum, val) => sum + val, 0);
    const tokensTotal = data.tokens.reduce((sum, val) => sum + val, 0);
    const linesTotal = data.lines.reduce((sum, val) => sum + val, 0);
    const linesAddedTotal = data.linesAdded ? data.linesAdded.reduce((sum, val) => sum + val, 0) : 0;
    const linesRemovedTotal = data.linesRemoved ? data.linesRemoved.reduce((sum, val) => sum + val, 0) : 0;
    
    // Calculate proper averages based on period
    let divisor = 1;
    if (period === 'daily') {
      divisor = data.labels.length || 1; // Average per day
    } else if (period === 'weekly') {
      divisor = 7; // Average per day in the week
    } else if (period === 'monthly') {
      const now = new Date();
      divisor = now.getDate(); // Days elapsed in current month
    }
    
    // Update trends data
    trendsData[period] = {
      cost: costTotal,
      tokens: tokensTotal * 1000, // Convert from k back to actual
      lines: linesTotal,
      linesAdded: linesAddedTotal,
      linesRemoved: linesRemovedTotal,
      costAvg: costTotal / divisor,
      tokensAvg: (tokensTotal * 1000) / divisor,
      linesAvg: linesTotal / divisor
    };
    
    // Update display
    updateTrendsDisplay();
    
  } catch (error) {
    console.error('Error loading historical data:', error);
    showError('Failed to load historical data. Please try again.');
    
    // Set default values if historical data fails
    trendsData[period] = {
      cost: 0,
      tokens: 0,
      lines: 0,
      costAvg: 0,
      tokensAvg: 0,
      linesAvg: 0,
      linesAdded: 0,
      linesRemoved: 0
    };
    updateTrendsDisplay();
  } finally {
    setLoading('trend-cost-card', false);
    setLoading('trend-token-card', false);
    setLoading('trend-lines-card', false);
  }
}

// Update metric display
function updateMetric(name, dataPoint, cumulative) {
  const { timestamp, value } = dataPoint;
  
  // Update last update time
  updateLastUpdateTime();
  
  switch(name) {
    case 'claude_code.cost.usage':
      updateCostMetric(value, cumulative);
      debouncedChartUpdates.cost(value, timestamp);
      break;
      
    case 'claude_code.token.usage':
      updateTokenMetric(value, cumulative);
      debouncedChartUpdates.token(value, timestamp);
      break;
      
    case 'claude_code.lines_of_code.count':
      updateLinesMetric(value, cumulative);
      debouncedChartUpdates.lines(value, timestamp);
      break;
      
    case 'claude_code.session.count':
      updateSessionMetric(value);
      break;
  }
}

// Update cost metric
function updateCostMetric(value, cumulative) {
  const element = document.getElementById('cost-value');
  const trend = document.getElementById('cost-trend');
  const totalElement = document.getElementById('cost-total');
  const avgElement = document.getElementById('cost-avg');
  
  const oldValue = parseFloat(element.textContent.replace('$', ''));
  element.textContent = `$${value.toFixed(2)}`;
  
  // Update cumulative stats
  if (cumulative) {
    totalElement.textContent = `$${cumulative.total.toFixed(2)}`;
    avgElement.textContent = `$${cumulative.average.toFixed(2)}`;
  }
  
  updateTrend(trend, value, oldValue);
}

// Update token metric
function updateTokenMetric(value, cumulative) {
  const element = document.getElementById('token-value');
  const trend = document.getElementById('token-trend');
  const totalElement = document.getElementById('token-total');
  const avgElement = document.getElementById('token-avg');
  
  const oldValue = parseInt(element.textContent.replace(/,/g, ''));
  element.textContent = value.toLocaleString();
  
  // Update cumulative stats
  if (cumulative) {
    totalElement.textContent = cumulative.total.toLocaleString();
    avgElement.textContent = Math.round(cumulative.average).toLocaleString();
  }
  
  updateTrend(trend, value, oldValue);
}

// Update lines metric
function updateLinesMetric(value, cumulative) {
  const element = document.getElementById('lines-value');
  const trend = document.getElementById('lines-trend');
  
  const oldValue = parseInt(element.textContent.replace(/,/g, ''));
  element.textContent = value.toLocaleString();
  
  updateTrend(trend, value, oldValue);
  
  // Update added/removed from cumulative data
  if (cumulative && cumulative.added !== undefined && cumulative.removed !== undefined) {
    updateLinesAddedMetric(cumulative.added);
    updateLinesRemovedMetric(cumulative.removed);
  }
}

// Update lines added metric
function updateLinesAddedMetric(value) {
  const element = document.getElementById('lines-added');
  if (element) {
    element.textContent = value.toLocaleString();
  }
}

// Update lines removed metric
function updateLinesRemovedMetric(value) {
  const element = document.getElementById('lines-removed');
  if (element) {
    element.textContent = value.toLocaleString();
  }
}

// Model breakdown display function removed - feature deprecated

// Update session metric
function updateSessionMetric(value) {
  // Update header session counter
  const headerElement = document.getElementById('header-session-value');
  if (headerElement) {
    headerElement.textContent = value;
  }
  
  // Update session value if it still exists (for compatibility)
  const element = document.getElementById('session-value');
  if (element) {
    element.textContent = value;
  }
  
  // Update session indicator if it exists
  const indicator = document.getElementById('session-indicator');
  if (indicator) {
    while (indicator.firstChild) {
      indicator.removeChild(indicator.firstChild);
    }
    for (let i = 0; i < Math.min(value, 5); i++) {
      const dot = document.createElement('div');
      dot.className = 'session-dot';
      dot.style.animationDelay = `${i * 0.2}s`;
      indicator.appendChild(dot);
    }
  }
}


// Update last update time
function updateLastUpdateTime() {
  const element = document.getElementById('last-update');
  if (element) {
    element.textContent = 'Updated just now';
    
    // Clear any existing timeout
    if (window.lastUpdateTimeout) {
      clearTimeout(window.lastUpdateTimeout);
    }
    
    // Update to "seconds ago" after a delay
    window.lastUpdateTimeout = setTimeout(() => {
      element.textContent = 'Updated seconds ago';
    }, 5000);
  }
}

// Update trend indicator
function updateTrend(element, newValue, oldValue) {
  if (newValue > oldValue) {
    element.textContent = `↑ ${((newValue - oldValue) / oldValue * 100).toFixed(1)}%`;
    element.className = 'trend up';
  } else if (newValue < oldValue) {
    element.textContent = `↓ ${((oldValue - newValue) / oldValue * 100).toFixed(1)}%`;
    element.className = 'trend down';
  } else {
    element.textContent = '';
    element.className = 'trend';
  }
}

// Update chart function removed - replaced by debounced versions

// Socket event handlers
socket.on('connect', () => {
  document.getElementById('connection-status').className = 'status-indicator connected';
  document.getElementById('connection-text').textContent = 'Connected';
});

socket.on('disconnect', () => {
  document.getElementById('connection-status').className = 'status-indicator disconnected';
  document.getElementById('connection-text').textContent = 'Disconnected';
});

socket.on('metrics-init', (data) => {
  const { metrics, cumulative, tokensByModel, activeSessionCount } = data;
  
  // Process initial metrics
  Object.entries(metrics).forEach(([name, values]) => {
    if (values.length > 0) {
      const latest = values[values.length - 1];
      updateMetric(name, latest, cumulative[name]);
    }
  });
  
  // Model breakdown removed - feature deprecated
  
  // Update active session count if provided
  if (activeSessionCount !== undefined) {
    updateMetric('claude_code.session.count', {
      timestamp: new Date().toISOString(),
      value: activeSessionCount
    });
  }
});

socket.on('metric-update', (data) => {
  const { name, dataPoint, cumulative } = data;
  updateMetric(name, dataPoint, cumulative);
  
  // If it's a token update and has model info, fetch updated model breakdown
  if (name === 'claude_code.token.usage' && dataPoint.model) {
    fetch('/api/metrics/model-tokens')
      .then(res => res.json())
      .then(data => {
        // Model breakdown feature removed
      })
      .catch(err => console.error('Error fetching model tokens:', err));
  }
});

// Handle activity updates
socket.on('activity-update', (activity) => {
  addActivity(activity);
});

// Setup modal functionality
function initializeSetupModal() {
  const modal = document.getElementById('setup-modal');
  const setupButton = document.getElementById('configure-button');
  const closeButton = document.getElementById('modal-close');
  const configBlock = document.getElementById('config-block');
  const copyJsonButton = document.getElementById('copy-json-button');
  const downloadJsonButton = document.getElementById('download-json-button');
  
  // Configuration JSON
  const configJson = {
    "model": "opus",
    "env": {
      "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
      "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:2025",
      "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
      "OTEL_METRICS_EXPORTER": "otlp",
      "OTEL_METRIC_EXPORT_INTERVAL": "3000",
      "OTEL_LOGS_EXPORT_INTERVAL": "3000",
      "OTEL_LOG_USER_PROMPTS": "1",
      "OTEL_METRICS_INCLUDE_ACCOUNT_UUID": "false"
    }
  };
  
  // Show modal
  setupButton.addEventListener('click', () => {
    modal.classList.add('active');
  });
  
  // Close modal
  closeButton.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  // Close on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
  
  // Copy JSON to clipboard
  copyJsonButton.addEventListener('click', async () => {
    try {
      const jsonString = JSON.stringify(configJson, null, 2);
      await navigator.clipboard.writeText(jsonString);
      copyJsonButton.classList.add('copied');
      const originalText = copyJsonButton.textContent;
      copyJsonButton.textContent = 'Copied!';
      
      setTimeout(() => {
        copyJsonButton.classList.remove('copied');
        copyJsonButton.textContent = originalText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy JSON:', err);
      showError('Failed to copy to clipboard');
    }
  });
  
  // Download JSON as file
  downloadJsonButton.addEventListener('click', () => {
    try {
      const jsonString = JSON.stringify(configJson, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'settings.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download JSON:', err);
      showError('Failed to download settings file');
    }
  });
}

// Add activity to list
function addActivity(activity) {
  const container = document.getElementById('activities-container');
  const emptyState = container.querySelector('.empty-state');
  
  if (emptyState) {
    emptyState.remove();
  }
  
  const item = document.createElement('div');
  item.className = 'activity-item';
  const activityId = `activity-${Date.now()}`;
  
  const time = new Date(activity.timestamp).toLocaleTimeString();
  const { request } = activity;
  
  // Create elements safely
  const header = document.createElement('div');
  header.className = 'activity-header';
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'activity-time';
  timeSpan.textContent = time;
  
  const methodSpan = document.createElement('span');
  methodSpan.className = 'activity-method';
  methodSpan.textContent = request.method;
  
  header.appendChild(timeSpan);
  header.appendChild(methodSpan);
  
  const urlDiv = document.createElement('div');
  urlDiv.className = 'activity-url';
  urlDiv.textContent = request.url;
  
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'activity-toggle';
  toggleBtn.setAttribute('data-target', activityId);
  toggleBtn.textContent = 'View Details';
  
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'activity-body';
  bodyDiv.id = activityId;
  
  const pre = document.createElement('pre');
  pre.className = 'activity-json';
  pre.textContent = JSON.stringify(request.body, null, 2);
  bodyDiv.appendChild(pre);
  
  item.appendChild(header);
  item.appendChild(urlDiv);
  item.appendChild(toggleBtn);
  item.appendChild(bodyDiv);
  
  // Add click handler for toggle
  toggleBtn.addEventListener('click', () => {
    const body = item.querySelector(`#${activityId}`);
    body.classList.toggle('expanded');
    toggleBtn.textContent = body.classList.contains('expanded') ? 'Hide Details' : 'View Details';
  });
  
  container.insertBefore(item, container.firstChild);
  
  // Keep only last 50 activities
  while (container.children.length > 50) {
    container.removeChild(container.lastChild);
  }
}

// Initialize activities section
function initializeActivities() {
  const toggleButton = document.getElementById('toggle-activities');
  const container = document.getElementById('activities-container');
  
  toggleButton.addEventListener('click', () => {
    const isExpanded = container.style.display !== 'none';
    container.style.display = isExpanded ? 'none' : 'block';
    toggleButton.classList.toggle('expanded');
    toggleButton.querySelector('.toggle-text').textContent = isExpanded ? 'Show' : 'Hide';
  });
  
  // Load initial activities
  fetch('/api/activities')
    .then(res => res.json())
    .then(activities => {
      activities.reverse().forEach(activity => {
        addActivity(activity);
      });
    });
}

// Initialize token modal
function initializeTokenModal() {
  const modal = document.getElementById('token-modal');
  const detailBtn = document.getElementById('token-detail-btn');
  const closeBtn = document.getElementById('token-modal-close');
  const typesGrid = document.getElementById('token-types-grid');
  
  // Token type chart
  let tokenTypeChart = null;
  
  // Open modal
  detailBtn.addEventListener('click', async () => {
    modal.classList.add('active');
    
    // Fetch token details
    try {
      const response = await fetch('/api/metrics/token-details');
      const data = await response.json();
      
      // Clear existing content
      while (typesGrid.firstChild) {
        typesGrid.removeChild(typesGrid.firstChild);
      }
      
      // Create cards for each token type
      const tokenTypes = data.tokenTypes || {};
      Object.entries(tokenTypes).forEach(([type, value]) => {
        const card = document.createElement('div');
        card.className = 'token-type-card';
        
        const h4 = document.createElement('h4');
        h4.textContent = type;
        
        const valueDiv = document.createElement('div');
        valueDiv.className = 'token-type-value';
        valueDiv.textContent = value.toLocaleString();
        
        card.appendChild(h4);
        card.appendChild(valueDiv);
        typesGrid.appendChild(card);
      });
      
      // Create or update chart
      const ctx = document.getElementById('token-type-chart').getContext('2d');
      if (tokenTypeChart) {
        tokenTypeChart.destroy();
      }
      
      tokenTypeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: Object.keys(tokenTypes),
          datasets: [{
            data: Object.values(tokenTypes),
            backgroundColor: [
              '#DB4D6D',
              '#385F71',
              '#8A9A5B',
              '#F5CB5C',
              '#2B4162'
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 20,
                usePointStyle: true
              }
            }
          }
        }
      });
    } catch (error) {
      console.error('Error fetching token details:', error);
      while (typesGrid.firstChild) {
        typesGrid.removeChild(typesGrid.firstChild);
      }
      const errorMsg = document.createElement('p');
      errorMsg.textContent = 'Error loading token details';
      typesGrid.appendChild(errorMsg);
    }
  });
  
  // Close modal
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  // Close on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
}

// Initialize trend token modal
function initializeTrendTokenModal() {
  const modal = document.getElementById('trend-token-modal');
  const detailBtn = document.getElementById('trend-token-detail-btn');
  const closeBtn = document.getElementById('trend-token-modal-close');
  const typesGrid = document.getElementById('trend-token-types-grid');
  const periodTitle = document.getElementById('trend-token-period-title');
  
  // Token type chart for trends
  let trendTokenTypeChart = null;
  
  // Open modal
  detailBtn.addEventListener('click', async () => {
    modal.classList.add('active');
    
    // Update period title
    const periodText = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);
    periodTitle.textContent = `${periodText} Token Usage by Type`;
    
    // Fetch historical token details
    try {
      const response = await fetch(`/api/metrics/historical-token-details?period=${currentPeriod}`);
      const data = await response.json();
      
      // Clear existing content
      while (typesGrid.firstChild) {
        typesGrid.removeChild(typesGrid.firstChild);
      }
      
      // Create cards for each token type
      const tokenTypes = data.tokenTypes || {};
      Object.entries(tokenTypes).forEach(([type, value]) => {
        const card = document.createElement('div');
        card.className = 'token-type-card';
        
        const h4 = document.createElement('h4');
        h4.textContent = type;
        
        const valueDiv = document.createElement('div');
        valueDiv.className = 'token-type-value';
        valueDiv.textContent = value.toLocaleString();
        
        card.appendChild(h4);
        card.appendChild(valueDiv);
        typesGrid.appendChild(card);
      });
      
      // Create or update chart
      const ctx = document.getElementById('trend-token-type-chart').getContext('2d');
      if (trendTokenTypeChart) {
        trendTokenTypeChart.destroy();
      }
      
      trendTokenTypeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: Object.keys(tokenTypes),
          datasets: [{
            data: Object.values(tokenTypes),
            backgroundColor: [
              '#DB4D6D',
              '#385F71',
              '#8A9A5B',
              '#F5CB5C',
              '#2B4162'
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 20,
                usePointStyle: true
              }
            }
          }
        }
      });
    } catch (error) {
      console.error('Error fetching historical token details:', error);
      while (typesGrid.firstChild) {
        typesGrid.removeChild(typesGrid.firstChild);
      }
      const errorMsg = document.createElement('p');
      errorMsg.textContent = 'Error loading token details';
      typesGrid.appendChild(errorMsg);
    }
  });
  
  // Close modal
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  // Close on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initializeCharts();
  initializeSetupModal();
  initializeTokenModal();
  initializeTrendTokenModal();
  initializeActivities();
  
  // Initialize time period buttons
  const timeBtns = document.querySelectorAll('.time-btn');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      timeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update current period and load historical data
      currentPeriod = btn.dataset.period;
      loadHistoricalData(currentPeriod);
    });
  });
  
  // Load initial historical data
  loadHistoricalData('daily');
  
  // Load recent chart data (last 10 minutes)
  fetch('/api/metrics/recent-chart-data')
    .then(res => res.json())
    .then(data => {
      // Populate cost chart
      if (data.cost && charts.cost) {
        data.cost.forEach(point => {
          charts.cost.data.labels.push(point.timestamp);
          charts.cost.data.datasets[0].data.push(point.value);
        });
        charts.cost.update('none');
      }
      
      // Populate token chart
      if (data.token && charts.token) {
        data.token.forEach(point => {
          charts.token.data.labels.push(point.timestamp);
          charts.token.data.datasets[0].data.push(point.value);
        });
        charts.token.update('none');
      }
      
      // Populate lines chart
      if (data.lines && charts.lines) {
        data.lines.forEach(point => {
          charts.lines.data.labels.push(point.timestamp);
          charts.lines.data.datasets[0].data.push(point.value);
        });
        charts.lines.update('none');
      }
    })
    .catch(err => console.error('Failed to load recent chart data:', err));
  
  // Fetch initial summary
  fetch('/api/metrics/summary')
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch metrics summary');
      return res.json();
    })
    .then(summary => {
      Object.entries(summary).forEach(([name, data]) => {
        if (data.latest !== null) {
          updateMetric(name, { 
            timestamp: data.timestamp, 
            value: data.latest 
          }, data.cumulative);
        }
      });
    })
    .catch(error => {
      console.error('Error fetching initial summary:', error);
      showError('Failed to load initial metrics');
    });
  
  // Session management
  const sessionDropdown = document.getElementById('session-dropdown');
  const refreshSessionsBtn = document.getElementById('refresh-sessions');
  let currentSessionId = 'all';
  
  // Load available sessions
  async function loadSessions() {
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) throw new Error('Failed to fetch sessions');
      
      const data = await response.json();
      const { sessions } = data;
      
      // Clear existing options except "All Sessions"
      // Clear existing options
      while (sessionDropdown.options.length > 0) {
        sessionDropdown.remove(0);
      }
      // Add default option
      const defaultOption = document.createElement('option');
      defaultOption.value = 'all';
      defaultOption.textContent = 'All Sessions';
      sessionDropdown.appendChild(defaultOption);
      
      // Add session options
      sessions.forEach(session => {
        const option = document.createElement('option');
        option.value = session.sessionId;
        
        // Format display text
        let displayText = session.sessionId;
        if (session.userEmail) {
          displayText = `${session.userEmail} - ${session.sessionId.substring(0, 8)}...`;
        }
        if (session.isActive) {
            displayText = `● ${displayText} (Active)`;
          }
          
          option.textContent = displayText;
          sessionDropdown.appendChild(option);
        });
        
        // Restore previous selection if it still exists
        if (currentSessionId !== 'all') {
          sessionDropdown.value = currentSessionId;
        }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      showError('Failed to load sessions list');
    }
  }
  
  // Handle session selection
  sessionDropdown.addEventListener('change', (e) => {
    currentSessionId = e.target.value;
    
    if (currentSessionId === 'all') {
      // Show all sessions - reload normal metrics
      location.reload();
    } else {
      // Load session-specific metrics
      loadSessionMetrics(currentSessionId);
    }
  });
  
  // Handle refresh button
  refreshSessionsBtn.addEventListener('click', () => {
    refreshSessionsBtn.style.transform = 'rotate(360deg)';
    loadSessions();
    setTimeout(() => {
      refreshSessionsBtn.style.transform = '';
    }, 500);
  });
  
  // Load session-specific metrics
  function loadSessionMetrics(sessionId) {
    fetch(`/api/metrics/session/${sessionId}`)
      .then(res => res.json())
      .then(data => {
        // Update live metrics section with session data
        const { metrics, sessionMetrics } = data;
        
        // Update cost
        if (sessionMetrics.total_cost !== undefined) {
          updateMetric('claude_code.cost.usage', {
            timestamp: sessionMetrics.last_updated,
            value: sessionMetrics.total_cost
          });
        }
        
        // Update tokens
        const totalTokens = sessionMetrics.total_tokens_input + 
                          sessionMetrics.total_tokens_output + 
                          sessionMetrics.total_tokens_cache_read + 
                          sessionMetrics.total_tokens_cache_creation;
        
        if (totalTokens > 0) {
          updateMetric('claude_code.token.usage', {
            timestamp: sessionMetrics.last_updated,
            value: totalTokens
          });
        }
        
        // Update lines of code
        const totalLines = sessionMetrics.total_lines_added + sessionMetrics.total_lines_removed;
        if (totalLines > 0) {
          updateMetric('claude_code.lines_of_code.count', {
            timestamp: sessionMetrics.last_updated,
            value: totalLines,
            type: sessionMetrics.total_lines_added > sessionMetrics.total_lines_removed ? 'added' : 'removed'
          });
        }
        
        // Model breakdown feature removed
        
        // Update section title
        document.querySelector('.section-title').textContent = `Session Metrics: ${sessionId.substring(0, 8)}...`;
      })
      .catch(err => {
        console.error('Failed to load session metrics:', err);
      });
  }
  
  // Load sessions on startup
  loadSessions();
});