# Admin Password Reset Feature with Mail OTP

## Overview
Added password reset functionality to the admin login page using mail-based OTP (One-Time Password) verification. This feature allows hospital admin staff to securely reset their passwords if forgotten.

## Changes Made

### 1. **Admin Login Page UI Enhancement** (`/admin-login`)
   - Added **"Forgot Password?"** link on the login page
   - New password reset form with email input
   - OTP verification section (visible after OTP is sent)
   - New password input field
   - Styled to match existing dark theme with blue accent color (#3498db)

### 2. **Frontend JavaScript Functions**
   - **`showForgotPassword()`** - Displays password reset form
   - **`hideForgotPassword()`** - Returns to login screen
   - **`sendAdminResetOTP()`** - Sends request to backend to generate and email OTP
   - **`resetAdminPassword()`** - Submits new password with OTP verification

### 3. **Backend Endpoints Added**

#### **POST `/admin-send-reset-otp`**
- **Purpose:** Generate and send OTP to admin email
- **Request Parameters:**
  - `email` (string, required) - Admin's email address
- **Validation:**
  - Checks if email exists in `admin_database.json`
  - Generates 6-digit random OTP
  - Stores OTP with timestamp
- **Response:**
  - `{ success: true, message: 'OTP sent to email' }` - OTP sent successfully
  - `{ success: false, message: '...' }` - Error occurred
- **Email Content:** Contains OTP and security warning

#### **POST `/admin-reset-password`**
- **Purpose:** Verify OTP and reset admin password
- **Request Parameters:**
  - `email` (string, required) - Admin's email
  - `otp` (string, required) - 6-digit OTP received via email
  - `newPassword` (string, required) - New password (min 8 characters)
- **Validations:**
  - OTP must match and be within 5-minute validity window
  - Password must be at least 8 characters
  - Admin must exist in database
- **Response:**
  - `{ success: true, message: 'Password reset successfully' }` - Password updated
  - `{ success: false, message: '...' }` - Specific error message
- **Security:**
  - OTP expires after 5 minutes (300,000 ms)
  - Password is bcrypt-hashed before storing
  - OTP is cleared after successful reset

### 4. **Storage & Security**
- **OTP Storage:** In-memory with timestamp tracking (`adminResetOTP` object)
- **Database:** Uses existing `admin_database.json` for admin credentials
- **Hashing:** Bcryptjs used for password hashing
- **Email Service:** Uses configured Gmail account via Nodemailer
- **Expiration:** OTPs valid for 5 minutes only

### 5. **Database Schema (admin_database.json)**
```json
[
  {
    "name": "admin_name",
    "email": "admin@hospital.com",
    "password": "bcrypt_hashed_password"
  }
]
```

## Flow Diagram

```
User clicks "Forgot Password?"
         ↓
Admin enters email address
         ↓
Click "SEND OTP" button
         ↓
/admin-send-reset-otp endpoint
  - Validates email exists in admin_database.json
  - Generates 6-digit OTP
  - Sends email
  - Stores OTP with timestamp
         ↓
User receives OTP email
         ↓
User enters OTP + new password
         ↓
Click "RESET PASSWORD" button
         ↓
/admin-reset-password endpoint
  - Validates OTP matches & not expired
  - Validates password strength (8+ chars)
  - Updates admin password in database
  - Bcrypt hashes new password
  - Clears OTP
         ↓
Success message displayed
         ↓
User redirected to login page
```

## Usage Instructions for Admins

1. **On Admin Login Page:**
   - Click "Forgot Password?" link (blue text below password field)

2. **On Password Reset Page:**
   - Enter your official hospital email address
   - Click "SEND OTP" button
   - Check your email for 6-digit OTP

3. **Verify and Reset:**
   - Enter the 6-digit OTP received via email
   - Enter your new password (minimum 8 characters)
   - Click "RESET PASSWORD" button

4. **Return to Login:**
   - After successful password reset
   - Click "Back to Login" link
   - Login with email and new password

## Security Features

✓ OTP expires after 5 minutes
✓ One-time use OTP (cleared after reset)
✓ Bcrypt password hashing
✓ Database validation (email must exist in admin_database.json)
✓ Minimum password length enforcement (8 characters)
✓ Email-based verification (only admin with email access can reset)
✓ Timestamp tracking for OTP expiration

## No Breaking Changes

- Existing admin login functionality unchanged
- Master Recovery Key (MASTER RESET KEY) still available
- All previous endpoints remain functional
- Database structure remains the same
- Email configuration uses existing Nodemailer setup

## Testing

### Test Credentials (from admin_database.json)
- **Email:** bhargavi@a1hospital.com
- **Purpose:** Password reset testing

### To Test:
1. Start server: `npm start`
2. Navigate to: http://localhost:3000/admin-login
3. Click "Forgot Password?"
4. Enter email: `bhargavi@a1hospital.com`
5. Check console/email for OTP
6. Enter OTP and new password
7. Password should be reset successfully

## Email Configuration
- **Service:** Gmail SMTP
- **From Email:** bhargaviperam5@gmail.com
- **Subject:** "Hospital Admin - Password Reset OTP"
- **Message:** Contains 6-digit OTP and security notice

## Error Handling

The system handles various error scenarios:
- Email not registered as admin → "Email not registered as admin"
- Admin database not found → "Admin database not found"
- Invalid OTP → "Invalid OTP"
- Expired OTP → "OTP expired. Please request a new one."
- Weak password → "Password must be at least 8 characters"
- Admin not found in database → "Admin not found"
- Email sending failed → "Error sending OTP"

## Files Modified

- **server.js**
  - Added `adminResetOTP` variable (line ~1019)
  - Updated `/admin-login` GET endpoint with new UI (lines 878-970)
  - Added `/admin-send-reset-otp` POST endpoint (lines 1208-1241)
  - Added `/admin-reset-password` POST endpoint (lines 1243-1289)

## Compatibility

- Uses existing Node.js dependencies:
  - `nodemailer` - Email sending
  - `bcryptjs` - Password hashing
  - `express` - Server framework
- No new npm packages required
- Compatible with existing database structure
