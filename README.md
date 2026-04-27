# 🤖 Discord Bot — Setup Guide

A feature-rich Discord bot with **Moderation**, **AI Chat**, and **Welcome Messages**, powered by Claude AI.

---

## ✨ Features

### 🛡️ Moderation
| Command | Description | Permission Needed |
|---|---|---|
| `/kick @user [reason]` | Kick a member | Kick Members |
| `/ban @user [reason]` | Ban a member | Ban Members |
| `/unban <user_id>` | Unban a user by ID | Ban Members |
| `/mute @user <minutes> [reason]` | Timeout a member | Moderate Members |
| `/unmute @user` | Remove timeout | Moderate Members |
| `/warn @user <reason>` | Warn + DM a member | Moderate Members |
| `/purge <1-100>` | Bulk delete messages | Manage Messages |

### 👋 Welcome Messages
| Command | Description |
|---|---|
| `/setwelcome #channel` | Set the welcome channel |
| `/testwelcome` | Preview the welcome embed |

### 🤖 AI Chat (powered by Claude)
| Command | Description |
|---|---|
| `@BotName <message>` | Chat with the AI (remembers context per channel) |
| `/ask <question>` | One-off AI question |
| `/clearchat` | Clear AI memory for the current channel |

---

## 🚀 Setup Instructions

### Step 1 — Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Copy your **Bot Token** (you'll need this later)
6. Go to **General Information** → copy your **Application ID**

### Step 2 — Invite the Bot to your Server

Go to **OAuth2 → URL Generator**:
- **Scopes:** `bot`, `applications.commands`
- **Bot Permissions:** `Administrator` (or select individual permissions)

Open the generated URL and invite the bot.

### Step 3 — Get an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Create a new API key

### Step 4 — Configure the Bot

```bash
# Clone or copy the bot files, then:
cp .env.example .env
```

Edit `.env` and fill in your values:
```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
ANTHROPIC_API_KEY=your_anthropic_key
```

### Step 5 — Install & Run

```bash
npm install
npm start
```

---

## ☁️ Free 24/7 Hosting Options

### Option 1 — Railway (Recommended ⭐)
- **Free plan:** $5/month credit (enough for a bot)
- **Steps:**
  1. Push code to GitHub
  2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
  3. Add environment variables in the Railway dashboard
  4. Deploy! Railway keeps it running 24/7.

### Option 2 — Render
- **Free plan:** Spins down after 15 min of inactivity (not ideal for bots)
- **Paid plan ($7/mo):** Always-on
- Good if you set up a keep-alive ping or use their paid tier.

### Option 3 — Fly.io
- **Free plan:** 3 small VMs included
- More technical but very powerful
- Run: `fly launch` → `fly deploy`

### Option 4 — Oracle Cloud (Always Free ⭐)
- Truly free forever — 2 AMD VMs with 1GB RAM each
- Sign up at [cloud.oracle.com](https://cloud.oracle.com)
- SSH in, install Node.js, use `pm2` to keep bot alive:
  ```bash
  npm install -g pm2
  pm2 start index.js --name discord-bot
  pm2 save && pm2 startup
  ```

---

## 💡 Tips

- The AI remembers the last 20 messages per channel — use `/clearchat` to reset it
- The bot must have a higher role than users you want to moderate
- Welcome channel setting resets if the bot restarts (add a database like SQLite for persistence)
