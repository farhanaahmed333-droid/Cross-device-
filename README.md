# Cross-device Connect

A mobile-friendly room-pairing app for connecting two or more devices and exchanging live messages over a secure WebSocket connection.

## Use it

1. Open the deployed app on the first device.
2. Tap **Create a new room**.
3. Copy or share the 8-character pairing code.
4. Open the same app on the second device and enter that code.
5. Send a message; it appears live on every connected device in that room.

The pairing code is generated randomly by the server. Rooms are kept briefly after the last device disconnects so a temporary network drop does not immediately destroy the room.

## Run locally

Requires Node.js 18 or newer.

\`\`\`bash
npm install
npm test
npm start
\`\`\`

Open \`http://localhost:3000\` in two browser windows or devices on the same network. Both devices must use the same server address and pairing code.

## Deploy

The Render web service runs \`node server.js\` and serves both the web app and WebSocket endpoint from the same origin. HTTPS/WSS is used automatically on the hosted site. The \`/health\` endpoint provides a simple service health check.

## Android APK

The GitHub Actions workflow at \`.github/workflows/android-apk.yml\` builds a Capacitor Android debug APK. It runs on pushes to \`main\` and can also be started manually from the Actions tab.

After a successful workflow:
1. Open the completed **Build Android APK** workflow run.
2. Download the \`cross-device-connect-debug-apk\` artifact.
3. Extract \`app-debug.apk\` and install it on an Android device.

The Android wrapper connects to \`wss://cross-device-connect.onrender.com\`.

## Security and limitations

- The hosted connection uses HTTPS/WSS encryption in transit.
- Messages are **not end-to-end encrypted** and the service is not designed for secrets or sensitive personal data.
- A pairing code is a temporary room key, not an identity or account login.
- Messages are live and are not stored as chat history.
- Keep the app and server updated before using it beyond testing.


## Claude voice companion and device calls (feature branch)

The `feature/voice-video-ai` branch adds:
- A text conversation endpoint at `POST /api/ai-chat` that calls the Claude Messages API.
- Browser speech recognition and speech synthesis controls for spoken interaction with Arham. Support varies by browser and Android WebView.
- WebRTC audio/video calling between two devices paired in the same room, using the existing WebSocket room as signaling.

### Required server configuration

Set `ANTHROPIC_API_KEY` as a **secret environment variable** on the Render web service. Never put the key in frontend JavaScript, GitHub source, chat messages, or a public file. The default model is `claude-sonnet-5-5`; it can be changed with `ANTHROPIC_MODEL`.

Claude API calls require an active Anthropic API balance/credits. Creating a key alone does not fund API usage. The voice UI uses the browser's built-in speech recognition and speech synthesis; it is not a native full-duplex Claude audio API session.

### Calling limitations

WebRTC uses public STUN servers. Some mobile networks and restrictive NATs require a TURN relay server, which is not configured in this prototype. Camera and microphone permissions are required, and calls need exactly two devices in the same room.
