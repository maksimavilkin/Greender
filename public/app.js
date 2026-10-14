const API = '/api';
let token = localStorage.getItem('zz_token') || '';
let currentUser = null;
let events = [];
let swipeEvents = [];
let swipeIndex = 0;
let openedEventId = null;
let profile = null;

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '');
const headers = () => token ? { Authorization: `Bearer ${token}` } : {};

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...headers(),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) {
      token = '';
      currentUser = null;
      localStorage.removeItem('zz_token');
    }
    throw new Error(payload.error || 'Не удалось выполнить запрос.');
  }
  return payload;
}

function showMessage(id, message, success = false) {
  const node = $(id);
  if (!node) return;
  node.textContent = message || '';
  node.style.color = success ? '#27633b' : '#b42318';
}
function requireLogin() {
  if (token && currentUser) return true;
  alert('Для этого действия войдите или зарегистрируйтесь.');
  goToScreen('view-login');
  return false;
}
function dateLabel(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }).format(d);
}
function peopleLabel(event) {
  const joined = Number(event.joined_count || 0);
  const total = Number(event.volunteers_needed || 1);
  return `Свободно ${Math.max(0, total - joined)} из ${total}`;
}
function iconFor(category) {
  const name = String(category || '').toLowerCase();
  if (name.includes('живот')) return 'fa-solid fa-paw';
  if (name.includes('дет')) return 'fa-solid fa-book';
  if (name.includes('люд')) return 'fa-solid fa-hands-holding-circle';
  if (name.includes('эколог')) return 'fa-solid fa-tree';
  return 'fa-solid fa-seedling';
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function eventCard(event, compact = false) {
  const card = element('div', 'mini-card');
  card.dataset.eventId = event.id;
  card.addEventListener('click', () => openDetailsModal(event.id));
  const iconHeader = element('div', 'mini-card-icon-header');
  const icon = element('i', iconFor(event.category_name));
  iconHeader.append(icon);
  const body = element('div', 'mini-card-body');
  body.append(element('h4', '', event.title));
  body.append(element('p', '', `📍 ${event.location}`));
  body.append(element('p', '', `🕒 ${dateLabel(event.starts_at)}`));
  if (!compact) body.append(element('p', '', event.category_name || 'Другое'));
  card.append(iconHeader, body);
  return card;
}
function responseCard(event, isCreated = false) {
  const card = element('div', 'event-row-card');
  const iconWrap = element('div', `icon-round-leaf${isCreated ? ' user-created-icon' : ''}`);
  iconWrap.append(element('i', iconFor(event.category_name)));
  const info = element('div', 'event-row-info');
  info.append(element('h3', '', event.title));
  info.append(element('p', '', `${event.location} · ${dateLabel(event.starts_at)}`));
  card.append(iconWrap, info);
  if (isCreated) {
    card.append(element('span', 'status-pill', event.status === 'cancelled' ? 'Отменена' : 'Активна'));
    if (event.status === 'published') {
      const cancel = element('button', 'delete-icon-btn', '×');
      cancel.type = 'button';
      cancel.title = 'Отменить заявку';
      cancel.addEventListener('click', async () => {
        if (!confirm('Отменить эту заявку?')) return;
        try {
          await api(`/profile/events/${event.id}`, { method: 'DELETE' });
          await loadProfile();
        } catch (e) { alert(e.message); }
      });
      card.append(cancel);
    }
  } else {
    const actions = element('div', 'event-row-actions');
    const cancel = element('button', 'delete-icon-btn', '×');
    cancel.type = 'button';
    cancel.title = 'Отменить запись';
    cancel.addEventListener('click', async () => {
      try {
        await api(`/events/${event.id}/join`, { method: 'DELETE' });
        await loadProfile();
      } catch (e) { alert(e.message); }
    });
    actions.append(cancel);
    card.append(actions);
  }
  return card;
}
function renderCards(containerId, list, compact = false, emptyText = 'Пока ничего нет.') {
  const container = $(containerId);
  if (!container) return;
  container.replaceChildren();
  if (!list.length) {
    container.append(element('p', 'api-empty', emptyText));
    return;
  }
  list.forEach(event => container.append(eventCard(event, compact)));
}
function currentCity() {
  return $('current-city')?.textContent?.trim() || currentUser?.city || 'Москва';
}
function setCity(name) {
  $('current-city').textContent = name;
  $('city-dropdown').style.display = 'none';
  loadEvents();
}
function selectCity(name) { setCity(name); }
function toggleCityDropdown() {
  const menu = $('city-dropdown');
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}
function goToScreen(screenId) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  $(screenId)?.classList.add('active');
  $('app-header').style.display = 'none';
  $('app-footer').style.display = 'none';
}
function goToMainApp() {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  $('view-feed').classList.add('active');
  $('app-header').style.display = 'flex';
  $('app-footer').style.display = 'flex';
  switchTab('feed');
  loadEvents();
}
function switchTab(tabKey) {
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const map = { feed: ['tab-feed', 'view-feed'], swipes: ['tab-swipes', 'view-swipes'], request: ['tab-request', 'view-request'], responses: ['tab-responses', 'view-responses'] };
  if (!map[tabKey]) return;
  $(map[tabKey][0]).classList.add('active');
  $(map[tabKey][1]).classList.add('active');
  if (tabKey === 'swipes') loadSwipes();
  if (tabKey === 'responses') loadProfile();
}
function togglePassVisibility(id) {
  const input = $(id);
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}
async function registerUser() {
  showMessage('register-error', '');
  const contact = $('reg-contact').value.trim();
  const payload = {
    firstName: $('reg-name').value.trim(),
    lastName: $('reg-surname').value.trim(),
    patronymic: $('reg-patronymic').value.trim(),
    contact,
    password: $('reg-pass').value,
    city: currentCity()
  };
  try {
    const result = await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    token = result.token;
    currentUser = result.user;
    localStorage.setItem('zz_token', token);
    $('reg-success-box').style.display = 'block';
    await loadProfile();
    goToMainApp();
  } catch (e) {
    showMessage('register-error', e.message);
  }
}
async function loginUser() {
  showMessage('login-error', '');
  try {
    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: $('login-identifier').value.trim(),
        password: $('login-pass').value
      })
    });
    token = result.token;
    currentUser = result.user;
    localStorage.setItem('zz_token', token);
    goToMainApp();
    await loadProfile();
  } catch (e) {
    showMessage('login-error', e.message);
  }
}
async function loadEvents(search = '') {
  const params = new URLSearchParams();
  params.set('city', currentCity());
  const query = search || $('event-search')?.value?.trim();
  if (query) params.set('q', query);
  try {
    const result = await api(`/events?${params.toString()}`);
    events = result.events;
    renderCards('feed-events', events, true, 'По вашему запросу мероприятий не найдено.');
    renderCards('upcoming-events', events.slice(0, 6), true, 'Пока нет ближайших мероприятий.');
    // Keep the swipe deck aligned with the current city and filters.
    await loadSwipes(false);
  } catch (e) {
    $('feed-events')?.replaceChildren(element('p', 'api-empty', `Не удалось загрузить мероприятия: ${e.message}`));
  }
}
function searchEvents() { loadEvents($('event-search').value.trim()); }
async function loadSwipes(showErrors = true) {
  const params = new URLSearchParams();
  params.set('city', currentCity());
  const category = $('filter-category')?.value;
  const place = $('filter-place')?.value;
  const timeLabel = $('filter-time')?.value;
  if (category && category !== 'Все') params.set('category', category);
  if (place && place !== 'Все') params.set('place', place);
  if (timeLabel === 'Утро') params.set('time', 'morning');
  if (timeLabel === 'День') params.set('time', 'day');
  try {
    const result = await api(`/events?${params.toString()}`);
    swipeEvents = result.events;
    swipeIndex = 0;
    updateSwipeCard();
  } catch (e) {
    if (showErrors) alert(e.message);
  }
}
function updateSwipeCard() {
  if (swipeIndex < swipeEvents.length) {
    const event = swipeEvents[swipeIndex];
    $('swipe-card-container').style.display = 'block';
    $('swipe-done-box').style.display = 'none';
    $('banner-title').textContent = event.title;
    $('banner-place').textContent = event.location;
    $('banner-time').textContent = dateLabel(event.starts_at);
    $('banner-category').textContent = event.category_name || 'Другое';
    $('banner-needed').textContent = peopleLabel(event);
    $('swipe-counter').textContent = `${swipeIndex + 1} из ${swipeEvents.length}`;
    $('swipe-top-ico').className = iconFor(event.category_name);
  } else {
    $('swipe-card-container').style.display = 'none';
    $('swipe-done-box').style.display = 'block';
    $('done-stats-text').textContent = 'Вы просмотрели все мероприятия по выбранным фильтрам.';
  }
}
function dislikeCurrent() {
  if (swipeIndex < swipeEvents.length) { swipeIndex++; updateSwipeCard(); }
}
async function likeCurrent() {
  if (!requireLogin() || swipeIndex >= swipeEvents.length) return;
  const event = swipeEvents[swipeIndex];
  try {
    await api(`/events/${event.id}/favorite`, { method: 'PUT' });
    const profileResult = await api('/profile');
    $('like-badge').textContent = profileResult.favorites.length;
    swipeIndex++;
    updateSwipeCard();
  } catch (e) { alert(e.message); }
}
function restartSwipes() { swipeIndex = 0; updateSwipeCard(); }
async function openDetailsModal(id) {
  openedEventId = Number(id);
  try {
    const result = await api(`/events/${openedEventId}`);
    const event = result.event;
    $('modal-heading').textContent = event.title;
    $('modal-place').textContent = event.location;
    $('modal-time').textContent = dateLabel(event.starts_at);
    $('modal-direction').textContent = event.category_name;
    $('modal-people').textContent = peopleLabel(event);
    $('modal-desc').textContent = event.description;
    $('modal-action-btn').textContent = 'Откликнуться';
    $('details-popup').style.display = 'flex';
  } catch (e) { alert(e.message); }
}
function openCurrentDetails() {
  if (swipeIndex < swipeEvents.length) openDetailsModal(swipeEvents[swipeIndex].id);
}
function closeDetailsModal() { $('details-popup').style.display = 'none'; }
async function modalSubscribe() {
  if (!requireLogin() || !openedEventId) return;
  try {
    await api(`/events/${openedEventId}/join`, { method: 'POST', body: '{}' });
    $('modal-action-btn').textContent = 'Вы записаны ✓';
    await loadProfile();
    alert('Вы записаны на мероприятие!');
  } catch (e) { alert(e.message); }
}
async function openProfileModal() {
  if (!requireLogin()) return;
  try {
    profile = await api('/profile');
    $('profile-name').textContent = `${profile.user.firstName} ${profile.user.lastName}`;
    $('profile-contact').textContent = profile.user.email || profile.user.phone || '';
    const list = $('profile-likes-list');
    list.replaceChildren();
    if (!profile.favorites.length) list.textContent = 'Пока ничего нет. Нажмите «Нравится», чтобы сохранить мероприятие.';
    else profile.favorites.forEach(event => {
      const row = element('div', 'favorite-row');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.marginBottom = '8px';
      row.append(element('span', '', `${event.title} — ${event.location}`));
      const remove = element('button', 'delete-icon-btn', '×');
      remove.type = 'button';
      remove.title = 'Убрать из избранного';
      remove.addEventListener('click', async () => {
        try {
          await api(`/events/${event.id}/favorite`, { method: 'DELETE' });
          await openProfileModal();
        } catch (e) { alert(e.message); }
      });
      row.append(remove);
      list.append(row);
    });
    $('like-badge').textContent = profile.favorites.length;
    $('profile-popup').style.display = 'flex';
  } catch (e) { alert(e.message); }
}
function closeProfileModal() { $('profile-popup').style.display = 'none'; }
function goToResponsesFromProfile() { closeProfileModal(); switchTab('responses'); }
async function loadProfile() {
  if (!token) {
    $('my-responses-list')?.replaceChildren(element('p', 'api-empty', 'Войдите, чтобы увидеть свои отклики.'));
    $('created-requests-list')?.replaceChildren(element('p', 'api-empty', 'Войдите, чтобы увидеть созданные заявки.'));
    $('like-badge').textContent = '0';
    return;
  }
  try {
    profile = await api('/profile');
    currentUser = profile.user;
    $('my-responses-list').replaceChildren();
    if (!profile.participations.length) $('my-responses-list').append(element('p', 'api-empty', 'Вы пока не записались на мероприятия.'));
    else profile.participations.forEach(event => $('my-responses-list').append(responseCard(event)));
    $('created-requests-list').replaceChildren();
    if (!profile.created.length) $('created-requests-list').append(element('p', 'api-empty', 'Вы пока не создали заявок.'));
    else profile.created.forEach(event => $('created-requests-list').append(responseCard(event, true)));
    $('like-badge').textContent = profile.favorites.length;
  } catch (e) {
    $('my-responses-list')?.replaceChildren(element('p', 'api-empty', e.message));
  }
}
async function submitUserRequest() {
  if (!requireLogin()) return;
  const title = $('req-title').value.trim();
  const place = $('req-place').value.trim();
  const city = $('req-city').value.trim() || currentCity();
  const description = $('req-desc').value.trim();
  const date = $('req-date').value;
  const people = Number($('req-people').value);
  const category = $('req-category').value;
  if (!title || !place || !description || !date) {
    alert('Заполните название, место, описание и дату мероприятия.');
    return;
  }
  try {
    await api('/events', {
      method: 'POST',
      body: JSON.stringify({
        title, location: place, city, description, startsAt: new Date(date).toISOString(),
        volunteersNeeded: people, category
      })
    });
    $('req-title').value = '';
    $('req-desc').value = '';
    await loadEvents();
    await loadProfile();
    switchTab('responses');
    alert('Заявка создана и опубликована.');
  } catch (e) { alert(e.message); }
}
function completeRegistration() { registerUser(); }
function removeResponseCard() { /* Карточки управляются данными API; используйте кнопку отмены записи. */ }
function toggleCardStatus() { /* Статус записи изменяется сервером через API. */ }

async function boot() {
  try {
    const health = await api('/health');
    if (health.status !== 'ok') throw new Error('API недоступен');
    if (token) {
      try {
        const me = await api('/auth/me');
        currentUser = me.user;
      } catch (_) {
        token = '';
        localStorage.removeItem('zz_token');
      }
    }
    await loadEvents();
    await loadProfile();
  } catch (e) {
    $('feed-events')?.replaceChildren(element('p', 'api-empty', `Backend не подключён: ${e.message}. Проверьте запуск сервера и PostgreSQL.`));
  }
}
document.addEventListener('DOMContentLoaded', boot);
