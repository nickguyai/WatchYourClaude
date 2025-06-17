const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const compression = require('compression');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 2025;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static('public'));

// In-memory metric storage
const metrics = {
  'claude_code.cost.usage': [],
  'claude_code.token.usage': [],
  'claude_code.lines_of_code.count': [],
  'claude_code.session.count': [],
  'claude_code.code_edit_tool.decision': []
};

// Cumulative tracking
const cumulative = {
  'claude_code.cost.usage': { total: 0, count: 0, average: 0 },
  'claude_code.token.usage': { total: 0, count: 0, average: 0 },
  'claude_code.lines_of_code.count': { 
    total: 0, 
    count: 0, 
    average: 0,
    added: 0,
    removed: 0
  }
};

// Token usage by model tracking
const tokensByModel = {};

// Active sessions tracking
const activeSessions = new Map(); // Map of sessionId -> lastSeen timestamp
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

// Function to clean up inactive sessions
function cleanupInactiveSessions() {
  const now = Date.now();
  for (const [sessionId, lastSeen] of activeSessions.entries()) {
    if (now - lastSeen > SESSION_TIMEOUT) {
      activeSessions.delete(sessionId);
      console.log(`Session ${sessionId} timed out and removed`);
    }
  }
  // Emit updated session count after cleanup
  io.emit('metric-update', {
    name: 'claude_code.session.count',
    dataPoint: {
      timestamp: new Date().toISOString(),
      value: activeSessions.size
    }
  });
}

// Run cleanup every minute
setInterval(cleanupInactiveSessions, 60000);

// Recent activities storage (raw requests to /v1/metrics)
const recentActivities = [];

// Logs/events storage
const logs = {
  'claude_code.user_prompt': [],
  'claude_code.tool_result': [],
  'claude_code.api_request': [],
  'claude_code.api_error': [],
  'claude_code.tool_decision': []
};

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    supabase: 'unknown'
  };
  
  // Test Supabase connection
  try {
    const { count, error } = await supabase
      .from('metrics')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      health.supabase = 'error';
      health.supabaseError = error.message;
    } else {
      health.supabase = 'connected';
      health.metricsCount = count;
    }
  } catch (err) {
    health.supabase = 'error';
    health.supabaseError = err.message;
  }
  
  res.json(health);
});

// OTLP logs endpoint
app.post('/v1/logs', (req, res) => {
  try {
    const { resourceLogs } = req.body;
    
    if (!resourceLogs || !Array.isArray(resourceLogs)) {
      return res.status(400).json({ error: 'Invalid log data' });
    }

    // Process logs
    resourceLogs.forEach(rl => {
      rl.scopeLogs?.forEach(sl => {
        sl.logRecords?.forEach(logRecord => {
          processLog(logRecord);
        });
      });
    });

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error processing logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process individual log/event
function processLog(logRecord) {
  const { attributes, timeUnixNano, body } = logRecord;
  
  // Extract event name from attributes
  let eventName = null;
  const parsedAttributes = {};
  
  attributes?.forEach(attr => {
    if (attr.key === 'event.name') {
      eventName = attr.value?.stringValue;
    }
    parsedAttributes[attr.key] = attr.value?.stringValue || attr.value?.intValue || attr.value?.doubleValue;
  });

  if (!eventName || !logs[eventName]) {
    console.warn(`Unknown event: ${eventName}`);
    return;
  }

  // Convert Unix nano timestamp to ISO string
  const timestamp = new Date(parseInt(timeUnixNano) / 1000000).toISOString();
  
  const logEntry = {
    timestamp,
    attributes: parsedAttributes,
    body: body?.stringValue || ''
  };

  logs[eventName].push(logEntry);
  
  // Keep only last 1000 entries per event type
  if (logs[eventName].length > 1000) {
    logs[eventName].shift();
  }

  // Emit real-time update
  io.emit('log-update', { eventName, logEntry });
}

// OTLP metrics endpoint
app.post('/v1/metrics', (req, res) => {
  try {
    const { resourceMetrics } = req.body;
    
    // Store recent activity
    const activity = {
      timestamp: new Date().toISOString(),
      request: {
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.url
      }
    };
    
    recentActivities.unshift(activity);
    
    // Keep only last 100 activities
    if (recentActivities.length > 100) {
      recentActivities.pop();
    }
    
    // Emit activity to connected clients
    io.emit('activity-update', activity);
    
    if (!resourceMetrics || !Array.isArray(resourceMetrics)) {
      return res.status(400).json({ error: 'Invalid metric data' });
    }

    // Process metrics and store in Supabase
    processAndStoreMetrics(resourceMetrics).catch(error => {
      console.error('Error storing metrics in Supabase:', error);
    });
    
    // Process metrics for real-time display
    resourceMetrics.forEach(rm => {
      rm.scopeMetrics?.forEach(sm => {
        sm.metrics?.forEach(metric => {
          processMetric(metric);
        });
      });
    });

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error processing metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to extract attributes
function extractAttributes(attributes) {
  const result = {};
  for (const attr of attributes || []) {
    result[attr.key] = attr.value?.stringValue || 
                       attr.value?.intValue || 
                       attr.value?.doubleValue || 
                       attr.value?.boolValue;
  }
  return result;
}

// Process and store metrics in Supabase
async function processAndStoreMetrics(resourceMetrics) {
  for (const resource of resourceMetrics) {
    const serviceAttrs = extractAttributes(resource.resource?.attributes);
    
    for (const scopeMetric of resource.scopeMetrics || []) {
      for (const metric of scopeMetric.metrics || []) {
        const dataPoints = metric.sum?.dataPoints || 
                          metric.gauge?.dataPoints || 
                          metric.histogram?.dataPoints || [];
        
        for (const dataPoint of dataPoints) {
          const attrs = extractAttributes(dataPoint.attributes);
          
          // Extract value based on metric type
          let metricValue = dataPoint.asDouble || dataPoint.asInt || 0;
          if (metric.histogram && dataPoint.sum !== undefined) {
            metricValue = dataPoint.sum;
          }
          
          // Only set token_type for token usage metrics
          let tokenType = null;
          if (metric.name === 'claude_code.token.usage' && attrs.type) {
            tokenType = attrs.type;
          }
          
          // Track token usage by model
          if (metric.name === 'claude_code.token.usage') {
            const model = attrs.model || 'Unknown';
            if (!tokensByModel[model]) {
              tokensByModel[model] = 0;
            }
            tokensByModel[model] += metricValue;
          }
          
          // Track active sessions
          if (attrs['session.id']) {
            const sessionId = attrs['session.id'];
            const wasNewSession = !activeSessions.has(sessionId);
            activeSessions.set(sessionId, Date.now());
            
            if (wasNewSession) {
              console.log(`New session detected: ${sessionId}. Total active sessions: ${activeSessions.size}`);
            }
            
            // Emit session count update
            io.emit('metric-update', {
              name: 'claude_code.session.count',
              dataPoint: {
                timestamp: new Date().toISOString(),
                value: activeSessions.size
              }
            });
          }
          
          // Set lines_type for lines of code metrics
          let linesType = null;
          if (metric.name === 'claude_code.lines_of_code.count' && attrs.type) {
            linesType = attrs.type;
          }
          
          const metricData = {
            metric_name: metric.name,
            metric_value: metricValue,
            metric_unit: metric.unit || null,
            metric_description: metric.description || null,
            start_time_unix_nano: dataPoint.startTimeUnixNano || dataPoint.timeUnixNano || (Date.now() * 1000000).toString(),
            time_unix_nano: dataPoint.timeUnixNano || (Date.now() * 1000000).toString(),
            user_id: attrs['user.id'],
            session_id: attrs['session.id'],
            organization_id: attrs['organization.id'] || null,
            user_email: attrs['user.email'] || null,
            model: attrs.model || null,
            token_type: tokenType,
            lines_type: linesType,
            decision_type: attrs.decision || null,
            service_name: serviceAttrs['service.name'] || 'claude-code',
            service_version: serviceAttrs['service.version'] || null,
            scope_name: scopeMetric.scope?.name || null,
            scope_version: scopeMetric.scope?.version || null,
            raw_data_point: dataPoint
          };
          
          try {
            const { error } = await supabase
              .from('metrics')
              .insert(metricData);
              
            if (error) {
              console.error('Supabase insert error:', error);
            }
          } catch (err) {
            console.error('Error inserting metric:', err);
          }
        }
      }
    }
  }
}

// Process individual metric
function processMetric(metric) {
  const { name, sum, gauge, histogram } = metric;
  
  if (!metrics[name]) {
    console.warn(`Unknown metric: ${name}`);
    return;
  }

  const timestamp = new Date().toISOString();
  let value = null;
  let type = null;
  let model = null;

  // Extract value based on metric type
  if (sum) {
    value = sum.dataPoints?.[0]?.asInt || sum.dataPoints?.[0]?.asDouble;
    // Extract attributes
    const attrs = sum.dataPoints?.[0]?.attributes || [];
    const typeAttr = attrs.find(attr => attr.key === 'type');
    if (typeAttr) {
      type = typeAttr.value?.stringValue;
    }
    const modelAttr = attrs.find(attr => attr.key === 'model');
    if (modelAttr) {
      model = modelAttr.value?.stringValue;
    }
    
    // Track active sessions
    const sessionIdAttr = attrs.find(attr => attr.key === 'session.id');
    if (sessionIdAttr && sessionIdAttr.value?.stringValue) {
      const sessionId = sessionIdAttr.value.stringValue;
      const wasNewSession = !activeSessions.has(sessionId);
      activeSessions.set(sessionId, Date.now());
      
      // Emit session count update if this is a new session
      if (wasNewSession) {
        console.log(`New session detected: ${sessionId}. Total active sessions: ${activeSessions.size}`);
      }
      
      // Always emit current session count
      io.emit('metric-update', {
        name: 'claude_code.session.count',
        dataPoint: {
          timestamp: new Date().toISOString(),
          value: activeSessions.size
        }
      });
    }
  } else if (gauge) {
    value = gauge.dataPoints?.[0]?.asInt || gauge.dataPoints?.[0]?.asDouble;
    // Extract attributes for gauge
    const attrs = gauge.dataPoints?.[0]?.attributes || [];
    const sessionIdAttr = attrs.find(attr => attr.key === 'session.id');
    if (sessionIdAttr && sessionIdAttr.value?.stringValue) {
      const sessionId = sessionIdAttr.value.stringValue;
      const wasNewSession = !activeSessions.has(sessionId);
      activeSessions.set(sessionId, Date.now());
      
      if (wasNewSession) {
        console.log(`New session detected: ${sessionId}. Total active sessions: ${activeSessions.size}`);
      }
      
      io.emit('metric-update', {
        name: 'claude_code.session.count',
        dataPoint: {
          timestamp: new Date().toISOString(),
          value: activeSessions.size
        }
      });
    }
  } else if (histogram) {
    value = histogram.dataPoints?.[0]?.sum;
  }

  if (value !== null && value !== undefined) {
    const dataPoint = { timestamp, value, type, model };
    metrics[name].push(dataPoint);
    
    // Update cumulative data
    if (cumulative[name]) {
      cumulative[name].total += value;
      cumulative[name].count += 1;
      cumulative[name].average = cumulative[name].total / cumulative[name].count;
      
      // Special handling for lines of code with type
      if (name === 'claude_code.lines_of_code.count' && type) {
        if (type === 'added') {
          cumulative[name].added += value;
        } else if (type === 'removed') {
          cumulative[name].removed += value;
        }
      }
      
      // Track token usage by model
      if (name === 'claude_code.token.usage') {
        const modelKey = model || 'Unknown';
        if (!tokensByModel[modelKey]) {
          tokensByModel[modelKey] = 0;
        }
        tokensByModel[modelKey] += value;
      }
    }
    
    // Keep only last 1000 data points per metric
    if (metrics[name].length > 1000) {
      metrics[name].shift();
    }

    // Emit real-time update with cumulative data
    const updateData = { name, dataPoint };
    if (cumulative[name]) {
      updateData.cumulative = {
        total: cumulative[name].total,
        average: cumulative[name].average,
        count: cumulative[name].count
      };
      
      // Include added/removed for lines of code
      if (name === 'claude_code.lines_of_code.count') {
        updateData.cumulative.added = cumulative[name].added;
        updateData.cumulative.removed = cumulative[name].removed;
      }
    }
    io.emit('metric-update', updateData);
  }
}

// API endpoint to get metrics
app.get('/api/metrics', (req, res) => {
  const { metric, from, to } = req.query;
  
  let result = metrics;
  
  if (metric && metrics[metric]) {
    result = { [metric]: metrics[metric] };
  }
  
  // Filter by time range if provided
  if (from || to) {
    const fromTime = from ? new Date(from).getTime() : 0;
    const toTime = to ? new Date(to).getTime() : Date.now();
    
    result = Object.entries(result).reduce((acc, [key, values]) => {
      acc[key] = values.filter(v => {
        const time = new Date(v.timestamp).getTime();
        return time >= fromTime && time <= toTime;
      });
      return acc;
    }, {});
  }
  
  res.json(result);
});

// API endpoint to get metric summary
app.get('/api/metrics/summary', (req, res) => {
  const summary = {};
  
  Object.entries(metrics).forEach(([name, values]) => {
    if (values.length === 0) {
      summary[name] = { count: 0, latest: null, average: null };
      if (cumulative[name]) {
        summary[name].cumulative = cumulative[name];
      }
      return;
    }
    
    const latest = values[values.length - 1];
    const sum = values.reduce((acc, v) => acc + v.value, 0);
    const average = sum / values.length;
    
    summary[name] = {
      count: values.length,
      latest: latest.value,
      average: average.toFixed(2),
      timestamp: latest.timestamp
    };
    
    // Add cumulative data for cost and token metrics
    if (cumulative[name]) {
      summary[name].cumulative = cumulative[name];
    }
  });
  
  res.json(summary);
});

// API endpoint to get recent activities
app.get('/api/activities', (req, res) => {
  const { limit = 50 } = req.query;
  const activities = recentActivities.slice(0, parseInt(limit));
  res.json(activities);
});

// API endpoint to get logs/events
app.get('/api/logs', (req, res) => {
  const { event, from, to, limit = 100 } = req.query;
  
  let result = logs;
  
  if (event && logs[event]) {
    result = { [event]: logs[event] };
  }
  
  // Filter by time range if provided
  if (from || to) {
    const fromTime = from ? new Date(from).getTime() : 0;
    const toTime = to ? new Date(to).getTime() : Date.now();
    
    result = Object.entries(result).reduce((acc, [key, entries]) => {
      acc[key] = entries.filter(entry => {
        const time = new Date(entry.timestamp).getTime();
        return time >= fromTime && time <= toTime;
      });
      return acc;
    }, {});
  }
  
  // Apply limit to each event type
  if (limit) {
    const limitNum = parseInt(limit);
    result = Object.entries(result).reduce((acc, [key, entries]) => {
      acc[key] = entries.slice(-limitNum);
      return acc;
    }, {});
  }
  
  res.json(result);
});

// API endpoint to get logs summary
app.get('/api/logs/summary', (req, res) => {
  const summary = {};
  
  Object.entries(logs).forEach(([eventName, entries]) => {
    summary[eventName] = {
      count: entries.length,
      latest: entries.length > 0 ? entries[entries.length - 1] : null
    };
  });
  
  res.json(summary);
});

// API endpoint to get recent chart data (last 10 minutes)
app.get('/api/metrics/recent-chart-data', async (req, res) => {
  try {
    const tenMinutesAgo = new Date(Date.now() - (10 * 60 * 1000));
    
    const { data, error } = await supabase
      .from('metrics')
      .select('metric_name, metric_value, time')
      .in('metric_name', ['claude_code.cost.usage', 'claude_code.token.usage', 'claude_code.lines_of_code.count'])
      .gte('time', tenMinutesAgo.toISOString())
      .order('time', { ascending: true });
    
    if (error) throw error;
    
    // Organize data by metric type
    const chartData = {
      cost: [],
      token: [],
      lines: []
    };
    
    (data || []).forEach(row => {
      const timestamp = new Date(row.time).toISOString();
      
      switch(row.metric_name) {
        case 'claude_code.cost.usage':
          chartData.cost.push({ timestamp, value: row.metric_value });
          break;
        case 'claude_code.token.usage':
          chartData.token.push({ timestamp, value: row.metric_value });
          break;
        case 'claude_code.lines_of_code.count':
          chartData.lines.push({ timestamp, value: row.metric_value });
          break;
      }
    });
    
    res.json(chartData);
  } catch (error) {
    console.error('Error fetching recent chart data:', error);
    res.status(500).json({ error: 'Failed to fetch recent chart data' });
  }
});

// API endpoint to get historical metrics from Supabase
app.get('/api/metrics/historical', async (req, res) => {
  try {
    const { period = 'daily', days = 30, timezoneOffset = 0 } = req.query;
    
    if (period === 'daily') {
      // Get today's date in the user's timezone
      const now = new Date();
      const userLocalTime = new Date(now.getTime() - (timezoneOffset * 60 * 1000));
      const today = userLocalTime.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('daily_summary')
        .select('date, total_cost, total_tokens, total_lines_of_code, total_lines_added, total_lines_removed')
        .eq('date', today)
        .order('date', { ascending: true });
      
      if (error) throw error;
      
      // Convert to arrays for response
      const labels = [];
      const costArray = [];
      const tokenArray = [];
      const linesArray = [];
      const linesAddedArray = [];
      const linesRemovedArray = [];
      
      (data || []).forEach(row => {
        const date = new Date(row.date);
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        costArray.push(row.total_cost || 0);
        tokenArray.push((row.total_tokens || 0) / 1000); // Convert to k
        linesArray.push(row.total_lines_of_code || 0);
        linesAddedArray.push(row.total_lines_added || 0);
        linesRemovedArray.push(row.total_lines_removed || 0);
      });
      
      res.json({
        labels,
        cost: costArray,
        tokens: tokenArray,
        lines: linesArray,
        linesAdded: linesAddedArray,
        linesRemoved: linesRemovedArray
      });
      
    } else if (period === 'weekly') {
      // Get last 12 weeks of data
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 84); // 12 weeks * 7 days
      
      const { data, error } = await supabase
        .from('daily_summary')
        .select('date, total_cost, total_tokens, total_lines_of_code, total_lines_added, total_lines_removed')
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date', { ascending: true });
      
      if (error) throw error;
      
      // Group by week
      const weeklyData = new Map();
      
      (data || []).forEach(row => {
        const date = new Date(row.date);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weeklyData.has(weekKey)) {
          weeklyData.set(weekKey, {
            date: weekStart,
            total_cost: 0,
            total_tokens: 0,
            total_lines_of_code: 0,
            total_lines_added: 0,
            total_lines_removed: 0
          });
        }
        
        const week = weeklyData.get(weekKey);
        week.total_cost += row.total_cost || 0;
        week.total_tokens += row.total_tokens || 0;
        week.total_lines_of_code += row.total_lines_of_code || 0;
        week.total_lines_added += row.total_lines_added || 0;
        week.total_lines_removed += row.total_lines_removed || 0;
      });
      
      // Convert to arrays
      const labels = [];
      const costArray = [];
      const tokenArray = [];
      const linesArray = [];
      const linesAddedArray = [];
      const linesRemovedArray = [];
      
      Array.from(weeklyData.values()).forEach(week => {
        labels.push(week.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        costArray.push(week.total_cost);
        tokenArray.push(week.total_tokens / 1000); // Convert to k
        linesArray.push(week.total_lines_of_code);
        linesAddedArray.push(week.total_lines_added);
        linesRemovedArray.push(week.total_lines_removed);
      });
      
      res.json({
        labels,
        cost: costArray,
        tokens: tokenArray,
        lines: linesArray,
        linesAdded: linesAddedArray,
        linesRemoved: linesRemovedArray
      });
      
    } else if (period === 'monthly') {
      // Get last 12 months of data
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 12);
      startDate.setDate(1); // Start from first day of month
      
      const { data, error } = await supabase
        .from('daily_summary')
        .select('date, total_cost, total_tokens, total_lines_of_code, total_lines_added, total_lines_removed')
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date', { ascending: true });
      
      if (error) throw error;
      
      // Group by month
      const monthlyData = new Map();
      
      (data || []).forEach(row => {
        const date = new Date(row.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData.has(monthKey)) {
          monthlyData.set(monthKey, {
            date: new Date(date.getFullYear(), date.getMonth(), 1),
            total_cost: 0,
            total_tokens: 0,
            total_lines_of_code: 0,
            total_lines_added: 0,
            total_lines_removed: 0
          });
        }
        
        const month = monthlyData.get(monthKey);
        month.total_cost += row.total_cost || 0;
        month.total_tokens += row.total_tokens || 0;
        month.total_lines_of_code += row.total_lines_of_code || 0;
        month.total_lines_added += row.total_lines_added || 0;
        month.total_lines_removed += row.total_lines_removed || 0;
      });
      
      // Convert to arrays
      const labels = [];
      const costArray = [];
      const tokenArray = [];
      const linesArray = [];
      const linesAddedArray = [];
      const linesRemovedArray = [];
      
      Array.from(monthlyData.values()).forEach(month => {
        labels.push(month.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
        costArray.push(month.total_cost);
        tokenArray.push(month.total_tokens / 1000); // Convert to k
        linesArray.push(month.total_lines_of_code);
        linesAddedArray.push(month.total_lines_added);
        linesRemovedArray.push(month.total_lines_removed);
      });
      
      res.json({
        labels,
        cost: costArray,
        tokens: tokenArray,
        lines: linesArray,
        linesAdded: linesAddedArray,
        linesRemoved: linesRemovedArray
      });
    }
  } catch (error) {
    console.error('Error fetching historical metrics:', error);
    res.status(500).json({ error: 'Failed to fetch historical metrics' });
  }
});

// API endpoint to get token details by type
app.get('/api/metrics/token-details', async (req, res) => {
  try {
    const tokenTypes = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0
    };
    
    // First, check in-memory metrics for token usage with types
    const tokenMetrics = metrics['claude_code.token.usage'] || [];
    tokenMetrics.forEach(metric => {
      if (metric.type) {
        tokenTypes[metric.type] = (tokenTypes[metric.type] || 0) + metric.value;
      }
    });
    
    // If we have some data from memory, return it
    if (Object.values(tokenTypes).some(val => val > 0)) {
      res.json({ tokenTypes });
      return;
    }
    
    // Otherwise, fetch from Supabase for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data, error } = await supabase
      .from('metrics')
      .select('metric_value, token_type')
      .eq('metric_name', 'claude_code.token.usage')
      .gte('time', today.toISOString())
      .lt('time', tomorrow.toISOString());
    
    if (!error && data) {
      // Aggregate by token type
      data.forEach(row => {
        if (row.token_type) {
          tokenTypes[row.token_type] = (tokenTypes[row.token_type] || 0) + (row.metric_value || 0);
        }
      });
    }
    
    res.json({ tokenTypes });
  } catch (error) {
    console.error('Error fetching token details:', error);
    res.status(500).json({ error: 'Failed to fetch token details' });
  }
});

// API endpoint to get historical token details by type
app.get('/api/metrics/historical-token-details', async (req, res) => {
  try {
    const { period = 'daily', timezoneOffset = 0 } = req.query;
    const tokenTypes = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0
    };
    
    // Calculate date range based on period in user's timezone
    const now = new Date();
    const userLocalTime = new Date(now.getTime() - (timezoneOffset * 60 * 1000));
    
    const endDate = new Date(userLocalTime);
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date(userLocalTime);
    
    if (period === 'daily') {
      // Get today's data in user's timezone
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'weekly') {
      // Get current week (Sunday to today) in user's timezone
      const dayOfWeek = startDate.getDay();
      startDate.setDate(startDate.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
    } else {
      // Get current month in user's timezone
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
    }
    
    // Adjust dates back to UTC for database query
    const startDateUTC = new Date(startDate.getTime() + (timezoneOffset * 60 * 1000));
    const endDateUTC = new Date(endDate.getTime() + (timezoneOffset * 60 * 1000));
    
    // Fetch data from daily_summary view
    const { data, error } = await supabase
      .from('daily_summary')
      .select('total_tokens_input, total_tokens_output, total_tokens_cache_read, total_tokens_cache_creation')
      .gte('date', startDateUTC.toISOString().split('T')[0])
      .lte('date', endDateUTC.toISOString().split('T')[0]);
    
    if (error) throw error;
    
    // Aggregate the data
    if (data && data.length > 0) {
      data.forEach(row => {
        tokenTypes.input += row.total_tokens_input || 0;
        tokenTypes.output += row.total_tokens_output || 0;
        tokenTypes.cacheRead += row.total_tokens_cache_read || 0;
        tokenTypes.cacheCreation += row.total_tokens_cache_creation || 0;
      });
    }
    
    res.json({ tokenTypes });
  } catch (error) {
    console.error('Error fetching historical token details:', error);
    res.status(500).json({ error: 'Failed to fetch historical token details' });
  }
});

// API endpoint to get token usage by model (live session)
app.get('/api/metrics/model-tokens', (req, res) => {
  // Calculate percentages
  const totalTokens = Object.values(tokensByModel).reduce((sum, val) => sum + val, 0);
  const modelData = Object.entries(tokensByModel).map(([model, tokens]) => ({
    model,
    tokens,
    percentage: totalTokens > 0 ? (tokens / totalTokens * 100).toFixed(1) : 0
  }));
  
  // Sort by tokens descending
  modelData.sort((a, b) => b.tokens - a.tokens);
  
  res.json({
    models: modelData,
    total: totalTokens
  });
});

// API endpoint to get historical token usage by model
app.get('/api/metrics/historical-model-tokens', async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const tokensByModel = {};
    
    // Calculate date range based on period
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date();
    
    if (period === 'daily') {
      // Get today's data
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'weekly') {
      startDate.setDate(startDate.getDate() - 6); // Last 7 days including today
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'monthly') {
      startDate.setFullYear(startDate.getFullYear(), startDate.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
    }
    
    // Fetch token metrics with model info from metrics table
    const { data, error } = await supabase
      .from('metrics')
      .select('metric_value, model')
      .eq('metric_name', 'claude_code.token.usage')
      .not('model', 'is', null)
      .gte('time', startDate.toISOString())
      .lte('time', endDate.toISOString());
    
    if (!error && data) {
      // Aggregate by model
      data.forEach(row => {
        if (row.model) {
          tokensByModel[row.model] = (tokensByModel[row.model] || 0) + (row.metric_value || 0);
        }
      });
    }
    
    // Calculate percentages and format response
    const totalTokens = Object.values(tokensByModel).reduce((sum, val) => sum + val, 0);
    const modelData = Object.entries(tokensByModel).map(([model, tokens]) => ({
      model,
      tokens,
      percentage: totalTokens > 0 ? (tokens / totalTokens * 100).toFixed(1) : 0
    }));
    
    // Sort by tokens descending
    modelData.sort((a, b) => b.tokens - a.tokens);
    
    res.json({
      models: modelData,
      total: totalTokens,
      period
    });
  } catch (error) {
    console.error('Error fetching historical model tokens:', error);
    res.status(500).json({ error: 'Failed to fetch historical model tokens' });
  }
});

// API endpoint to get available sessions
app.get('/api/sessions', async (req, res) => {
  try {
    // Get active sessions from in-memory tracking
    const activeSessInfo = Array.from(activeSessions.entries()).map(([sessionId, lastSeen]) => ({
      sessionId,
      lastSeen: new Date(lastSeen).toISOString(),
      isActive: true
    }));
    
    // Also get recent sessions from Supabase
    const { data: recentSessions, error } = await supabase
      .from('session_metrics')
      .select('session_id, user_email, last_updated, models_used')
      .order('last_updated', { ascending: false })
      .limit(20);
    
    if (error) {
      console.error('Error fetching sessions:', error);
      return res.status(500).json({ error: 'Failed to fetch sessions' });
    }
    
    // Combine and deduplicate sessions
    const sessionMap = new Map();
    
    // Add active sessions
    activeSessInfo.forEach(session => {
      sessionMap.set(session.sessionId, session);
    });
    
    // Add recent sessions from DB
    if (recentSessions) {
      recentSessions.forEach(session => {
        if (!sessionMap.has(session.session_id)) {
          sessionMap.set(session.session_id, {
            sessionId: session.session_id,
            userEmail: session.user_email,
            lastUpdated: session.last_updated,
            modelsUsed: session.models_used,
            isActive: activeSessions.has(session.session_id)
          });
        } else {
          // Enrich active session with DB data
          const existing = sessionMap.get(session.session_id);
          existing.userEmail = session.user_email;
          existing.modelsUsed = session.models_used;
        }
      });
    }
    
    const sessions = Array.from(sessionMap.values());
    res.json({ sessions });
  } catch (error) {
    console.error('Error in /api/sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get metrics filtered by session ID
app.get('/api/metrics/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Get session metrics from Supabase
    const { data: sessionData, error: sessionError } = await supabase
      .from('session_metrics')
      .select('*')
      .eq('session_id', sessionId)
      .single();
    
    if (sessionError && sessionError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching session metrics:', sessionError);
      return res.status(500).json({ error: 'Failed to fetch session metrics' });
    }
    
    // Get raw metrics for this session
    const { data: rawMetrics, error: metricsError } = await supabase
      .from('metrics')
      .select('metric_name, metric_value, time, token_type, lines_type, model')
      .eq('session_id', sessionId)
      .order('time', { ascending: true });
    
    if (metricsError) {
      console.error('Error fetching raw metrics:', metricsError);
      return res.status(500).json({ error: 'Failed to fetch raw metrics' });
    }
    
    // Process metrics for frontend
    const processedMetrics = {
      cost: [],
      tokens: [],
      lines: [],
      tokensByType: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      linesByType: { added: 0, removed: 0 },
      tokensByModel: {}
    };
    
    if (rawMetrics) {
      rawMetrics.forEach(metric => {
        const timestamp = metric.time;
        const value = metric.metric_value;
        
        switch (metric.metric_name) {
          case 'claude_code.cost.usage':
            processedMetrics.cost.push({ timestamp, value });
            break;
          case 'claude_code.token.usage':
            processedMetrics.tokens.push({ timestamp, value });
            if (metric.token_type) {
              processedMetrics.tokensByType[metric.token_type] = 
                (processedMetrics.tokensByType[metric.token_type] || 0) + value;
            }
            if (metric.model) {
              processedMetrics.tokensByModel[metric.model] = 
                (processedMetrics.tokensByModel[metric.model] || 0) + value;
            }
            break;
          case 'claude_code.lines_of_code.count':
            processedMetrics.lines.push({ timestamp, value, type: metric.lines_type });
            if (metric.lines_type) {
              processedMetrics.linesByType[metric.lines_type] = 
                (processedMetrics.linesByType[metric.lines_type] || 0) + value;
            }
            break;
        }
      });
    }
    
    res.json({
      sessionId,
      sessionMetrics: sessionData || {},
      metrics: processedMetrics,
      isActive: activeSessions.has(sessionId)
    });
  } catch (error) {
    console.error('Error in /api/metrics/session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current metrics with cumulative data and logs on connection
  const initData = { 
    metrics, 
    cumulative, 
    logs, 
    tokensByModel,
    activeSessionCount: activeSessions.size 
  };
  socket.emit('metrics-init', initData);
  
  // Also send current session count as a metric update
  socket.emit('metric-update', {
    name: 'claude_code.session.count',
    dataPoint: {
      timestamp: new Date().toISOString(),
      value: activeSessions.size
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

// Initialize cumulative values from database on startup
async function initializeCumulativeValues() {
  try {
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Fetch today's metrics
    const { data: todayMetrics, error } = await supabase
      .from('metrics')
      .select('metric_name, metric_value, lines_type')
      .in('metric_name', ['claude_code.cost.usage', 'claude_code.token.usage', 'claude_code.lines_of_code.count'])
      .gte('time', today.toISOString())
      .lt('time', tomorrow.toISOString());
    
    if (!error && todayMetrics) {
      // Process metrics to update cumulative values
      todayMetrics.forEach(row => {
        const metricName = row.metric_name;
        const value = row.metric_value || 0;
        
        if (cumulative[metricName]) {
          cumulative[metricName].total += value;
          cumulative[metricName].count += 1;
          cumulative[metricName].average = cumulative[metricName].total / cumulative[metricName].count;
          
          // Handle lines of code types
          if (metricName === 'claude_code.lines_of_code.count' && row.lines_type) {
            if (row.lines_type === 'added') {
              cumulative[metricName].added += value;
            } else if (row.lines_type === 'removed') {
              cumulative[metricName].removed += value;
            }
          }
        }
      });
      
      console.log('Initialized cumulative values from database:', {
        cost: cumulative['claude_code.cost.usage'].total,
        tokens: cumulative['claude_code.token.usage'].total,
        lines: cumulative['claude_code.lines_of_code.count'].total
      });
    }
  } catch (error) {
    console.error('Error initializing cumulative values:', error);
  }
}

// Start server
server.listen(PORT, async () => {
  console.log(`Claude Watch OTEL Exporter running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`OTLP metrics endpoint: http://localhost:${PORT}/v1/metrics`);
  console.log(`OTLP logs endpoint: http://localhost:${PORT}/v1/logs`);
  
  // Initialize cumulative values from database
  await initializeCumulativeValues();
});