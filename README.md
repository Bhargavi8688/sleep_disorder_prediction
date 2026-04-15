# Sleep Disorder Website

## Local Setup and Run

### Prerequisites
- Node.js 20 LTS or newer
- npm (comes with Node.js)

### Option 1: Quick Setup Scripts

#### Windows (Command Prompt)
1. Open Command Prompt in the project folder.
2. Run setup:
	`scripts\\setup-local.bat`
3. Start website:
	`scripts\\run-local.bat`
4. Open browser:
	`http://localhost:3000`

#### Linux/macOS
1. Open terminal in the project folder.
2. Make scripts executable (one-time):
	`chmod +x scripts/setup-local.sh scripts/run-local.sh`
3. Run setup:
	`./scripts/setup-local.sh`
4. Start website:
	`./scripts/run-local.sh`
5. Open browser:
	`http://localhost:3000`

### Option 2: Manual Commands
1. Install dependencies:
	`npm install`
2. Start website:
	`npm start`
3. Open browser:
	`http://localhost:3000`

### Troubleshooting
- If you get `Cannot find module 'nodemailer'`, run:
  `npm install nodemailer --save`
- If install is broken, clean and reinstall:
  - Windows:
	 `rmdir /s /q node_modules && del package-lock.json && npm install`
  - Linux/macOS:
	 `rm -rf node_modules package-lock.json && npm install`