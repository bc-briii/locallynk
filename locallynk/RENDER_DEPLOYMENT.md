# Deploying to Render

## Step 1: Prepare Your Code

1. Initialize a git repository (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. Push to GitHub, GitLab, or Gitea (Render requires a git repo)

## Step 2: Create PostgreSQL Database on Render

1. Go to [render.com](https://render.com)
2. Sign in / Create account
3. Click "New +" → "PostgreSQL"
4. Configure:
   - **Name**: locallynk-db
   - **Database**: locallynk
   - **User**: locallynk
   - **Region**: Choose closest to you
   - **PostgreSQL Version**: 15 or latest
5. Click "Create Database"
6. Wait for it to be created
7. Copy the **External Database URL** (looks like: `postgresql://user:password@hostname:5432/dbname`)
8. Open the dashboard and run the SQL from `database.sql` in the Query Editor

## Step 3: Deploy Node.js Backend

1. Go to [render.com](https://render.com) dashboard
2. Click "New +" → "Web Service"
3. Connect your repository
4. Configure:
   - **Name**: locallynk-api (or your choice)
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Region**: Same as database
5. Click "Environment" tab:
   - Add these environment variables:
     - **DATABASE_URL**: Paste the PostgreSQL URL from Step 2
     - **SESSION_SECRET**: Generate a random string (e.g., use `openssl rand -hex 32`)
     - **NODE_ENV**: `production`
6. Click "Create Web Service"
7. Wait for deployment to complete (check Logs tab)
8. Copy your backend URL (e.g., `https://locallynk-api.onrender.com`)

## Step 4: Update Frontend API Calls

In `LocalLynk.js`, find the `apiCall` function and update it:

```javascript
async function apiCall(action, data = {}) {
    try {
        const backendUrl = 'https://YOUR_RENDER_API_URL'; // Replace with your Render URL
        const response = await fetch(`${backendUrl}/api/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
            credentials: 'include' // For sessions
        });
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        return { error: 'API unavailable' };
    }
}
```

## Step 5: Deploy Frontend (Optional - Host Static Site)

Option A: Use Render Static Site
1. Create a `render.yaml` file in root:
   ```yaml
   services:
   - type: web
     name: locallynk-frontend
     staticSite: true
     buildCommand: echo "No build needed"
     publishPath: .
   ```
2. Push to repo
3. Render will auto-detect and deploy

Option B: Use Netlify (Free)
1. Go to [netlify.com](https://netlify.com)
2. Connect repository
3. Deploy (it will serve all `.html` files)

## Step 6: Update CORS Settings (if needed)

In `server.js`, update CORS to allow your frontend domain:

```javascript
app.use(cors({
    origin: ['https://your-frontend-domain.com', 'http://localhost:3000'],
    credentials: true
}));
```

## Troubleshooting

- **Database Connection Error**: Check DATABASE_URL in Environment tab
- **Frontend can't reach API**: Make sure CORS is properly configured
- **"Cannot POST /api/..."**: Check that server.js is running (check Logs)
- **Logs not showing**: Click on Web Service → Logs tab

## Local Development

To test locally before deploying:

```bash
# Install dependencies
npm install

# Create .env file with your test database URL
echo "DATABASE_URL=postgresql://localhost/locallynk" > .env

# Start server
npm run dev
```

The app will run on `http://localhost:3000`
