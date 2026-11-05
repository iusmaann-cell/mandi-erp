# MacBook setup for developing the ERP

Do the steps in order. Everything is typed into the **Terminal** app (press Cmd+Space, type "Terminal", press Enter). Lines starting with `#` are comments — you don't type those. After each install, run the "check" line; if it prints a version number, it worked.

## 0. What you need and why
| # | Tool | Why |
|---|---|---|
| 1 | Xcode Command Line Tools | Gives Mac the basics (git, compilers) that everything else needs |
| 2 | Homebrew | The "app store for developers" — installs everything below with one command |
| 3 | Git + GitHub CLI (`gh`) | Save versions of the code and push to GitHub |
| 4 | Python 3.11 | Runs the backend (same version Railway uses) |
| 5 | Node.js 22 (LTS) | Runs/builds the React frontend |
| 6 | VS Code | Editor for the code |
| 7 | Railway CLI (optional) | Look at logs/variables of your live app from Terminal |
| 8 | DB Browser for SQLite (optional) | Look inside the local database file |
| 9 | Google Chrome | Testing the ERP in the browser, phone-size view |
| 10 | Claude desktop app / Claude Code (optional) | Keep building with Claude on the Mac |

## 1. Xcode Command Line Tools
```bash
xcode-select --install
```
A window pops up — click Install and wait (several minutes). Check:
```bash
git --version
```

## 2. Homebrew
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Type your Mac password when asked (nothing shows while typing — that's normal). At the end, it prints "Next steps" with two commands that start with `echo` and `eval`. **Copy and run those two exactly** (on newer MacBooks they add `/opt/homebrew/bin` to your path). Then close and reopen Terminal. Check:
```bash
brew --version
```

## 3. Git and GitHub CLI
```bash
brew install git gh
git config --global user.name "Usman Khalid"
git config --global user.email "i.usmaann@gmail.com"
git config --global init.defaultBranch master
gh auth login
```
In `gh auth login` choose: GitHub.com → HTTPS → "Login with a web browser" → copy the one-time code, press Enter, paste it in the browser page and approve. This replaces typing passwords/tokens when pushing. Check:
```bash
gh auth status
```

## 4. Python 3.11
```bash
brew install python@3.11
```
Check (use `python3.11`, not plain `python`):
```bash
python3.11 --version
```

## 5. Node.js 22
```bash
brew install node@22
brew link --overwrite --force node@22
```
Check:
```bash
node --version
npm --version
```

## 6. VS Code
```bash
brew install --cask visual-studio-code
```
Open it from Launchpad. Useful extensions (Cmd+Shift+X, search by name): **Python**, **ES7+ React/Redux snippets**, **Tailwind CSS IntelliSense**, **ESLint** or **Oxc**. To open a folder from Terminal later: `code .`

## 7. Railway CLI (optional)
```bash
brew install railway
railway login
```
Handy later: `railway logs`, `railway variables` (run inside the project folder after `railway link`).

## 8. DB Browser for SQLite (optional) and Chrome
```bash
brew install --cask db-browser-for-sqlite
brew install --cask google-chrome
```

## 9. Claude (optional)
```bash
brew install --cask claude
```
Sign in with the same account to keep your Projects and memory. Claude Code (terminal version): see Anthropic's docs at docs.claude.com for the current install command.

## 10. Get the project onto the Mac
```bash
mkdir -p ~/Projects
cd ~/Projects
gh repo clone iusmaann-cell/tehzeeb-erp
cd tehzeeb-erp
```
(Or unzip the project zip I give you and `cd` into the folder.)

## 11. Run it locally
Open **two Terminal tabs** (Cmd+T for a new tab).

**Tab 1 — backend**
```bash
cd ~/Projects/tehzeeb-erp/backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ADMIN_USERNAME=admin ADMIN_PASSWORD=Admin12345 uvicorn app.main:app --reload --port 8000
```
Leave it running. (Next time you only need `source .venv/bin/activate` and the last line. It creates a local test database file `tehzeeb_erp.db` — this is separate from your live data.)

**Tab 2 — frontend**
```bash
cd ~/Projects/tehzeeb-erp/frontend
npm install
npm run dev
```
Open **http://localhost:5173** in Chrome and sign in with `admin` / `Admin12345`. Stop either one with Ctrl+C.

## 12. Saving and pushing changes (every time)
```bash
cd ~/Projects/tehzeeb-erp
git status                         # see what changed
git add -A
git commit -m "Describe what you changed"
git push origin master             # Railway deploys automatically ~2 minutes later
```
If you instead start from a downloaded zip rather than a clone, do this once inside the unzipped folder:
```bash
git init
git branch -M master
git remote add origin https://github.com/iusmaann-cell/tehzeeb-erp.git
git fetch origin
git reset --soft origin/master
git add -A
git commit -m "Update from zip"
git push origin master
```

## 13. Common problems
- **`command not found: brew`** → run the two "Next steps" lines Homebrew printed, then reopen Terminal.
- **`command not found: python`** → use `python3.11`.
- **Port already in use** → another copy is running; close its Terminal tab, or find it with `lsof -i :8000` and stop it with `kill <PID>`.
- **`pip install` fails on psycopg2-binary** → run `pip install --upgrade pip` and try again.
- **Never commit** `.env`, the `.venv` folder, `node_modules`, or `tehzeeb_erp.db` (the repo's `.gitignore` should skip them; check with `git status` before committing).
