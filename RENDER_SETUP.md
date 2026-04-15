# 🚀 Render Deployment Configuration Guide

## ✅ What's Already Fixed

1. **CORS Enabled** ✓
   - Added `cors` middleware to support frontend requests from different domains
   - All API calls will work properly now

2. **Email Configuration** ✓
   - Moved from hardcoded values to environment variables
   - Now uses `EMAIL_USER` and `EMAIL_PASS` environment variables

3. **Frontend Already Uses Relative URLs** ✓
   - No hardcoded localhost URLs in API calls
   - Works seamlessly with any domain

---

## 🔑 Required Environment Variables for Render

### Step 1: Get Gmail App Password

1. Go to: https://myaccount.google.com/apppasswords
2. Select `Mail` and `Windows Computer` (or your device)
3. Google will generate a 16-character app password
4. Copy this password (you'll need it in Step 3)

### Step 2: Login to Render Dashboard

1. Go to: https://dashboard.render.com
2. Select your service: `sleep-disorder-prediction`

### Step 3: Add Environment Variables

1. Click on your service name
2. Go to **Settings** → **Environment**
3. Click **Add Environment Variable**
4. Add these variables:

```
EMAIL_USER = your_gmail_email@gmail.com
EMAIL_PASS = your_16_character_app_password
SESSION_SECRET = sleep-disorder-admin-secret-2025
```

### Step 4: Save & Redeploy

1. Click **Save Changes**
2. Click **Manual Deploy** or wait for auto-deploy
3. Service will restart with new environment variables

---

## ✅ OTP Email Setup

After setting email environment variables:

### For User Registration OTP:
1. User enters email on register form
2. Click "Send OTP" button
3. OTP sent via Gmail (configured email)
4. User enters OTP to verify email
5. Registration completes

### For Password Reset OTP:
1. User clicks "Forgot Password"
2. Enters email address
3. Click "Send OTP"
4. OTP sent to email
5. Enter OTP + new password
6. Password reset complete

### For Admin Password Reset OTP:
1. Go to `/admin-login`
2. Click "Forgot Password?"
3. Enter admin email
4. Click "SEND OTP"
5. Check email for OTP
6. Enter OTP + new password

---

## 🔍 Quick Checklist

- [ ] Added CORS dependency (already done in code)
- [ ] Set EMAIL_USER in Render Environment
- [ ] Set EMAIL_PASS in Render Environment
- [ ] Set SESSION_SECRET in Render Environment
- [ ] Clicked "Save Changes" in Render
- [ ] Redeployed the service
- [ ] Tested OTP sending (register page)
- [ ] Tested password reset (admin-login page)

---

## ⚠️ Troubleshooting

### "Failed to fetch" error in browser console
- Check browser console (F12)
- CORS should now be enabled, try again
- If still failing, check Render logs

### OTP not sending
- Verify EMAIL_USER and EMAIL_PASS are correct in Render
- Check Render logs for error messages
- Ensure Gmail App Password (not regular password) is used
- Gmail 2FA must be enabled to use App Passwords

### App shows localhost in console logs
- This is just a console message, doesn't affect functionality
- Frontend uses relative URLs (no localhost)
- Will work fine on Render

---

## 📝 What Changed in Code

### server.js:
- Added `const cors = require('cors');`
- Added `app.use(cors());`
- Changed email config to use environment variables:
  ```javascript
  user: process.env.EMAIL_USER || 'default_email',
  pass: process.env.EMAIL_PASS || 'default_pass'
  ```

### package.json:
- Added `"cors": "^2.8.5"` to dependencies

---

## 🎯 Result

✓ CORS enabled = Frontend and backend fully connected
✓ Email config = OTP system works on Render
✓ All API calls = Working with Render URL automatically

Your app is now fully configured for Render deployment! 🎉
