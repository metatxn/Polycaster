#!/bin/sh

# GUI Git clients often start hooks with a minimal PATH.
export PATH="$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  \. "$HOME/.nvm/nvm.sh"
  if ! nvm use 24 --silent >/dev/null 2>&1; then
    echo "BLOCKED: Node.js 24 is required, but NVM could not activate it."
    echo "Install it with 'nvm install 24' and try again."
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED: Node.js 24 is required, but Node.js was not found."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
if [ "$NODE_MAJOR" != "24" ]; then
  echo "BLOCKED: Node.js 24 is required; found $(node --version)."
  echo "Activate Node.js 24 and try again."
  exit 1
fi

unset NODE_MAJOR
