# 📸 VISUAL GUIDE: Setting Environment Variables in Render

## 🔑 Three Environment Variables You Need

```
EMAIL_USER = your_gmail@gmail.com
EMAIL_PASS = your_app_password_16_chars
SESSION_SECRET = sleep-disorder-admin-secret-2025
```

---

## 📋 STEP-BY-STEP WITH SCREENSHOTS DESCRIPTIONS

### STEP 1️⃣ Go to Render Dashboard
```
URL: https://dashboard.render.com
Look for: Your service name
Service Name: sleep-disorder-prediction-1c3s
```

### STEP 2️⃣ Click on Your Service
```
Dashboard shows all your services
👉 Click on: sleep-disorder-prediction-1c3s
```

### STEP 3️⃣ Navigate to Environment Settings
```
Left sidebar:
├── Overview
├── Deploys
├── Settings  ← CLICK HERE
├── Logs
└── Env. Vars

Or look for "Environment" section on the page
```

### STEP 4️⃣ Click "Add Environment Variable"
```
You should see:
┌─────────────────────────────────────┐
│ Environment Variables               │
├─────────────────────────────────────┤
│ Name          │ Value               │
├─────────────────────────────────────┤
│               │                     │ ← Empty input fields
├─────────────────────────────────────┤
│ [+ Add Variable]                    │ ← CLICK HERE
└─────────────────────────────────────┘
```

### STEP 5️⃣ Add First Variable: EMAIL_USER
```
Field 1 - Name:
📝 Type: EMAIL_USER

Field 2 - Value:
📝 Type: your_gmail_email@gmail.com

Example: bhargaviperam5@gmail.com
```

### STEP 6️⃣ Add Second Variable: EMAIL_PASS
```
Click [+ Add Variable] again

Field 1 - Name:
📝 Type: EMAIL_PASS

Field 2 - Value:
📝 Type: your_16_chars_app_password

Example: sysp idbl isuh wlwh
(This is from Gmail App Passwords)
```

### STEP 7️⃣ Add Third Variable: SESSION_SECRET
```
Click [+ Add Variable] again

Field 1 - Name:
📝 Type: SESSION_SECRET

Field 2 - Value:
📝 Type: sleep-disorder-admin-secret-2025
```

### STEP 8️⃣ Save Changes
```
Look for button at bottom:
[Save Changes] or [Deploy]

OR

Top right corner:
[Deploy] button

👉 CLICK IT
```

### STEP 9️⃣ Monitor Deployment
```
Service will restart with new variables
Status should change:
🟡 Building
🟡 Deploying
🟢 Live (with new env vars)

Takes 2-5 minutes
```

---

## ✅ HOW TO GET GMAIL APP PASSWORD

### 🔐 Gmail 2FA Must Be Enabled First

1. Go to: https://myaccount.google.com/security
2. Look for "2-Step Verification"
3. If OFF → Click to turn ON
4. Follow Gmail's prompts

### 🔑 Generate App Password

1. Go to: https://myaccount.google.com/apppasswords
2. Click dropdown "Select app"
3. Choose: **Mail**
4. Click dropdown "Select device"
5. Choose: **Windows Computer** (or your device)
6. Google shows you a 16-character password
7. Copy entire password (spaces included!)

Example format:
```
sysp idbl isuh wlwh
```

---

## 🧪 TEST AFTER SETUP

### Test Registration OTP
```
1. Go to: https://sleep-disorder-prediction-1c3s.onrender.com
2. Click [REGISTER] button
3. Fill in: Name, Email, Phone, Password
4. Click [Send OTP]
5. Check your email inbox (refresh if needed)
6. Look for email from: noreply@...
7. Copy OTP code
8. Paste in app
9. See ✅ "Email verified successfully!"

If YES → 🎉 WORKING!
If NO → Check Gmail App Password
```

### Test Admin Password Reset
```
1. Go to: /admin-login
2. Click "Forgot Password?"
3. Enter admin email
4. Click [SEND OTP]
5. Check email for OTP
6. Paste OTP
7. Enter new password
8. See ✅ "Password reset successfully!"

If YES → 🎉 WORKING!
```

---

## ⚠️ COMMON MISTAKES

| ❌ Wrong | ✅ Correct |
|---------|-----------|
| Using regular Gmail password | Using 16-char App Password |
| `EMAIL_PASS = mypassword` | `EMAIL_PASS = sysp idbl isuh wlwh` |
| Missing spaces in App Password | Include spaces as shown by Google |
| Render env vars not saved | Click "Save Changes" explicitly |
| Service not redeployed | Click "Manual Deploy" after saving |
| Wrong email in EMAIL_USER | Copy-paste exact Gmail address |

---

## 🔍 VERIFY VARIABLES WERE SAVED

### After deployment completes:

1. Go to your service in Render
2. Click "Settings"
3. Scroll to "Environment"
4. You should see:
   ```
   EMAIL_USER     your_gmail@gmail.com
   EMAIL_PASS     [hidden as •••••••]
   SESSION_SECRET sleep-disorder-admin-secret-2025
   ```

If you see these → ✅ Variables saved!

---

## 📱 MOBILE APP TEST

If using mobile app:
```
1. Open app
2. Go to Register
3. Enter email
4. Tap "Send OTP"
5. Check Gmail inbox
6. OTP received within 5-10 seconds

If instant → 🎉 Good!
If takes 30+ seconds → Check logs
If never arrives → Check EMAIL_USER and EMAIL_PASS
```

---

## 📞 IF SOMETHING GOES WRONG

### Check Render Logs
1. Go to Service → Logs
2. Look for error messages like:
   - `Error sending email`
   - `Invalid credentials`
   - `EAUTH Gmail`
3. Fix the error based on message

### Check Gmail App Password
1. Go to: https://myaccount.google.com/apppasswords
2. Make sure you generated it correctly
3. Copy it again carefully (including spaces)

### Restart Service
1. Go to Render Service
2. Click "Services"
3. Find your service
4. Click "..." menu
5. Select "Restart"

---

## 🎯 CHECKLIST BEFORE TESTING

- [ ] 2FA enabled on Gmail
- [ ] App Password generated from Gmail
- [ ] EMAIL_USER set in Render
- [ ] EMAIL_PASS set in Render (16 chars with spaces)
- [ ] SESSION_SECRET set in Render
- [ ] Clicked "Save Changes"
- [ ] Clicked "Manual Deploy"
- [ ] Waited for deployment to complete (🟢 Live)
- [ ] Tested registration OTP

✅ All checked? Ready to deploy! 🚀
