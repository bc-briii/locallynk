// ============ DATABASE (API ONLY) ============
let usersDB = [];
let ringHistory = {};
let messagesDB = {};
let pendingRings = {};

// API calls to Node.js/Express backend
// Replace with your Render backend URL when deployed
const API_BASE_URL = 'https://locallynk-api.onrender.com';

async function apiCall(action, data = {}, method = 'POST') {
    try {
        const isGet = method === 'GET';
        const query = isGet ? `?${new URLSearchParams(data)}` : '';
        const url = `${API_BASE_URL}/api/${action}${query}`;
        
        const options = {
            method: method,
            credentials: 'include' // Include session cookies
        };
        if (!isGet) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        // Fallback to localStorage if API fails
        return { error: 'API unavailable, using localStorage' };
    }
}
let currentUser = null;
let userLocation = null;
let watchId = null;
let locationTrackingInterval = null;
let nearbyRefreshInterval = null;

function saveAll() {
    localStorage.setItem('locallynk_users', JSON.stringify(usersDB));
    localStorage.setItem('locallynk_history', JSON.stringify(ringHistory));
    localStorage.setItem('locallynk_messages', JSON.stringify(messagesDB));
    localStorage.setItem('locallynk_pending', JSON.stringify(pendingRings));
}

// Get user's location
async function getUserLocation() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported');
        return null;
    }

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 30000
            });
        });

        userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        console.log('Location found:', userLocation);

        if (currentUser) {
            currentUser.location = userLocation;
            try {
                await apiCall('updateProfile', {
                    profile: currentUser.profile,
                    location: userLocation
                });
            } catch (error) {
                console.log('Failed to save location to database:', error);
            }
            saveAll();
        }

        return userLocation;
    } catch (error) {
        console.log('Location access denied:', error);
        showToast('Location access failed. Please enable location services.');
        return null;
    }
}

function startLocationTracking() {
    if (!navigator.geolocation || watchId !== null) return;

    watchId = navigator.geolocation.watchPosition(async function(position) {
        userLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        if (currentUser) {
            currentUser.location = userLocation;
            saveAll();
            try {
                await apiCall('updateProfile', {
                    profile: currentUser.profile,
                    location: userLocation
                });
            } catch (error) {
                console.log('Failed to update live location:', error);
            }
        }
    }, function(error) {
        console.log('Location watch error:', error);
    }, {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 10000
    });

    locationTrackingInterval = setInterval(async () => {
        if (!currentUser) return;
        await getUserLocation();
    }, 5000);
}

function stopLocationTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (locationTrackingInterval !== null) {
        clearInterval(locationTrackingInterval);
        locationTrackingInterval = null;
    }
}

function startNearbyRefresh() {
    if (nearbyRefreshInterval !== null) return;
    nearbyRefreshInterval = setInterval(findNearbyUsers, 5000);
}

function stopNearbyRefresh() {
    if (nearbyRefreshInterval !== null) {
        clearInterval(nearbyRefreshInterval);
        nearbyRefreshInterval = null;
    }
}

// Seed default users - REMOVED for real deployment
function seedDatabase() {
    // No more fake users - real users will sign up
    usersDB.forEach(u => { if (!ringHistory[u.username]) ringHistory[u.username] = []; });
    saveAll();
}
seedDatabase();

function showToast(msg) {
    let t = document.createElement('div');
    t.className = 'toast';
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function updateSidebar() {
    if (!currentUser) return;
    let p = currentUser.profile;
    document.getElementById('profileSummary').innerHTML = `
        <strong style="color:#a5b4fc;">${escapeHtml(p.name)}</strong><br>
        ${p.age} yrs | ${p.hobbies?.split(',')[0] || '—'}<br>
        <img src="${p.picture || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" style="width:48px; border-radius:50%; margin-top:6px; border:1px solid #6366f1;">
    `;
    
    let history = ringHistory[currentUser.username] || [];
    let histDiv = document.getElementById('historyList');
    if (history.length === 0) histDiv.innerHTML = 'No rings yet';
    else histDiv.innerHTML = history.slice(0,6).map(h => `<div class="history-item">${escapeHtml(h.text)}</div>`).join('');

    let msgArray = [];
    for (let thread in messagesDB) {
        if (thread.includes(currentUser.username)) {
            let other = thread.replace(currentUser.username, '').replace('_', '');
            let last = messagesDB[thread].slice(-1)[0];
            if (last) msgArray.push(`${other}: ${last.text.substring(0, 32)}`);
        }
    }
    let msgDiv = document.getElementById('messagesList');
    if (msgArray.length === 0) msgDiv.innerHTML = 'No messages yet';
    else msgDiv.innerHTML = msgArray.slice(-5).map(m => `<div class="msg-item">${escapeHtml(m)}</div>`).join('');
}

async function openChatWith(user) {
    let threadId = [currentUser.username, user.username].sort().join('_');
    if (!messagesDB[threadId]) messagesDB[threadId] = [];

    let modal = document.createElement('div');
    modal.className = 'edit-modal message-modal';
    modal.innerHTML = `
        <h3>Message ${escapeHtml(user.profile.name)}</h3>
        <div class="chat-history" id="chatHistory"></div>
        <textarea id="chatInput" rows="4" placeholder="Type your message..."></textarea>
        <div class="chat-actions">
            <button class="btn" id="sendChatBtn">Send</button>
            <button class="btn btn-outline" id="closeChatBtn">Close</button>
        </div>
    `;
    document.body.appendChild(modal);
    let overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);

    let chatHistory = modal.querySelector('#chatHistory');
    let chatInput = modal.querySelector('#chatInput');

    function renderChatHistory() {
        chatHistory.innerHTML = messagesDB[threadId].map(entry => {
            let who = entry.sender === currentUser.username ? 'You' : escapeHtml(user.profile.name);
            let cls = entry.sender === currentUser.username ? 'chat-line sent' : 'chat-line';
            return `<div class="${cls}"><strong>${who}:</strong> ${escapeHtml(entry.text)}</div>`;
        }).join('');
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function close() {
        modal.remove();
        overlay.remove();
    }

    async function loadMessageThread() {
        try {
            const response = await apiCall(`messages/${user.id}`, {}, 'GET');
            if (response.success && Array.isArray(response.messages)) {
                messagesDB[threadId] = response.messages.map(msg => ({
                    sender: msg.from_user_id == currentUser.id ? currentUser.username : user.username,
                    text: msg.message,
                    time: new Date(msg.created_at).getTime()
                }));
                saveAll();
            }
        } catch (error) {
            console.warn('Unable to load messages:', error);
        }
    }

    modal.querySelector('#sendChatBtn').onclick = async () => {
        let msgText = chatInput.value.trim();
        if (!msgText) return;

        const sendResult = await apiCall('sendMessage', { toUserId: user.id, message: msgText }, 'POST');
        if (sendResult.success) {
            messagesDB[threadId].push({ sender: currentUser.username, text: msgText, time: Date.now() });
            saveAll();
            chatInput.value = '';
            renderChatHistory();
            showToast(`Message sent to ${user.profile.name}`);
            updateSidebar();
        } else {
            showToast('Unable to send message to receiver');
        }
    };

    modal.querySelector('#closeChatBtn').onclick = close;
    overlay.onclick = close;

    await loadMessageThread();
    renderChatHistory();
}

// Ring notification data
let lastRingCheck = 0;
let ringsNotified = new Set();

// Play ring sound
function playRingSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    
    oscillator.frequency.value = 800; // Hz
    oscillator.type = 'sine';
    
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
    
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }
}

function ringUser(targetUser) {
    if (!currentUser || targetUser.username === currentUser.username) return;
    
    (async () => {
        try {
            const result = await apiCall('sendRing', { toUserId: targetUser.id }, 'POST');
            if (result.success) {
                showToast(`Ringing ${targetUser.profile.name}...`);
                let time = new Date().toLocaleTimeString();
                ringHistory[currentUser.username].unshift({ text: `You rang ${targetUser.username} at ${time}`, rangBack: false });
                saveAll();
                updateSidebar();
            } else {
                showToast('Failed to send ring');
            }
        } catch (error) {
            console.error('Ring error:', error);
            showToast('Error sending ring');
        }
    })();
}

async function checkIncomingRings() {
    if (!currentUser) return;
    
    try {
        const result = await apiCall('pendingRings', {}, 'GET');
        if (!result.success || !result.rings) return;
        
        result.rings.forEach(ring => {
            const notifId = `ring_${ring.id}`;
            if (ringsNotified.has(notifId)) return;
            ringsNotified.add(notifId);
            
            // Play sound and vibration
            playRingSound();
            
            const userResult = usersDB.find(u => u.id === ring.from_user_id);
            const userName = ring.username || 'Unknown User';
            
            let modalDiv = document.createElement('div');
            modalDiv.className = 'profile-modal';
            modalDiv.innerHTML = `
                <div class="profile-header" style="background:linear-gradient(135deg,#4f46e5,#db2777)">
                    <div style="font-size:2rem; animation: pulse 0.5s infinite;">🔔</div>
                    <div class="profile-name">Incoming Ring</div>
                </div>
                <div class="profile-info">
                    <p style="text-align:center;"><strong>${escapeHtml(userName)}</strong> wants to connect</p>
                    <p style="text-align:center; font-size:0.75rem;">Ring back to reveal location and start messaging.</p>
                </div>
                <div class="profile-actions">
                    <button id="ringBackBtn_${ring.id}" class="ring-action">Ring Back</button>
                    <button id="ignoreRingBtn_${ring.id}" class="ignore-action">Ignore</button>
                </div>
            `;
            document.body.appendChild(modalDiv);
            let overlay = document.createElement('div');
            overlay.className = 'overlay';
            document.body.appendChild(overlay);
            
            let cleanup = () => { modalDiv.remove(); overlay.remove(); };
            
            document.getElementById(`ringBackBtn_${ring.id}`).onclick = async () => {
                try {
                    const acceptResult = await apiCall('acceptRing', { ringId: ring.id }, 'POST');
                    if (!acceptResult.success) {
                        showToast('Failed to accept ring');
                        return;
                    }

                    let timeBack = new Date().toLocaleTimeString();
                    ringHistory[currentUser.username] = ringHistory[currentUser.username] || [];
                    ringHistory[currentUser.username].unshift({ text: `${userName} rang you back at ${timeBack}`, rangBack: true });
                    saveAll();

                    const sendRingResult = await apiCall('sendRing', { toUserId: ring.from_user_id }, 'POST');
                    if (sendRingResult.success) {
                        showToast(`Ringing ${userName} back...`);
                    } else {
                        showToast(`Accepted ring, but ring back failed`);
                    }

                    cleanup();
                    updateSidebar();
                } catch (error) {
                    console.error('Accept ring error:', error);
                    showToast('Error handling ring back');
                }
            };
            
            document.getElementById(`ignoreRingBtn_${ring.id}`).onclick = () => {
                cleanup();
                showToast(`Ignored ${userName}`);
            };
        });
    } catch (error) {
        console.error('Check incoming rings error:', error);
    }
}

function showProfileCard(user) {
    let modal = document.createElement('div');
    modal.className = 'profile-modal';
    let p = user.profile;
    modal.innerHTML = `
        <div class="profile-header">
            <img src="${p.picture || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3135/3135715.png'">
            <div class="profile-name">${escapeHtml(p.name)}</div>
        </div>
        <div class="profile-info">
            <div class="info-row"><span class="info-icon">🧑</span><div class="info-text"><strong>Age</strong>${p.age} years</div></div>
            <div class="info-row"><span class="info-icon">✨</span><div class="info-text"><strong>Hobbies</strong>${p.hobbies || 'Exploring'}</div></div>
            <div class="info-row"><span class="info-icon">💬</span><div class="info-text"><strong>Bio</strong>${p.bio || 'Ready to connect'}</div></div>
        </div>
        <div class="profile-actions">
            <button class="ignore-action" data-action="ignore">Ignore</button>
            <button class="message-action" data-action="message">Message</button>
            <button class="ring-action" data-action="ring">Ring</button>
        </div>
    `;
    document.body.appendChild(modal);
    let overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);
    
    let close = () => { modal.remove(); overlay.remove(); };
    
    modal.querySelector('[data-action="ring"]').onclick = () => { ringUser(user); close(); };
    modal.querySelector('[data-action="ignore"]').onclick = () => { showToast(`You ignored ${p.name}`); close(); };
    modal.querySelector('[data-action="message"]').onclick = () => { openChatWith(user); close(); };
    overlay.onclick = close;
}

async function findNearbyUsers() {
    if (!currentUser) {
        showToast('Please log in first');
        return;
    }

    showToast('Getting your location...');
    const location = await getUserLocation();
    if (!location) return;

    showToast('Finding nearby users...');

    try {
        const result = await apiCall('nearbyUsers', {
            lat: userLocation.lat,
            lng: userLocation.lng,
            radius: 0.02
        }, 'GET');

        console.log('Nearby users API result:', result);

        if (!result.success) {
            console.error('API call failed:', result);
            showToast('Failed to find nearby users: ' + (result.error || 'Unknown error'));
            return;
        }

        let nearbyUsers = result.users || [];
        let container = document.getElementById('usersContainer');
        container.innerHTML = '';

        if (nearbyUsers.length === 0) {
            container.innerHTML = '<div style="color:#94a3b8; position:absolute; top:45%; left:35%; background:#0f172a; padding:8px 20px; border-radius:30px; text-align:center;">No users nearby<br><small>(within 20 meters)</small></div>';
            showToast('No users found within 20 meters');
            return;
        }

        let centerX = window.innerWidth * 0.5 + 160;
        let centerY = window.innerHeight * 0.5;
        let radius = 180;

        nearbyUsers.forEach((user, idx) => {
            let angle = (idx / nearbyUsers.length) * Math.PI * 2;
            let left = centerX + Math.cos(angle) * radius - 45;
            let top = centerY + Math.sin(angle) * radius - 25;

            let card = document.createElement('div');
            card.className = 'user-card';
            card.style.left = left + 'px';
            card.style.top = top + 'px';
            card.innerHTML = `<img src="${user.profile?.picture || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3135/3135715.png'"><span>${escapeHtml(user.profile?.name?.split(' ')[0] || user.username)}</span>`;
            card.onclick = (e) => { e.stopPropagation(); showProfileCard(user); };
            container.appendChild(card);
        });
        showToast(`${nearbyUsers.length} user(s) within 10 meters. Click to view profile.`);

    } catch (error) {
        console.error('Find nearby users error:', error);
        showToast('Network error. Please check your connection and try again.');
    }
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
}

function openEditModal() {
    let modal = document.createElement('div');
    modal.className = 'edit-modal';
    modal.innerHTML = `
        <h3>Edit Profile</h3>
        <input id="editName" placeholder="Full Name" value="${escapeHtml(currentUser.profile.name)}">
        <input id="editAge" placeholder="Age" value="${currentUser.profile.age}">
        <input id="editHobbies" placeholder="Hobbies" value="${escapeHtml(currentUser.profile.hobbies)}">
        <textarea id="editBio" rows="2" placeholder="Bio">${escapeHtml(currentUser.profile.bio)}</textarea>
        <input id="editPic" placeholder="Image URL" value="${escapeHtml(currentUser.profile.picture || '')}">
        <button class="btn" id="saveEditBtn">Save Changes</button>
        <button class="btn btn-outline" id="cancelEditBtn">Cancel</button>
    `;
    document.body.appendChild(modal);
    let overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);
    
    let close = () => { modal.remove(); overlay.remove(); };
    
    document.getElementById('saveEditBtn').onclick = async () => {
        let newName = document.getElementById('editName').value.trim();
        let newAge = parseInt(document.getElementById('editAge').value);
        let newHobbies = document.getElementById('editHobbies').value.trim();
        let newBio = document.getElementById('editBio').value.trim();
        let newPicture = document.getElementById('editPic').value.trim();
        
        if (!newName || !newAge || !newHobbies) {
            alert('Please fill name, age and hobbies');
            return;
        }
        
        // Save to API
        const result = await apiCall('updateProfile', {
            profile: {
                name: newName,
                age: newAge,
                hobbies: newHobbies,
                bio: newBio || 'Ready to connect!',
                picture: newPicture || currentUser.profile.picture
            }
        });
        
        if (result.success) {
            currentUser.profile = {
                name: newName,
                age: newAge,
                hobbies: newHobbies,
                bio: newBio || 'Ready to connect!',
                picture: newPicture || currentUser.profile.picture
            };
            updateSidebar();
            updateMyOrbitProfile();
            showToast("Profile updated");
            close();
        } else {
            alert('Profile update failed: ' + (result.error || 'Unknown error'));
        }
    };
    document.getElementById('cancelEditBtn').onclick = close;
    overlay.onclick = close;
}

function initSatellite() {
    let canvas = document.getElementById('satelliteCanvas');
    if (!canvas) return;
    let ctx = canvas.getContext('2d');
    let width, height, angle = 0;
    
    function resize() {
        width = canvas.parentElement.clientWidth;
        height = canvas.parentElement.clientHeight;
        canvas.width = width;
        canvas.height = height;
    }
    
    window.addEventListener('resize', resize);
    
    function draw() {
        if (!canvas.isConnected) return;
        resize();
        ctx.clearRect(0, 0, width, height);
        
        let orbitCenterX = width * 0.5 + 160;
        let orbitCenterY = height * 0.5;

        ctx.beginPath();
        ctx.arc(orbitCenterX, orbitCenterY, 120, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(orbitCenterX, orbitCenterY, 190, 0, Math.PI * 2);
        ctx.stroke();
        
        let satX = orbitCenterX + Math.cos(angle) * 160;
        let satY = orbitCenterY + Math.sin(angle * 1.2) * 80;
        ctx.fillStyle = '#a78bfa';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(satX, satY, 10, 0, Math.PI * 2);
        ctx.fill();
        
        angle += 0.005;
        requestAnimationFrame(draw);
    }
    draw();
}

function goToMain() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('mainPage').classList.add('active');
    initSatellite();
    updateSidebar();
    startLocationTracking();
    setInterval(() => { if (currentUser) checkIncomingRings(); }, 1500);
    setInterval(() => { if (currentUser) updateSidebar(); }, 5000); // Refresh messages every 5 seconds
    checkIncomingRings();
    
    document.getElementById('findBtn').onclick = () => {
        findNearbyUsers();
        startNearbyRefresh();
    };
    document.getElementById('logoutBtn').onclick = () => { currentUser = null; stopLocationTracking(); stopNearbyRefresh(); location.reload(); };
    document.getElementById('editProfileBtn').onclick = openEditModal;
    updateMyOrbitProfile();
    startNearbyRefresh(); // Start automatic nearby refresh
}

function updateMyOrbitProfile() {
    const img = document.getElementById('myProfileOrbitImg');
    if (!img || !currentUser) return;
    img.src = currentUser.profile?.picture || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
}

// ============ AUTHENTICATION EVENT HANDLERS ============
document.getElementById('loginBtn').onclick = async function() {
    let username = document.getElementById('loginUsername').value.trim();
    let password = document.getElementById('loginPassword').value;
    
    // ONLY use PHP API - no fallback
    const result = await apiCall('login', { username, password });
    
    if (result.success) {
        currentUser = result.user;
        goToMain();
        return;
    }
    
    // Show API error
    document.getElementById('loginError').innerText = result.error || 'Invalid credentials. Please try again.';
};

document.getElementById('gotoRegisterBtn').onclick = function() {
    document.getElementById('loginPage').classList.remove('active');
    document.getElementById('registerPage').classList.add('active');
};

document.getElementById('backToLoginBtn').onclick = function() {
    document.getElementById('registerPage').classList.remove('active');
    document.getElementById('loginPage').classList.add('active');
    document.getElementById('regError').innerText = '';
};

// Store temp account data during registration
let tempAccountData = {};

document.getElementById('registerBtn').onclick = async function() {
    let u = document.getElementById('regUser').value.trim();
    let p = document.getElementById('regPass').value;
    let c = document.getElementById('regConfirm').value;
    let e = document.getElementById('regEmail').value.trim();
    let terms = document.getElementById('termsCheck').checked;
    
    if (!u || !p || !c || !e) {
        document.getElementById('regError').innerText = 'All fields required';
        return;
    }
    if (p !== c) {
        document.getElementById('regError').innerText = 'Passwords do not match';
        return;
    }
    if (!terms) {
        document.getElementById('regError').innerText = 'You must agree to Terms';
        return;
    }
    
    // Check if username exists
    try {
        const checkResult = await apiCall('checkUsername', { username: u }, 'GET');
        if (!checkResult.success && checkResult.error === 'Username already exists') {
            document.getElementById('regError').innerText = 'Username already exists';
            return;
        }
    } catch (error) {
        console.log('Username check error:', error);
    }
    
    // Store account data and move to profile step
    tempAccountData = { username: u, password: p, email: e };
    document.getElementById('registerPage').classList.remove('active');
    document.getElementById('profileCompletionPage').classList.add('active');
    document.getElementById('profileError').innerText = '';
};

document.getElementById('completeProfileBtn').onclick = async function() {
    let name = document.getElementById('profileName').value.trim();
    let age = parseInt(document.getElementById('profileAge').value);
    let hobbies = document.getElementById('profileHobbies').value.trim();
    let bio = document.getElementById('profileBio').value.trim();
    
    if (!name || !age || !hobbies) {
        document.getElementById('profileError').innerText = 'All fields required';
        return;
    }
    
    // Get uploaded image or use default
    const preview = document.getElementById('profileImagePreview');
    const picture = preview.dataset.imageData || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    
    // Register with account + profile data
    const result = await apiCall('register', { 
        username: tempAccountData.username, 
        password: tempAccountData.password, 
        email: tempAccountData.email,
        profile: {
            name: name,
            age: age,
            hobbies: hobbies,
            bio: bio || 'Ready to connect!',
            picture: picture
        }
    });
    
    if (result.success) {
        let newUser = { 
            id: result.user_id, 
            username: tempAccountData.username, 
            password: tempAccountData.password, 
            email: tempAccountData.email, 
            completed: true, 
            profile: {
                name: name,
                age: age,
                hobbies: hobbies,
                bio: bio || 'Ready to connect!',
                picture: picture
            }
        };
        currentUser = newUser;
        tempAccountData = {};
        document.getElementById('profileCompletionPage').classList.remove('active');
        goToMain();
        return;
    }
    
    if (result.error === 'Username already exists') {
        document.getElementById('profileError').innerText = 'Username already exists';
        return;
    }
    
    document.getElementById('profileError').innerText = result.error || 'Registration failed. Please try again.';
};

document.getElementById('backToAccountBtn').onclick = function() {
    document.getElementById('profileCompletionPage').classList.remove('active');
    document.getElementById('registerPage').classList.add('active');
};

// Profile picture file input listener
const profilePictureFile = document.getElementById('profilePictureFile');
if (profilePictureFile) {
    profilePictureFile.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(event) {
                const preview = document.getElementById('profileImagePreview');
                if (preview) {
                    preview.innerHTML = `<img src="${event.target.result}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                    preview.dataset.imageData = event.target.result;
                }
            };
            reader.readAsDataURL(file);
        }
    });
}
