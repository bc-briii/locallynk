const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'LocalLynk.html'));
});

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'locallynk-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

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
        const { username, password, email } = req.body;

        if (!username || !password || !email) {
            return res.json({ success: false, error: 'Missing required fields' });
        }

        const hashedPassword = hashPassword(password);

        const result = await pool.query(
            'INSERT INTO users (username, password, email) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, hashedPassword, email]
        );

        req.session.userId = result.rows[0].id;
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Register error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const result = await pool.query(
            'SELECT id, username, email, password FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.json({ success: false, error: 'User not found' });
        }

        const user = result.rows[0];
        if (!verifyPassword(password, user.password)) {
            return res.json({ success: false, error: 'Invalid password' });
        }

        req.session.userId = user.id;
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
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
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
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
            'SELECT r.id, r.from_user_id, u.username FROM rings r JOIN users u ON r.from_user_id = u.id WHERE r.to_user_id = $1 AND r.status = $2',
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

        await pool.query(
            'UPDATE users SET profile = $1, location = $2 WHERE id = $3',
            [JSON.stringify(profile), JSON.stringify(location), userId]
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
