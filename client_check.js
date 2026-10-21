
    const API_URL = '/api';
    const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const authHeaders = () => ({'Content-Type':'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('authToken') || '')});
    let itemsData = [];
    let locations = {};
    let selectedCity = localStorage.getItem('selectedCity') || 'Москва';
    const visibleEvents = () => itemsData.filter(item => item.city === selectedCity && (!document.getElementById('swipe-district')?.value || item.district === document.getElementById('swipe-district').value));
    function fillSelect(id, values, allLabel) {
      const select=document.getElementById(id); if(!select)return;
      const old=select.value;select.replaceChildren();
      if(allLabel){const o=new Option(allLabel,'');select.add(o)}
      values.forEach(v=>select.add(new Option(v,v)));
      if(values.includes(old))select.value=old;
    }
    function populateDistrict(id, city) {
      const isRequest=id==='req-district';
      fillSelect(id, [...(locations[city]||[]), ...(isRequest?['Другой район']:[])], isRequest?null:'Все районы');
      if(isRequest)toggleCustomDistrict();
    }
    function toggleCustomDistrict(){document.getElementById('req-custom-district').style.display=document.getElementById('req-district').value==='Другой район'?'block':'none'}
    function syncLocationUI(){
      document.getElementById('current-city').textContent=selectedCity;
      fillSelect('req-city',Object.keys(locations));
      document.getElementById('req-city').value=selectedCity;
      populateDistrict('req-district',selectedCity);
      populateDistrict('feed-district',selectedCity);
      populateDistrict('swipe-district',selectedCity);
    }
    function resetSwipes(){swipeIndex=0;updateSwipeCard()}

    let swipeIndex = 0;
    let currentOpenedIndex = 0;
    let likedCards = [];
    let subscribedSet = {};
    let currentUserId = localStorage.getItem('authToken') ? localStorage.getItem('userId') : null;

    window.onload = async () => {
        // Clear registration fields after reload, including browser-restored values.
        document.querySelectorAll('#view-register input[data-clear-on-register]').forEach(input => input.value = '');
        try { locations=await (await fetch('/locations.json')).json(); } catch(e){console.error('Не удалось загрузить районы',e)}
        if(!locations[selectedCity]) selectedCity='Москва';
        syncLocationUI();
        const search = document.getElementById('event-search');
        if(search) search.addEventListener('input', applyEventSearch);
        await loadEventsFromAPI();
        if(currentUserId) { try { const r=await fetch(`${API_URL}/me`,{headers:authHeaders()}); if(!r.ok) {currentUserId=null;localStorage.removeItem('authToken');localStorage.removeItem('userId');} } catch(e) {console.warn(e);} }
    };

    async function loadEventsFromAPI() {
        try {
            const res = await fetch(`${API_URL}/events`);
            const data = await res.json();
            if(data.success && data.data.length > 0) {
                itemsData = data.data;
                renderFeed();
                resetSwipes();
            }
        } catch (e) {
            console.error('Ошибка соединения с бэкендом:', e);
            document.getElementById('banner-title').innerText = 'Ошибка загрузки с сервера';
        }
    }

    function applyEventSearch() { renderFeed(); }

    function renderFeed() {
        const feedGrid = document.getElementById('feed-grid');
        const horizScroll = document.getElementById('horizontal-feed-scroll');
        feedGrid.innerHTML = '';
        horizScroll.innerHTML = '';

        const query = (document.getElementById('event-search')?.value || '').trim().toLocaleLowerCase('ru');
        const district=document.getElementById('feed-district').value;
        const cityItems=itemsData.map((item,index)=>({item,index})).filter(({item})=>item.city===selectedCity);
        const matching = cityItems.filter(({item}) => (!district || item.district===district) && [item.title,item.place,item.description,item.direction,item.district].some(v=>String(v||'').toLocaleLowerCase('ru').includes(query)));
        document.getElementById('event-count').textContent = `${matching.length} из ${cityItems.length} в городе ${selectedCity}`;
        document.getElementById('search-empty').hidden = matching.length !== 0;
        matching.forEach(({item,index}) => {
            const html = `
                <div class="mini-card" onclick="openDetailsModal(${index})">
                  <div class="mini-card-icon-header">
                    <i class="${item.icon || 'fa-solid fa-leaf'}"></i>
                  </div>
                  <div class="mini-card-body">
                    <h4>${escapeHTML(item.title)}</h4>
                    <p><i class="fa-solid fa-location-dot"></i> ${escapeHTML(item.district || '')}, ${escapeHTML(item.place)}</p>
                    <p><i class="fa-regular fa-clock"></i> ${escapeHTML(item.time)}</p>
                  </div>
                </div>
            `;
            feedGrid.innerHTML += html;
            if(index > 2) horizScroll.innerHTML += html;
        });
    }

    async function loginUser() {
        const contact = document.getElementById('login-contact').value;
        const password = document.getElementById('login-pass').value;
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact, password })
            });
            const data = await res.json();
            if(res.ok) {
                currentUserId = data.user.id;
                localStorage.setItem('userId', currentUserId);
                localStorage.setItem('authToken', data.token);
                goToMainApp();
            } else {
                alert('Ошибка: ' + data.error);
            }
        } catch (e) { console.error(e); }
    }

    async function completeRegistration() {
        const field = id => document.getElementById(id).value.trim();
        const name = field('reg-name');
        const surname = field('reg-surname');
        const patronymic = field('reg-patronymic');
        const contact = field('reg-contact');
        const password = document.getElementById('reg-pass').value;
        const button = document.getElementById('register-submit');
        const errorBox = document.getElementById('reg-error');
        const showError = message => { errorBox.textContent = message; errorBox.style.display = 'block'; };
        errorBox.textContent = '';
        errorBox.style.display = 'none';
        if (!name || !surname || contact.length < 3 || password.length < 8) {
            showError('Заполните имя, фамилию, телефон или почту и пароль от 8 символов.');
            return;
        }
        button.disabled = true;
        button.textContent = 'Создаём аккаунт...';
        try {
            const res = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, surname, patronymic, contact, password })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showError(data.error || `Ошибка регистрации (HTTP ${res.status}).`);
                return;
            }
            if (!data.token || !data.userId) {
                showError('Сервер вернул неполный ответ. Проверьте настройки сервера.');
                return;
            }
            currentUserId = data.userId;
            localStorage.setItem('userId', String(data.userId));
            localStorage.setItem('authToken', data.token);
            document.getElementById('reg-success-box').style.display = 'block';
            goToMainApp();
        } catch (error) {
            console.error('Ошибка регистрации:', error);
            showError('Нет соединения с сервером. Проверьте, что Node.js запущен, и обновите страницу.');
        } finally {
            button.disabled = false;
            button.textContent = 'Зарегистрироваться';
        }
    }

    function goToMainAppGuest() {
        goToMainApp();
    }

    function goToMainApp() {
        document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
        document.getElementById('view-feed').classList.add('active');
        document.getElementById('app-header').style.display = 'flex';
        document.getElementById('app-footer').style.display = 'flex';
        switchTab('feed');
        if(currentUserId) loadUserResponses();
    }

    function goToScreen(screenId) {
        if (screenId === 'view-register') {
            document.querySelectorAll('#view-register input[data-clear-on-register]').forEach(input => {
                input.value = '';
                input.defaultValue = '';
            });
            const success = document.getElementById('reg-success-box');
            if (success) success.style.display = 'none';
        }
        document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(screenId);
        if (target) target.classList.add('active');
        document.getElementById('app-header').style.display = 'none';
        document.getElementById('app-footer').style.display = 'none';
    }

    function switchTab(tabKey) {
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));

        if (tabKey === 'feed') {
            document.getElementById('tab-feed').classList.add('active');
            document.getElementById('view-feed').classList.add('active');
        } else if (tabKey === 'swipes') {
            document.getElementById('tab-swipes').classList.add('active');
            document.getElementById('view-swipes').classList.add('active');
            updateSwipeCard();
        } else if (tabKey === 'request') {
            document.getElementById('tab-request').classList.add('active');
            document.getElementById('view-request').classList.add('active');
        } else if (tabKey === 'responses') {
            document.getElementById('tab-responses').classList.add('active');
            document.getElementById('view-responses').classList.add('active');
            loadUserResponses();
        }
    }

    async function submitUserRequest() {
        if(!currentUserId) { alert('Для создания мероприятия войдите в аккаунт'); return; }
        const title = document.getElementById('req-title').value || 'Новая помощь';
        const city = document.getElementById('req-city').value;
        const selectedDistrict=document.getElementById('req-district').value;
        const district = selectedDistrict==='Другой район' ? document.getElementById('req-custom-district').value.trim() : selectedDistrict;
        if(!district){alert('Укажите район');return}
        const place = district;
        const people = document.getElementById('req-people').value;
        const description = document.getElementById('req-desc').value;

        try {
            const res = await fetch(`${API_URL}/events`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    title, place, city, district, time: 'По договоренности', 
                    direction: 'Новая заявка', people, description, 
                    icon: 'fa-solid fa-hands-holding-circle', 
                    creator_id: currentUserId
                })
            });
            if(res.ok) {
                selectCity(city);
                await loadEventsFromAPI(); // Перезагружаем события
                
                document.getElementById('req-title').value = '';
                document.getElementById('req-desc').value = '';
                await loadCreatedRequests();
                switchTab('responses');
            } else {const data=await res.json().catch(()=>({}));alert(data.error||'Не удалось создать заявку')}
        } catch(e) { console.error(e);alert('Нет связи с сервером'); }
    }

    async function loadCreatedRequests() {
        const list = document.getElementById('created-requests-list');
        if (!currentUserId) { list.textContent = 'Войдите в аккаунт, чтобы увидеть свои заявки'; return; }
        list.textContent = 'Загружаем ваши заявки...';
        try {
            const response = await fetch(`${API_URL}/my/events`, {headers: authHeaders()});
            if (!response.ok) throw new Error('Не удалось получить заявки');
            const result = await response.json();
            list.replaceChildren();
            if (!result.data.length) { list.textContent = 'Вы пока не создавали заявки'; return; }
            result.data.forEach(item => {
                const card = document.createElement('div');
                card.className = 'event-row-card';
                card.innerHTML = `<div class="icon-round-leaf user-created-icon"><i class="fa-solid fa-leaf"></i></div><div class="event-row-info"><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.place)} · Нужно: ${escapeHTML(item.people)}</p></div>`;
                const remove = document.createElement('button');
                remove.className = 'btn-outline-green';
                remove.textContent = 'Удалить';
                remove.addEventListener('click', async () => {
                    if (!confirm('Удалить эту заявку и все отклики на неё?')) return;
                    const r = await fetch(`${API_URL}/my/events/${item.id}`, {method:'DELETE',headers:authHeaders()});
                    if (!r.ok) { alert('Не удалось удалить заявку'); return; }
                    await loadEventsFromAPI();
                    await loadCreatedRequests();
                });
                card.append(remove);
                list.append(card);
            });
        } catch (error) { list.textContent = 'Ошибка загрузки ваших заявок'; console.error(error); }
    }

    function togglePassVisibility(inputId) {
        var input = document.getElementById(inputId);
        input.type = input.type === 'password' ? 'text' : 'password';
    }

    function toggleCityDropdown() {
        var menu = document.getElementById('city-dropdown');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }

    function selectCity(name) {
        if(!locations[name])return;
        selectedCity=name;localStorage.setItem('selectedCity',name);
        syncLocationUI();renderFeed();resetSwipes();
        document.getElementById('city-dropdown').style.display = 'none';
    }

    function updateSwipeCard() {
        const cards=visibleEvents();
        if (swipeIndex < cards.length) {
            document.getElementById('swipe-card-container').style.display = 'block';
            document.getElementById('swipe-done-box').style.display = 'none';

            var item = cards[swipeIndex];
            document.getElementById('banner-title').innerText = item.title;
            document.getElementById('banner-place').textContent = '📍 ' + item.place;
            document.getElementById('banner-time').textContent = '🕒 ' + item.time;
            document.getElementById('banner-category').innerText = item.direction;
            document.getElementById('banner-needed').innerText = 'Нужно ещё ' + item.people;
            document.getElementById('swipe-counter').innerText = (swipeIndex + 1) + ' из ' + cards.length;
            document.getElementById('swipe-top-ico').className = /^fa-(solid|regular) fa-[a-z-]+$/.test(item.icon || '') ? item.icon : 'fa-solid fa-leaf';
        } else {
            document.getElementById('swipe-card-container').style.display = 'none';
            document.getElementById('swipe-done-box').style.display = 'block';
            document.getElementById('done-stats-text').innerText = 'Вам понравилось: ' + likedCards.length + '. Загляните в профиль.';
        }
    }

    function dislikeCurrent() {
        swipeIndex++;
        updateSwipeCard();
    }

    async function likeCurrent() {
        var item = visibleEvents()[swipeIndex];
        if (!currentUserId) { alert('Для сохранения войдите в аккаунт'); return; }
        if (likedCards.indexOf(item.title) === -1) {
            likedCards.push(item.title);
        }
        document.getElementById('like-badge').innerText = likedCards.length;
        
        if (currentUserId) {
            await fetch(`${API_URL}/events/${item.id}/respond`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ userId: currentUserId, status: 'liked' })
            });
        }
        
        swipeIndex++;
        updateSwipeCard();
    }

    function restartSwipes() {
        resetSwipes();
    }

    function openDetailsModal(index) {
        currentOpenedIndex = index;
        var item = itemsData[index];
        document.getElementById('modal-heading').innerText = item.title;
        document.getElementById('modal-place').innerText = item.place;
        document.getElementById('modal-time').innerText = item.time;
        document.getElementById('modal-direction').innerText = item.direction;
        document.getElementById('modal-people').innerText = item.people;
        document.getElementById('modal-desc').innerText = item.description || item.desc;

        var btn = document.getElementById('modal-action-btn');
        if (subscribedSet[item.id]) {
            btn.innerText = 'Вы записаны ✓';
            btn.style.backgroundColor = '#234432';
        } else {
            btn.innerText = 'Откликнуться';
            btn.style.backgroundColor = '#356349';
        }
        document.getElementById('details-popup').style.display = 'flex';
    }

    function openCurrentDetails() {
        const item=visibleEvents()[swipeIndex]; if(item)openDetailsModal(itemsData.indexOf(item));
    }

    function closeDetailsModal() {
        document.getElementById('details-popup').style.display = 'none';
    }

    async function modalSubscribe() {
        var item = itemsData[currentOpenedIndex];
        var btn = document.getElementById('modal-action-btn');
        if(!currentUserId) { alert('Необходимо войти в аккаунт'); return; }
        subscribedSet[item.id] = true;
        btn.innerText = 'Вы записаны ✓';
        btn.style.backgroundColor = '#234432';

        if (currentUserId) {
            await fetch(`${API_URL}/events/${item.id}/respond`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ userId: currentUserId, status: 'joined' })
            });
            await loadUserResponses();
        } else {
            alert('Необходимо войти в аккаунт');
        }
    }

    async function loadUserResponses() {
        if (!currentUserId) { document.getElementById('my-responses-list').textContent = 'Войдите, чтобы увидеть свои отклики'; document.getElementById('created-requests-list').textContent = 'Войдите, чтобы увидеть свои заявки'; return; }
        await loadCreatedRequests();
        try {
            const res = await fetch(`${API_URL}/users/${currentUserId}/responses`, {headers: authHeaders()});
            const data = await res.json();
            if (data.success) {
                const list = document.getElementById('my-responses-list');
                list.innerHTML = '';
                data.data.forEach(item => {
                    if (item.status === 'joined') {
                        subscribedSet[item.id] = true;
                        list.innerHTML += `
                            <div class="event-row-card">
                              <div class="icon-round-leaf"><i class="${escapeHTML(item.icon)}"></i></div>
                              <div class="event-row-info">
                                <h3>${escapeHTML(item.title)}</h3>
                                <p>${escapeHTML(item.place)} · ${escapeHTML(item.time)}</p>
                              </div>
                              <div class="event-row-actions">
                                <button class="delete-icon-btn" onclick="removeResponseCard(this, ${item.id})"><i class="fa-regular fa-trash-can"></i></button>
                                <button class="action-circle-btn joined"><i class="fa-solid fa-check"></i></button>
                              </div>
                            </div>
                        `;
                    } else if (item.status === 'liked' && likedCards.indexOf(item.title) === -1) {
                        likedCards.push(item.title);
                        document.getElementById('like-badge').innerText = likedCards.length;
                    }
                });
            }
        } catch(e) { console.error(e); }
    }

    function openProfileModal() {
        var list = document.getElementById('profile-likes-list');
        if (likedCards.length === 0) {
            list.innerHTML = 'Пока ничего нет. Свайпайте вправо, чтобы сохранить дело.';
        } else {
            var html = '<ul style="padding-left:18px; margin: 10px 0;">';
            for (var i = 0; i < likedCards.length; i++) {
                html += '<li>' + escapeHTML(likedCards[i]) + '</li>';
            }
            html += '</ul>';
            list.innerHTML = html;
        }
        document.getElementById('profile-popup').style.display = 'flex';
    }

    function closeProfileModal() {
        document.getElementById('profile-popup').style.display = 'none';
    }

    function goToResponsesFromProfile() {
        closeProfileModal();
        switchTab('responses');
    }

    async function removeResponseCard(btn, eventId) {
        const response = await fetch(`${API_URL}/events/${eventId}/respond`, {method:'DELETE',headers:authHeaders()});
        if(!response.ok) { alert('Не удалось удалить отклик'); return; }
        delete subscribedSet[eventId];
        var card = btn.closest('.event-row-card');
        card.style.opacity = '0';
        card.style.transform = 'scale(0.8)';
        setTimeout(function() {
            card.remove();
        }, 200);
    }
  