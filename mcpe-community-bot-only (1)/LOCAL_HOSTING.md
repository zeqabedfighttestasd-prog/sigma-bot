# Run the MCPE Community bot on your own computer or server

This bundle includes the bot source and local run scripts. You need Node.js 24,
pnpm 10.26.1, and a PostgreSQL database running on your computer or on a database
host you control.

## Setup

1. Extract the ZIP and open a terminal in the extracted folder.
2. Copy `.env.example` to `.env`.
   - macOS/Linux: `cp .env.example .env`
   - Windows PowerShell: `Copy-Item .env.example .env`
3. Edit `.env` and enter your Discord bot token and PostgreSQL connection URL.
   Keep `.env` private; it is ignored by Git.
4. Install the project packages:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   ```

5. Create the bot's database tables once:

   ```sh
   node scripts/local-bot.mjs migrate
   ```

6. Start the bot:

   ```sh
   node scripts/local-bot.mjs start
   ```

The bot process must keep running, and the computer/server must stay online.
The local runner defaults `PORT` to `8080`; set another value in `.env` if that
port is already in use. No public web domain is required for the bot to connect
to Discord.

## Discord setup

- Enable the **Message Content Intent** in the Discord Developer Portal so
  partnership screenshot uploads can be detected.
- Invite the bot with View Channel, Send Messages, Embed Links, Use Application
  Commands, Send Messages in Threads, Manage Roles, Manage Channels, and Attach
  Files permissions. Allow the bot to mention `@here`; the bot does not use
  `@everyone`.
- Keep the bot's highest role above the roles it assigns or manages.
- The bot uses the MCPE Community channel and role IDs in its source.

The database created for local hosting is separate from Replit's database and
starts without Replit's existing giveaway, application, or ticket records.