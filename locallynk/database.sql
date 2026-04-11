-- LocalLynk Database Setup for PostgreSQL
-- Run this in Render's PostgreSQL dashboard

-- Users table
CREATE TABLE users (
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

-- Rings table for connection requests
CREATE TABLE rings (
    id SERIAL PRIMARY KEY,
    from_user_id INT NOT NULL,
    to_user_id INT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Messages table for chat
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    from_user_id INT NOT NULL,
    to_user_id INT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for better performance
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_completed ON users(completed);
CREATE INDEX idx_rings_users ON rings(from_user_id, to_user_id);
CREATE INDEX idx_rings_status ON rings(status);
CREATE INDEX idx_messages_thread ON messages(from_user_id, to_user_id);
CREATE INDEX idx_messages_created ON messages(created_at);
