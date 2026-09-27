const api = window.anyloader;
const $ = selector => document.querySelector(selector);
const icons = {
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  library: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 2h8M8 10h8M8 14h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
  music: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m7 4 14 8-14 8Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  retry: '<path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.download}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeImage = url => { try { return new URL(url).protocol === 'https:' ? esc(url) : ''; } catch { return ''; } };
const bytes = n => !n ? '0 B' : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const duration = n => n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m` : `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
let state, page = 'download', mode = 'video', busy = false, toastTimer, previewRequest = 0;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); }
function errorMessage(e) { return e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
function showError(e) { $('#link-error').textContent = errorMessage(e); $('#link-error').hidden = false; }
function navigate(next) {
  page = next;
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${page}`; });
  document.querySelectorAll('[data-page]').forEach(el => { el.classList.toggle('active', el.dataset.page === page); el.setAttribute('aria-current', el.dataset.page === page ? 'page' : 'false'); });
  if (page === 'download') $('#url').focus();
  render();
}
function setMode(next) {
  mode = next;
  document.querySelectorAll('[data-mode]').forEach(el => { el.classList.toggle('selected', el.dataset.mode === mode); el.setAttribute('aria-pressed', String(el.dataset.mode === mode)); });
  $('#quality').hidden = mode === 'audio'; $('#audio-format').hidden = mode !== 'audio';
  $('#quality-label').textContent = mode === 'audio' ? 'FORMAT' : 'QUALITY'; updateHint();
}
function updateHint() { $('#format-hint').textContent = mode === 'audio' ? ($('#audio-format').value === 'best' ? 'Just the soundtrack. Original audio.' : 'Audio converted from the best source.') : (state?.settings.defaultOptions.container === 'mp4' ? 'Compatible MP4 · codec availability varies.' : 'Original quality. No compromises.'); }
function options() { return { mode, quality: $('#quality').value, audioFormat: $('#audio-format').value, container: state.settings.defaultOptions.container }; }
function empty(library = false) { return `<div class="empty-state ${library ? 'library-empty' : ''}"><div class="empty-graphic">${icon(library ? 'library' : 'download')}</div><div><h3>${library ? 'Your collection starts here.' : 'Your next favorite belongs here.'}</h3><p>${library ? 'Saved videos and soundtracks will appear in your library.' : 'Paste a link above. We’ll take it from there.'}</p></div></div>`; }
function action(id, type, label, symbol) { return `<button class="icon-button" data-id="${esc(id)}" data-action="${type}" title="${label}" aria-label="${label}">${icon(symbol)}</button>`; }
function jobRow(j) {
  const active = j.status === 'downloading', done = j.status === 'completed';
  const status = { queued: 'In queue', downloading: j.stage || 'Downloading', completed: 'Saved', paused: 'Paused', cancelled: 'Cancelled', failed: 'Needs attention' }[j.status] || j.status;
  const savedExtension = done && j.file ? j.file.split('.').pop().toUpperCase() : '';
  const format = j.options.mode === 'audio' ? (savedExtension || (j.options.audioFormat === 'best' ? 'ORIGINAL AUDIO' : j.options.audioFormat.toUpperCase())) : (j.options.quality === 'best' ? 'BEST' : `${j.options.quality}p`) + ' · ' + (savedExtension || j.options.container.toUpperCase());
  let actions = '';
  if (active || j.status === 'queued') actions += action(j.id, 'pause', 'Pause download', 'pause') + action(j.id, 'cancel', 'Cancel download', 'close');
  else if (done) actions += action(j.id, 'open', 'Play file', 'play') + action(j.id, 'reveal', 'Show in Finder', 'folder') + action(j.id, 'remove', 'Remove from history', 'close');
  else actions += action(j.id, 'retry', j.status === 'paused' ? 'Resume download' : 'Retry download', j.status === 'paused' ? 'play' : 'retry') + action(j.id, 'remove', 'Remove from history', 'close');
  return `<article class="job">${safeImage(j.thumbnail) ? `<img class="job-thumb" src="${safeImage(j.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="job-thumb job-placeholder">${icon(j.options.mode === 'audio' ? 'music' : 'video')}</div>`}<div class="job-content"><h3 class="job-title" title="${esc(j.title)}">${esc(j.title)}</h3><div class="job-meta"><span>${esc(j.platform)}</span><span>${esc(format)}</span><span class="status-${esc(j.status)}">${esc(status)}</span>${active ? `<span>${Math.round(j.progress)}%${j.speed ? ` · ${bytes(j.speed)}/s` : ''}${j.eta ? ` · ${duration(j.eta)} left` : ''}</span>` : done ? `<span>${bytes(j.size)}</span>` : ''}</div>${active ? `<div class="progress"><progress max="100" value="${Number(j.progress) || 0}" aria-label="Download progress"></progress></div>` : ''}${j.error ? `<p class="job-error">${esc(j.error)}</p>` : ''}</div><div class="job-actions">${actions}</div></article>`;
}
function render() {
  if (!state) return;
  const jobs = state.jobs;
  const active = jobs.filter(j => ['queued', 'downloading', 'paused'].includes(j.status));
  const recent = [...active, ...jobs.filter(j => !active.includes(j)).slice(0, Math.max(0, 2 - active.length))];
  $('#queue-count').textContent = String(active.length).padStart(2, '0');
  $('#queue-status').textContent = jobs.some(j => j.status === 'downloading') ? 'GOOD THINGS INCOMING' : 'READY WHEN YOU ARE';
  $('#queue').innerHTML = recent.length ? recent.map(jobRow).join('') : empty();
  $('#library-count').textContent = jobs.filter(j => j.status === 'completed').length;
  const query = $('#search').value.toLowerCase(), filter = $('#library-filter').value;
  const filtered = jobs.filter(j => (j.title + ' ' + j.author + ' ' + j.platform).toLowerCase().includes(query) && (filter === 'all' || (filter === 'failed' ? j.status === 'failed' : j.options.mode === filter)));
  $('#library-list').innerHTML = filtered.length ? filtered.map(jobRow).join('') : jobs.length ? '<div class="empty-state library-empty"><div><h3>No matches this time.</h3><p>Try a different search or filter.</p></div></div>' : empty(true);
  $('#engine-status').textContent = state.engine ? 'Engine ready' : 'Setup required';
  $('#app-version').textContent = `v${state.version}`;
  $('#folder-path').textContent = state.settings.folder.replace(/^\/Users\/[^/]+\//, '').replaceAll('/', ' / ');
  $('#settings-folder').textContent = state.settings.folder;
  $('#about-version').textContent = state.version;
  $('#engine-version').textContent = `POWERED BY YT-DLP ${state.toolVersion} + FFMPEG + DENO`;
  document.body.classList.toggle('busy', jobs.some(j => j.status === 'downloading'));
  if (page === 'settings') { $('#container').value = state.settings.defaultOptions.container; $('#concurrent').value = state.settings.concurrent; $('#notifications').checked = state.settings.notifications; $('#cookies').value = state.settings.cookies; }
  updateHint();
}
function setBusy(value, label = 'Checking link…') { busy = value; $('#download-button').disabled = value; $('#inspect').disabled = value; $('#download-label').textContent = value ? label : 'Download'; }
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('#audio-format').addEventListener('change', updateHint);
$('#paste').addEventListener('click', async () => { try { $('#url').value = (await api.clipboard()).trim(); $('#url').dispatchEvent(new Event('input')); $('#url').focus(); } catch (e) { toast(errorMessage(e)); } });
$('#url').addEventListener('input', () => { previewRequest++; $('#preview').hidden = true; $('#link-error').hidden = true; });
$('#inspect').addEventListener('click', async () => {
  if (busy) return;
  const request = ++previewRequest;
  setBusy(true); $('#link-error').hidden = true;
  try { const info = await api.inspect($('#url').value); if (request !== previewRequest) return;
    $('#preview').innerHTML = `<div class="preview-content">${safeImage(info.thumbnail) ? `<img src="${safeImage(info.thumbnail)}" alt="" referrerpolicy="no-referrer">` : ''}<div><h3>${esc(info.title)}</h3><p>${esc(info.platform)} · ${esc(info.author)} · ${duration(info.duration)}${info.qualities.length ? ` · up to ${Math.max(...info.qualities)}p` : ''}</p></div></div>`; $('#preview').hidden = false;
  } catch (e) { if (request === previewRequest) showError(e); } finally { setBusy(false); }
});
$('#download-form').addEventListener('submit', async e => {
  e.preventDefault(); if (busy) return;
  const url = $('#url').value, selectedOptions = options();
  setBusy(true); $('#link-error').hidden = true;
  try { await api.enqueue(url, selectedOptions); if ($('#url').value === url) { $('#url').value = ''; $('#preview').hidden = true; } toast('Added to your queue. Good things incoming.'); }
  catch (e) { showError(e); } finally { setBusy(false); }
});
document.addEventListener('click', async e => { const button = e.target.closest('[data-action]'); if (!button) return; button.disabled = true; try { await api.action(button.dataset.id, button.dataset.action); } catch (error) { toast(errorMessage(error)); } finally { button.disabled = false; } });
async function chooseFolder() { try { state = await api.chooseFolder(); render(); } catch (e) { toast(errorMessage(e)); } }
$('#destination').addEventListener('click', chooseFolder); $('#settings-choose-folder').addEventListener('click', chooseFolder);
$('#sidebar-folder').addEventListener('click', async () => { try { await api.openFolder(); } catch (e) { toast(errorMessage(e)); } });
$('#view-library').addEventListener('click', () => navigate('library'));
$('#search').addEventListener('input', render); $('#library-filter').addEventListener('change', render);
$('#clear-history').addEventListener('click', async () => { try { state = await api.clearHistory(); render(); } catch (e) { toast(errorMessage(e)); } });
for (const id of ['container', 'concurrent', 'notifications', 'cookies']) $(`#${id}`).addEventListener('change', async () => {
  try { state = await api.settings({ concurrent: Number($('#concurrent').value), notifications: $('#notifications').checked, cookies: $('#cookies').value, defaultOptions: { ...state.settings.defaultOptions, container: $('#container').value } }); render(); toast('Preferences saved.'); } catch (e) { toast(errorMessage(e)); }
});
api.onState(next => { state = next; render(); }); api.onNavigate(navigate);
api.state().then(next => { state = next; $('#quality').value = state.settings.defaultOptions.quality; $('#audio-format').value = state.settings.defaultOptions.audioFormat; setMode(state.settings.defaultOptions.mode); render(); }).catch(e => toast(errorMessage(e)));
