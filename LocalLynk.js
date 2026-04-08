// ============ DATABASE (API ONLY) ============
let usersDB = [];
let ringHistory = {};
let messagesDB = {};
let pendingRings = {};

// API calls to Node.js/Express backend
// Replace with your Render backend URL when deployed
const API_BASE_URL = 'https://locallynk-api.onrender.com';

async function apiCall(action, data = {}) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
            credentials: 'include' // Include session cookies
        });
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        // Fallback to localStorage if API fails
        return { error: 'API unavailable, using localStorage' };
    }
}
let currentUser = null;
let userLocation = null;

function saveAll() {
    localStorage.setItem('locallynk_users', JSON.stringify(usersDB));
    localStorage.setItem('locallynk_history', JSON.stringify(ringHistory));
    localStorage.setItem('locallynk_messages', JSON.stringify(messagesDB));
    localStorage.setItem('locallynk_pending', JSON.stringify(pendingRings));
}

// Get user's location
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                console.log('Location found:', userLocation);
                if (currentUser) {
                    currentUser.location = userLocation;
                    saveAll();
                }
            },
            function(error) {
                console.log('Location access denied:', error);
                // Use default location for testing
                userLocation = { lat: 40.7128, lng: -74.0060 }; // New York
                if (currentUser) {
                    currentUser.location = userLocation;
                    saveAll();
                }
            }
        );
    } else {
        console.log('Geolocation not supported');
        userLocation = { lat: 40.7128, lng: -74.0060 }; // Default
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

function openChatWith(user) {
    let threadId = [currentUser.username, user.username].sort().join('_');
    if (!messagesDB[threadId]) messagesDB[threadId] = [];
    let msg = prompt(`Message ${user.profile.name}:`, "Hey! Would love to chat.");
    if (!msg || msg.trim() === '') return;
    messagesDB[threadId].push({ sender: currentUser.username, text: msg.trim(), time: Date.now() });
    saveAll();
    showToast(`Message sent to ${user.profile.name}`);
    updateSidebar();
}

function ringUser(targetUser) {
    if (!currentUser || targetUser.username === currentUser.username) return;
    showToast(`Ringing ${targetUser.profile.name}...`);
    let time = new Date().toLocaleTimeString();
    ringHistory[currentUser.username].unshift({ text: `You rang ${targetUser.username} at ${time}`, rangBack: false });
    if (!pendingRings[targetUser.username]) pendingRings[targetUser.username] = [];
    pendingRings[targetUser.username].push({ from: currentUser.username, time: Date.now() });
    saveAll();
    updateSidebar();
    checkIncomingRings();
    showToast(`${targetUser.profile.name} can ring you back`);
}

function checkIncomingRings() {
    if (!currentUser) return;
    let myPending = pendingRings[currentUser.username] || [];
    if (myPending.length === 0) return;
    
    myPending.forEach(req => {
        let fromUser = usersDB.find(u => u.username === req.from);
        if (!fromUser) return;
        
        let modalDiv = document.createElement('div');
        modalDiv.className = 'profile-modal';
        modalDiv.innerHTML = `
            <div class="profile-header" style="background:linear-gradient(135deg,#4f46e5,#db2777)">
                <div style="font-size:2rem;">🔔</div>
                <div class="profile-name">Incoming Ring</div>
            </div>
            <div class="profile-info">
                <p style="text-align:center;"><strong>${escapeHtml(fromUser.profile?.name || fromUser.username)}</strong> wants to connect</p>
                <p style="text-align:center; font-size:0.75rem;">Ring back to reveal location and start messaging.</p>
            </div>
            <div class="profile-actions">
                <button id="ringBackBtn" class="ring-action">Ring Back</button>
                <button id="ignoreRingBtn" class="ignore-action">Ignore</button>
            </div>
        `;
        document.body.appendChild(modalDiv);
        let overlay = document.createElement('div');
        overlay.className = 'overlay';
        document.body.appendChild(overlay);
        
        let cleanup = () => { modalDiv.remove(); overlay.remove(); };
        
        document.getElementById('ringBackBtn').onclick = () => {
            let timeBack = new Date().toLocaleTimeString();
            ringHistory[currentUser.username].unshift({ text: `${fromUser.username} rang you back at ${timeBack}`, rangBack: true });
            let threadId = [currentUser.username, fromUser.username].sort().join('_');
            if (!messagesDB[threadId]) messagesDB[threadId] = [];
            messagesDB[threadId].push({ sender: 'system', text: `Connected with ${fromUser.profile.name}! You can now message.`, time: Date.now() });
            saveAll();
            showToast(`Connected with ${fromUser.profile.name}!`);
            cleanup();
            updateSidebar();
            pendingRings[currentUser.username] = (pendingRings[currentUser.username] || []).filter(r => r.from !== fromUser.username);
            saveAll();
        };
        
        document.getElementById('ignoreRingBtn').onclick = () => {
            cleanup();
            showToast(`Ignored ${fromUser.profile?.name}`);
            pendingRings[currentUser.username] = (pendingRings[currentUser.username] || []).filter(r => r.from !== fromUser.username);
            saveAll();
        };
    });
    pendingRings[currentUser.username] = [];
    saveAll();
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
            <div class="info-row"><span class="info-icon">Age</span><div class="info-text"><strong>Age</strong>${p.age} years</div></div>
            <div class="info-row"><span class="info-icon">Hobbies</span><div class="info-text"><strong>Hobbies</strong>${p.hobbies || 'Exploring'}</div></div>
            <div class="info-row"><span class="info-icon">Bio</span><div class="info-text"><strong>Bio</strong>${p.bio || 'Ready to connect'}</div></div>
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

function findNearbyUsers() {
    if (!currentUser) return;
    
    // Get user location first
    getUserLocation();
    
    let others = usersDB.filter(u => u.username !== currentUser.username && u.completed === true);
    let container = document.getElementById('usersContainer');
    container.innerHTML = '';
    
    // Filter by proximity (within 100km for demo)
    let nearbyUsers = others.filter(user => {
        if (!user.location) return true; // Show all for now
        if (!userLocation) return true;
        
        // Calculate distance (simplified)
        let distance = calculateDistance(userLocation.lat, userLocation.lng, user.location.lat, user.location.lng);
        return distance <= 100; // 100km radius
    });
    
    if (nearbyUsers.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8; position:absolute; top:45%; left:40%; background:#0f172a; padding:8px 20px; border-radius:30px;">No users nearby</div>';
        return;
    }
    
    let rect = container.parentElement?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight };
    let centerX = (rect.width || window.innerWidth) * 0.58;
    let centerY = (rect.height || window.innerHeight) * 0.45;
    
    nearbyUsers.forEach((user, idx) => {
        let angle = (idx / nearbyUsers.length) * Math.PI * 2;
        let radius = 130 + (idx % 3) * 40;
        let left = centerX + Math.cos(angle) * radius - 45;
        let top = centerY + Math.sin(angle) * (radius * 0.7) - 25;
        left = Math.min(Math.max(left, 30), (rect.width || window.innerWidth) - 100);
        top = Math.min(Math.max(top, 60), (rect.height || window.innerHeight) - 100);
        
        let card = document.createElement('div');
        card.className = 'user-card';
        card.style.left = left + 'px';
        card.style.top = top + 'px';
        card.innerHTML = `<img src="${user.profile?.picture || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3135/3135715.png'"><span>${escapeHtml(user.profile?.name?.split(' ')[0] || user.username)}</span>`;
        card.onclick = (e) => { e.stopPropagation(); showProfileCard(user); };
        container.appendChild(card);
    });
    showToast(`${nearbyUsers.length} user(s) nearby. Click to view profile.`);
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
    
    document.getElementById('saveEditBtn').onclick = () => {
        currentUser.profile.name = document.getElementById('editName').value.trim() || currentUser.profile.name;
        currentUser.profile.age = parseInt(document.getElementById('editAge').value) || currentUser.profile.age;
        currentUser.profile.hobbies = document.getElementById('editHobbies').value.trim() || currentUser.profile.hobbies;
        currentUser.profile.bio = document.getElementById('editBio').value.trim() || currentUser.profile.bio;
        currentUser.profile.picture = document.getElementById('editPic').value.trim() || currentUser.profile.picture;
        let idx = usersDB.findIndex(u => u.username === currentUser.username);
        if (idx !== -1) usersDB[idx] = currentUser;
        saveAll();
        updateSidebar();
        showToast("Profile updated");
        close();
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
        
        ctx.beginPath();
        ctx.arc(width * 0.5, height * 0.45, 120, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(width * 0.5, height * 0.45, 190, 0, Math.PI * 2);
        ctx.stroke();
        
        let satX = width * 0.5 + Math.cos(angle) * 160;
        let satY = height * 0.45 + Math.sin(angle * 1.2) * 80;
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
    setInterval(() => { if (currentUser) checkIncomingRings(); }, 4000);
    checkIncomingRings();
    
    document.getElementById('findBtn').onclick = findNearbyUsers;
    document.getElementById('logoutBtn').onclick = () => { currentUser = null; location.reload(); };
    document.getElementById('editProfileBtn').onclick = openEditModal;
}

// ============ AUTHENTICATION EVENT HANDLERS ============
document.getElementById('loginBtn').onclick = async function() {
    let username = document.getElementById('loginUsername').value.trim();
    let password = document.getElementById('loginPassword').value;
    
    // ONLY use PHP API - no fallback
    const result = await apiCall('login', { username, password });
    
    if (result.success) {
        currentUser = result.user;
        if (!currentUser.completed) {
            document.getElementById('loginPage').classList.remove('active');
            document.getElementById('profilePage').classList.add('active');
        } else {
            goToMain();
        }
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
    
    // ONLY use PHP API - no fallback
    const result = await apiCall('register', { username: u, password: p, email: e });
    
    if (result.success) {
        let newUser = { 
            id: result.user_id, 
            username: u, 
            password: p, 
            email: e, 
            completed: false, 
            profile: null 
        };
        currentUser = newUser;
        document.getElementById('registerPage').classList.remove('active');
        document.getElementById('profilePage').classList.add('active');
        return;
    }
    
    if (result.error === 'Username already exists') {
        document.getElementById('regError').innerText = 'Username already exists';
        return;
    }
    
    // Show API error if any
    document.getElementById('regError').innerText = result.error || 'Registration failed. Please try again.';
};

document.getElementById('profilePictureFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('imagePreview');
            preview.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
            preview.dataset.imageData = e.target.result;
        };
        reader.readAsDataURL(file);
    }
});

document.getElementById('saveProfileBtn').onclick = async function() {
    let name = document.getElementById('profileName').value.trim();
    let age = parseInt(document.getElementById('profileAge').value);
    let hobbies = document.getElementById('profileHobbies').value.trim();
    let bio = document.getElementById('profileBio').value.trim();
    
    if (!name || !age || !hobbies) {
        alert('Please fill name, age and hobbies');
        return;
    }
    
    // Get uploaded image or use default
    const preview = document.getElementById('imagePreview');
    const picture = preview.dataset.imageData || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    
    // Save to API
    const result = await apiCall('saveProfile', {
        name: name,
        age: age,
        hobbies: hobbies,
        bio: bio || 'Ready to connect!',
        picture: picture
    });
    
    if (result.success) {
        currentUser.profile = {
            name: name,
            age: age,
            hobbies: hobbies,
            bio: bio || 'Ready to connect!',
            picture: picture
        };
        currentUser.completed = true;
        goToMain();
    } else {
        alert('Profile save failed: ' + (result.error || 'Unknown error'));
    }
};
