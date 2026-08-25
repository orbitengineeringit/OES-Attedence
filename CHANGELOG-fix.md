# Changelog: Attendance Fluctuation Fixes

- `src/views/BiometricScanner.jsx`: Fixed `mountedRef` typo to `isComponentMounted` to prevent cooldown interval crash and camera freeze.
- `src/views/PublicAttendanceScanner.jsx`: Deferred resetting `scanInProgressRef` until the end of the 5-second cooldown to fix stale closure infinite loop spamming scans.
- `src/services/api.js`: Added 60-second minimum cooldown check in both `/attendance/scan` and `/attendance/public-scan` endpoints to prevent immediate, accidental CHECK_OUT when an employee stands in front of the camera right after CHECK_IN.
