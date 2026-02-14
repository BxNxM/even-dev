# Even Hub Demo App (Beta)

![demo](./media/demo.png)

This project is a minimal starter app for building and testing Even Hub interactions in the Even Hub Simulator, without a physical Even device.

## Overview

This project is a minimal Even Hub example that works with the Even Hub Simulator and does not require a real device.

The app demonstrates:

* Basic Even Hub app structure
* TypeScript development with Vite
* Integration via `@jappyjan/even-better-sdk`
* Simulator-first workflow (no real device required)

The goal of this repository is to provide a simple starting point for building Even Hub applications while keeping the architecture easy to understand and extend.

---

## ⚠️ Beta Status

This project is currently in **beta**.

Expect:

* Incomplete features
* Possible breaking changes
* Experimental structure that may evolve
* Limited error handling

Use this project as a learning example or development baseline rather than production-ready code.

---

## Requirements

* Node.js
* npm
* Even Hub Simulator
* Even Hub CLI (optional)

---

## Setup

Install dependencies:

```
npm install
```

---

## Running the App

Use this flow:

```
npm install
./start-even.sh
```

Then:

1. Open the app in your browser.
2. Click **Connect**.
3. If bridge mode is available, the simulator renders the startup page.
4. Use simulator controls (Up, Down, Click, DoubleClick) to generate events.
5. Click **Demo Action** to send a sample action.

You can also run only the web app with:

```
npm run dev
```

`./start-even.sh` remains the recommended full environment because it will:

* Verify required dependencies
* Install missing packages if needed
* Start the Vite development server
* Launch the Even Hub Simulator

---

## Project Structure

```
index.html      -> Entry point required by Even Hub
src/Main.ts     -> Application bootstrap logic
src/even.ts     -> Even SDK integration layer
src/ui.ts       -> UI helpers
vite.config.ts  -> Development server configuration
```

---

## Development Notes

* The app behaves like a standard web application.
* Communication with Even Hub happens through the Even App Bridge.
* In normal browser mode (without bridge), the app falls back to a mock mode so the UI still runs.
* In simulator mode, pressing **Connect** renders a basic demo page in the Hub simulator.
* Input events are rendered in the simulator page and logged to the browser console for debugging.

---

## Disclaimer

This is a minimal example project intended for experimentation and learning. APIs and structure may change as the Even ecosystem evolves.

## Even developer packages

* CLI Tool: https://www.npmjs.com/package/@evenrealities/evenhub-cli
* SDK Core: https://www.npmjs.com/package/@evenrealities/even_hub_sdk
* evenbetter SDK - a more abstracted SDK made by community member @JappyJan
https://www.npmjs.com/package/@jappyjan/even-better-sdk
* UIUX guideline: https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782&t=ZIxZJDitnBnZJOwb-1
* (SUPER ROUGH) Demo app: https://github.com/even-realities/EH-InNovel
* Simulator: https://www.npmjs.com/package/@evenrealities/evenhub-simulator

## GitHub Hints

git push -u origin main
