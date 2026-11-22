# Daybook

Daybook is a modern way to keep a diary. Record everyday moments in an activity calendar, search past entries, and set one-time or recurring reminders. The desktop app works offline and keeps your data on your device. It opens with an editable example entry about catching up with an old friend.

## Open Daybook

Open [Desktop builds](https://github.com/Dhanvandri/daybook/actions), select a successful **Build Daybook Desktop** run, and download the artifact for your computer. Sign in to GitHub to download workflow artifacts. Unzip the artifact before opening the installer inside it.

| Computer | Build artifact | How to open it |
| --- | --- | --- |
| Windows x64 | `Daybook-Windows-x64` | Run the `.exe` installer and open Daybook from Start. |
| macOS with Apple silicon | `Daybook-macOS-arm64` | Open the `.dmg` and drag Daybook to Applications. |
| macOS with an Intel processor | `Daybook-macOS-x64` | Open the `.dmg` and drag Daybook to Applications. |
| Linux x64 | `Daybook-Linux-x64` | Make the `.AppImage` executable and run it. |

Windows builds are unsigned. macOS builds use ad-hoc signing and aren't notarized. Your operating system may warn you or block the downloaded package. If it does, use the source commands below. Linux AppImages require FUSE on most distributions. On supported builds, `./Daybook-<version>-linux-x86_64.AppImage --appimage-extract-and-run` is another way to start the app if FUSE is unavailable. Replace the placeholder with the package filename.

## Keep a diary and manage reminders

- Choose a calendar date, write an activity, and optionally add a time and category. Use search to find an older entry.
- Choose a local date and time for a one-time, daily, or weekly reminder. Daybook checks while open or minimized. Native banners depend on your notification settings. Closing the last window quits the app on Windows and Linux. On macOS, it stays running until you choose **Quit Daybook**.
- For alerts when Daybook has quit, export **Calendar (.ics)** and import the file into a calendar app that supports imported alarms.
- Daybook switches to dark mode at 6 p.m. and back to light mode at 6 a.m. in your local time.

## Back up and move your data

Click **Save backup** to export a JSON file with activities and reminders. Click **Import** to merge a version 1 or 2 backup into another Daybook installation. Import matches records by ID and retains other records already present. Use **CSV** for a spreadsheet of activities. Keep personal exports outside the repository.

The desktop app writes `daybook-data.json` to Electron's local application data folder. The browser edition uses a separate browser profile. For a local browser version, open the root [index.html](index.html). Use JSON backup and import to move between the two editions.

## Run and test from source

Install Node.js 24 and npm. Clone or download this repository and run the following in its root directory.

```sh
npm ci
npm test
npm start
```

Initial setup downloads Electron and the build tools. Use `npm run smoke` from a graphical session for the Electron integration check. The GitHub Actions workflow runs unit tests and the smoke test before packaging each target. The smoke test uses temporary data.

## Package locally

Run the command for your operating system and architecture. Packages are written to `dist/`.

```sh
npm run dist -- --win --x64
npm run dist -- --mac --arm64
npm run dist -- --mac --x64
npm run dist -- --linux --x64
```

The GitHub Actions workflow also supports manual runs from **Actions → Build Daybook Desktop → Run workflow**. For general macOS distribution, configure Developer ID Application signing and notarization before packaging. [Electron Builder signing documentation](https://www.electron.build/v26/docs/mac/)

The landing page source is in [docs/](docs/). GitHub Pages publishes the `/docs` folder from `main`.
