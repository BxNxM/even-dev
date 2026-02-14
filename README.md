# Even Hub Demo App (Beta)

## Overview

This project is a minimal example application for the Even Hub platform designed to run without real hardware using the Even Hub Simulator.

The app demonstrates:

* Basic Even Hub app structure
* TypeScript-based development workflow
* Integration with the official Even Hub SDK
* Optional use of the community "even-better" SDK abstraction
* Local development using Vite
* Running and testing inside the Even Hub Simulator

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

Start the development environment using:

```
./start-even.sh
```

This script will:

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
* Communication with Even devices occurs through the Even App Bridge.
* Simulator development allows testing without physical hardware.

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


git push -u origin main
