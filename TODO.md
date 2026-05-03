# Fix Plan - Realtime Location Tracker

## Overview
Fix 6 identified bugs in the React/Node.js ZoneRush application.

## TODO Items

### 1. Geolocation Error Handling
- [x] Fix `MapboxMap.jsx` - Add error callback to `triggerSOS()` function
- [x] Fix `RunTracker.jsx` - Add robust error handling to `startTracking()`, auto-retry on transient errors

### 2. Profile Image Loading Issue (uploads path)
- [ ] Fix `server/middleware/secureUpload.js` - Fix path resolution logic for subdirectory uploads
- [ ] Fix `server/routes/users.js` - Ensure consistent full URL response

### 3. App Notifications Not Sending
- [ ] Fix `server/routes/notifications.js` - Add null-check guards for `notificationService`
- [ ] Fix `server/services/notificationService.js` - Fix silent email failures, handle missing preferences

### 4. TILES OWNED Value Not Showing Correct Data
- [ ] Fix `server/services/statsService.js` - Calculate `total_tiles` from `captured_tiles` count

### 5. Profile Name/Location Not Rendering on First Load (Hydration)
- [ ] Fix `client/src/pages/Profile.jsx` - Sync `editData` when `user` loads, consume `loading` state
- [ ] Fix `client/src/context/AuthContext.jsx` - Ensure proper state merging after updates

### 6. Achievements Weekly Reset & Enhancement
- [ ] Fix `server/services/achievementService.js` - Track last reset time, reset weekly stats
- [ ] Fix `server/server.js` - Persist schedule across restarts using DB
- [ ] Fix `server/routes/achievements.js` - Add weekly progress endpoint

## Followup Steps
- [ ] Test file uploads via frontend after path fix
- [ ] Verify stats refresh after tile capture
- [ ] Test notification routes with and without service initialized
- [ ] Verify weekly reset logic with manual trigger

