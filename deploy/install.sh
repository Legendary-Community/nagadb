#!/usr/bin/env bash
#
# nagadb — one-command installer for a fresh Ubuntu/Debian VPS.
#
# It installs everything (Rust, Node), clones this repo, builds the storage
# engine and the web console, and runs both as systemd services that restart
# on crash and on reboot.
#
#   curl -fsSL https://raw.githubusercontent.com/Legendary-Community/nagadb/main/deploy/install.sh | sudo bash
#
# Optional overrides (env vars):
#   NAGADB_REPO     git URL to clone            (default: this repo)
#   NAGADB_BRANCH   branch to deploy            (default: main)
#   NAGADB_DIR      where to install            (default: /opt/nagadb)
#   CONSOLE_PORT    public console port         (default: 3000)
#
set -euo pipefail

REPO_URL="${NAGADB_REPO:-https://github.com/Legendary-Community/nagadb.git}"
BRANCH="${NAGADB_BRANCH:-main}"
INSTALL_DIR="${NAGADB_DIR:-/opt/nagadb}"
ENGINE_PORT=9000
CONSOLE_PORT="${CONSOLE_PORT:-3000}"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. Must be root (we use apt + systemd) -------------------------------
[ "$(id -u)" -eq 0 ] || die "Run with sudo:  curl -fsSL .../install.sh | sudo bash"

# The non-root user who will own the files and run the services.
RUN_USER="${SUDO_USER:-root}"
USER_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
[ -n "$USER_HOME" ] || USER_HOME="/root"

# --- 1. System packages ---------------------------------------------------
log "Installing base packages (git, curl, build tools)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl build-essential ca-certificates pkg-config

# --- 2. Rust toolchain (for the build user) -------------------------------
if ! sudo -u "$RUN_USER" bash -lc 'command -v cargo' >/dev/null 2>&1; then
  log "Installing Rust toolchain for user '$RUN_USER'..."
  sudo -u "$RUN_USER" bash -lc 'curl https://sh.rustup.rs -sSf | sh -s -- -y'
fi
CARGO="$USER_HOME/.cargo/bin/cargo"
[ -x "$CARGO" ] || CARGO="$(sudo -u "$RUN_USER" bash -lc 'command -v cargo')"
[ -n "$CARGO" ] || die "cargo not found after install"

# --- 3. Node.js 20 --------------------------------------------------------
NODE_MAJOR=0
command -v node >/dev/null 2>&1 && NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# --- 4. Clone or update the repo ------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing install in $INSTALL_DIR..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  log "Cloning $REPO_URL into $INSTALL_DIR..."
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR"

# --- 5. Build the storage engine (release) --------------------------------
log "Building the storage engine (first build takes a few minutes)..."
sudo -u "$RUN_USER" bash -lc "cd '$INSTALL_DIR/api' && '$CARGO' build --release"

# --- 6. Build the web console ---------------------------------------------
log "Building the web console..."
sudo -u "$RUN_USER" bash -lc "cd '$INSTALL_DIR/web/naga-console' && npm install && npm run build"

# --- 7. systemd: the engine (storage backend, localhost only) -------------
log "Installing systemd services..."
cat >/etc/systemd/system/nagadb-engine.service <<EOF
[Unit]
Description=nagadb storage engine (API server)
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$INSTALL_DIR/api
ExecStart=$INSTALL_DIR/api/target/release/api-server
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

# --- 8. systemd: the console (public UI, talks to the engine) -------------
cat >/etc/systemd/system/nagadb-console.service <<EOF
[Unit]
Description=nagadb web console (Next.js)
After=network.target nagadb-engine.service
Wants=nagadb-engine.service

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$INSTALL_DIR/web/naga-console
Environment=NODE_ENV=production
Environment=PORT=$CONSOLE_PORT
Environment=HOSTNAME=0.0.0.0
Environment=NAGADB_ENGINE_URL=http://127.0.0.1:$ENGINE_PORT
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

# --- 9. Start everything --------------------------------------------------
systemctl daemon-reload
systemctl enable --now nagadb-engine.service
systemctl enable --now nagadb-console.service

# --- 10. Report -----------------------------------------------------------
IP="$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
log "Done! nagadb is running."
cat <<EOF

  Console (open in browser):  http://$IP:$CONSOLE_PORT
  Engine  (localhost only)  :  http://127.0.0.1:$ENGINE_PORT

  Click "Create Database" in the console to make a DB and get a URL.

  Manage it:
    sudo systemctl status  nagadb-console nagadb-engine
    sudo journalctl -u nagadb-console -f
    sudo systemctl restart nagadb-console

  Re-deploy after pushing new code:  re-run this same install command.

  SECURITY: the console is public on port $CONSOLE_PORT with NO login.
  For real use, put it behind a reverse proxy (nginx/Caddy) with HTTPS + auth,
  and open only that port in your firewall.
EOF
