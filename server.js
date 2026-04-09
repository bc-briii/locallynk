const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session must be available for API requests before routes are defined
app.use(session({
    secret: process.env.SESSION_SECRET || 'locallynk-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'LocalLynk.html'));
});

// PostgreSQL Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============ HELPER FUNCTIONS ============

function hashPassword(password) {
    return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

// ============ API ENDPOINTS ============

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email, profile } = req.body;

        if (!username || !password || !email || !profile) {
            return res.json({ success: false, error: 'Missing required fields' });
        }

        const hashedPassword = hashPassword(password);

        const result = await pool.query(
            'INSERT INTO users (username, password, email, profile, completed, active, last_seen) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, username, email, profile, completed',
            [username, hashedPassword, email, JSON.stringify(profile), true, true]
        );

        req.session.userId = result.rows[0].id;
        res.json({ success: true, user: result.rows[0], user_id: result.rows[0].id });
    } catch (error) {
        console.error('Register error:', error);
        // Check for duplicate username error
        if (error.message.includes('users_username_key') || error.message.includes('duplicate')) {
            return res.json({ success: false, error: 'Username already exists' });
        }
        res.json({ success: false, error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const result = await pool.query(
            'SELECT id, username, email, password, profile, completed FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'User not found' });
        }

        const user = result.rows[0];
        if (!verifyPassword(password, user.password)) {
            return res.json({ success: false, error: 'Invalid password' });
        }

        await pool.query('UPDATE users SET active = true, last_seen = NOW() WHERE id = $1', [user.id]);
        req.session.userId = user.id;
        res.json({ 
            success: true, 
            user: { 
                id: user.id, 
                username: user.username, 
                email: user.email,
                profile: user.profile,
                completed: user.completed
            } 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get current user
app.get('/api/currentUser', (req, res) => {
    if (req.session.userId) {
        res.json({ success: true, userId: req.session.userId });
    } else {
        res.json({ success: false, error: 'Not logged in' });
    }
});

// Logout
app.post('/api/logout', async (req, res) => {
    try {
        if (req.session.userId) {
            await pool.query('UPDATE users SET active = false WHERE id = $1', [req.session.userId]);
        }
        req.session.destroy();
        res.json({ success: true });
    } catch (error) {
        console.error('Logout error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Check username availability
app.get('/api/checkUsername', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) {
            return res.json({ success: false, error: 'Username required' });
        }
        const result = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            return res.json({ success: false, error: 'Username already exists' });
        }
        res.json({ success: true, available: true });
    } catch (error) {
        console.error('Check username error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get all users (for ring feature)
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, profile, location, completed FROM users WHERE id != $1',
            [req.session.userId || 0]
        );
        res.json({ success: true, users: result.rows });
    } catch (error) {
        console.error('Get users error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get nearby users within specified radius
app.get('/api/nearbyUsers', async (req, res) => {
    try {
        const { lat, lng, radius } = req.query;
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const searchRadius = parseFloat(radius) || 0.001; // Default 1 meter

        if (!userLat || !userLng) {
            return res.json({ success: false, error: 'Latitude and longitude required' });
        }

        // Get all users except current user
        const result = await pool.query(
            "SELECT id, username, profile, location, completed FROM users WHERE id != $1 AND completed = true AND active = true AND last_seen > NOW() - INTERVAL '30 seconds'",
            [req.session.userId || 0]
        );

        // Filter users by distance
        const nearbyUsers = result.rows.filter(user => {
            if (!user.location) return false;
            
            const userLoc = typeof user.location === 'string' ? JSON.parse(user.location) : user.location;
            if (!userLoc.lat || !userLoc.lng) return false;
            
            // Calculate distance using Haversine formula
            const R = 6371; // Earth's radius in km
            const dLat = (userLoc.lat - userLat) * Math.PI / 180;
            const dLon = (userLoc.lng - userLng) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(userLat * Math.PI / 180) * Math.cos(userLoc.lat * Math.PI / 180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = R * c; // Distance in km
            
            return distance <= searchRadius;
        });

        res.json({ success: true, users: nearbyUsers });
    } catch (error) {
        console.error('Get nearby users error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Send ring (connection request)
app.post('/api/sendRing', async (req, res) => {
    try {
        const { toUserId } = req.body;
        const fromUserId = req.session.userId;

        if (!fromUserId) {
            return res.json({ success: false, error: 'Not logged in' });
        }

        const result = await pool.query(
            'INSERT INTO rings (from_user_id, to_user_id, status) VALUES ($1, $2, $3) RETURNING id',
            [fromUserId, toUserId, 'pending']
        );

        res.json({ success: true, ringId: result.rows[0].id });
    } catch (error) {
        console.error('Send ring error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Accept ring
app.post('/api/acceptRing', async (req, res) => {
    try {
        const { ringId } = req.body;

        await pool.query(
            'UPDATE rings SET status = $1 WHERE id = $2',
            ['accepted', ringId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Accept ring error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get pending rings
app.get('/api/pendingRings', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT r.id, r.from_user_id, u.username, u.profile FROM rings r JOIN users u ON r.from_user_id = u.id WHERE r.to_user_id = $1 AND r.status = $2',
            [req.session.userId, 'pending']
        );
        res.json({ success: true, rings: result.rows });
    } catch (error) {
        console.error('Get pending rings error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Send message
app.post('/api/sendMessage', async (req, res) => {
    try {
        const { toUserId, message } = req.body;
        const fromUserId = req.session.userId;

        if (!fromUserId) {
            return res.json({ success: false, error: 'Not logged in' });
        }

        const result = await pool.query(
            'INSERT INTO messages (from_user_id, to_user_id, message) VALUES ($1, $2, $3) RETURNING id, created_at',
            [fromUserId, toUserId, message]
        );

        res.json({ success: true, messageId: result.rows[0].id, timestamp: result.rows[0].created_at });
    } catch (error) {
        console.error('Send message error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get messages
app.get('/api/messages/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = req.session.userId;

        const result = await pool.query(
            'SELECT * FROM messages WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1) ORDER BY created_at ASC',
            [currentUserId, userId]
        );

        res.json({ success: true, messages: result.rows });
    } catch (error) {
        console.error('Get messages error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Update user profile
async function saveUserProfile(req, res) {
    try {
        const { profile, location } = req.body;
        const userId = req.session.userId;

        if (!userId) {
            return res.json({ success: false, error: 'Not logged in' });
        }

        const locationValue = location ? JSON.stringify(location) : null;

        await pool.query(
            'UPDATE users SET profile = $1, location = COALESCE($2, location), active = true, last_seen = NOW() WHERE id = $3',
            [JSON.stringify(profile), locationValue, userId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Update profile error:', error);
        res.json({ success: false, error: error.message });
    }
}

app.post('/api/updateProfile', saveUserProfile);
app.post('/api/saveProfile', saveUserProfile);

// ============ DATABASE INITIALIZATION ============

async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(100) NOT NULL,
                profile JSONB,
                location JSONB,
                completed BOOLEAN DEFAULT FALSE,
                active BOOLEAN DEFAULT FALSE,
                last_seen TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS rings (
                id SERIAL PRIMARY KEY,
                from_user_id INT NOT NULL,
                to_user_id INT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                from_user_id INT NOT NULL,
                to_user_id INT NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT FALSE; ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP;");
        console.log('Database schema initialized');
    } catch (error) {
        console.error('Database initialization failed:', error);
        process.exit(1);
    }
}

// ============ START SERVER ============

const PORT = process.env.PORT || 3000;

initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`LocalLynk server running on port ${PORT}`);
    });
});
