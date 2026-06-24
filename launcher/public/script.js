const API = '';
const logsContainer = document.getElementById('logsContainer');
const servicesGrid = document.getElementById('servicesGrid');
const allStatus = document.getElementById('allStatus');
const btnRefresh = document.getElementById('btnRefresh');
const btnStartAll = document.getElementById('btnStartAll');
const btnStopAll = document.getElementById('btnStopAll');
const btnMigrate = document.getElementById('btnMigrate');
const btnLaunchBrowser = document.getElementById('btnLaunchBrowser');

let services = [];
let autoRefreshTimer = null;

function log(msg, type) {
  if (type === undefined) type = 'info';
  const div = document.createElement('div');
  div.className = 'log-line log-' + type;
  const time = new Date().toLocaleTimeString();
  div.innerHTML = '<span class="time">[' + time + ']</span> ' + msg;
  logsContainer.appendChild(div);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

async function fetchJSON(url, opts) {
  if (opts === undefined) opts = {};
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
}

async function loadServices() {
  const data = await fetchJSON(API + '/api/services');
  services = data;
  renderServices();
  await checkAllStatus();
}

function renderServices() {
  servicesGrid.innerHTML = '';
  services.forEach(function(svc) {
    const card = document.createElement('div');
    card.className = 'service-card stopped';
    card.id = 'service-' + svc.id;
    card.innerHTML =
      '<div class="service-number">' + svc.id + '</div>' +
      '<span class="service-icon">' + svc.icon + '</span>' +
      '<div class="service-name">' + svc.name + '</div>' +
      '<div class="service-port">' + (svc.port ? 'Port ' + svc.port : '') + '</div>' +
      '<div class="status-indicator off" id="indicator-' + svc.id + '"></div>' +
      '<div class="service-actions">' +
        '<button class="btn btn-start" onclick="startService(' + svc.id + ')" id="start-' + svc.id + '">Start</button>' +
        '<button class="btn btn-stop" onclick="stopService(' + svc.id + ')" id="stop-' + svc.id + '" disabled>Stop</button>' +
      '</div>';
    servicesGrid.appendChild(card);
  });
}

async function checkAllStatus() {
  allStatus.textContent = 'Checking...';
  allStatus.className = 'status-badge checking';
  var allRunning = true;

  for (var i = 0; i < services.length; i++) {
    var svc = services[i];
    var indicator = document.getElementById('indicator-' + svc.id);
    var card = document.getElementById('service-' + svc.id);
    var startBtn = document.getElementById('start-' + svc.id);
    var stopBtn = document.getElementById('stop-' + svc.id);

    if (!indicator) continue;
    indicator.className = 'status-indicator checking';
    try {
      var res = await fetchJSON(API + '/api/services/' + svc.id + '/status');
      var running = res.running;
      indicator.className = 'status-indicator ' + (running ? 'on' : 'off');
      card.className = 'service-card ' + (running ? 'running' : 'stopped');
      startBtn.disabled = running;
      stopBtn.disabled = !running;
      if (!running) allRunning = false;
    } catch (e) {
      indicator.className = 'status-indicator off';
      card.className = 'service-card stopped';
      allRunning = false;
    }
  }

  if (allRunning) {
    allStatus.textContent = 'All Running';
    allStatus.className = 'status-badge online';
    btnLaunchBrowser.disabled = false;
  } else {
    var runningCount = document.querySelectorAll('.status-indicator.on').length;
    allStatus.textContent = runningCount + '/' + services.length + ' running';
    allStatus.className = 'status-badge offline';
    btnLaunchBrowser.disabled = true;
  }
}

async function startService(id) {
  var svc = services.find(function(s) { return s.id === id; });
  if (!svc) return;
  var startBtn = document.getElementById('start-' + id);
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';
  log('Starting ' + svc.name + '...', 'info');
  var res = await fetchJSON(API + '/api/services/' + id + '/start', { method: 'POST' });
  if (res.success) {
    log(svc.name + ' started', 'success');
  } else {
    log('Failed to start ' + svc.name + ': ' + (res.error || 'unknown'), 'error');
  }
  await checkAllStatus();
  startBtn.textContent = 'Start';
}

async function stopService(id) {
  var svc = services.find(function(s) { return s.id === id; });
  if (!svc) return;
  log('Stopping ' + svc.name + '...', 'warning');
  var res = await fetchJSON(API + '/api/services/' + id + '/stop', { method: 'POST' });
  if (res.success) {
    log(svc.name + ' stopped', 'info');
  } else {
    log('Failed to stop ' + svc.name + ': ' + (res.error || 'unknown'), 'error');
  }
  await checkAllStatus();
}

async function startAll() {
  log('Starting all Docker services in parallel...', 'info');
  btnStartAll.disabled = true;

  var dockerServices = services.filter(function(s) { return s.type === 'docker'; });
  var nodeServices = services.filter(function(s) { return s.type !== 'docker'; });

  var dockerPromises = dockerServices.map(function(svc) {
    return fetchJSON(API + '/api/services/' + svc.id + '/start', { method: 'POST' })
      .then(function(res) {
        if (res.success) log(svc.name + ' started', 'success');
        else log('Failed: ' + svc.name + ' - ' + (res.error || 'unknown'), 'error');
      });
  });
  await Promise.all(dockerPromises);
  await new Promise(function(r) { setTimeout(r, 3000); });

  for (var i = 0; i < nodeServices.length; i++) {
    await startService(nodeServices[i].id);
    await new Promise(function(r) { setTimeout(r, 2000); });
  }

  await checkAllStatus();
  btnStartAll.disabled = false;
  if (!btnLaunchBrowser.disabled) {
    log('All services ready!', 'success');
  }
}

async function stopAll() {
  log('Stopping all services...', 'warning');
  for (var i = services.length - 1; i >= 0; i--) {
    await stopService(services[i].id);
  }
  await checkAllStatus();
}

async function runMigration() {
  log('Running database migration...', 'info');
  btnMigrate.disabled = true;
  btnMigrate.textContent = 'Migrating...';
  var res = await fetchJSON(API + '/api/run-migration', { method: 'POST' });
  if (res.success) {
    log('Database migration completed', 'success');
  } else {
    log('Migration failed: ' + (res.error || 'unknown'), 'error');
  }
  btnMigrate.disabled = false;
  btnMigrate.textContent = 'Run Migration';
}

btnRefresh.addEventListener('click', checkAllStatus);
btnStartAll.addEventListener('click', startAll);
btnStopAll.addEventListener('click', stopAll);
btnMigrate.addEventListener('click', runMigration);
btnLaunchBrowser.addEventListener('click', function() {
  window.open('http://localhost:3000', '_blank');
  log('Dashboard opened in browser', 'success');
});

document.getElementById('btnClearLogs').addEventListener('click', function() {
  logsContainer.innerHTML = '';
  log('Logs cleared', 'info');
});

autoRefreshTimer = setInterval(checkAllStatus, 5000);

log('Connecting to Launcher...', 'info');
loadServices().then(function() {
  log('Loaded ' + services.length + ' services', 'success');
  log('Auto-refresh every 5s', 'info');
}).catch(function(err) {
  log('Connection failed: ' + err.message, 'error');
});
