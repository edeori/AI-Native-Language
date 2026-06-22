# Plugin Installation Guide

This document describes how to build the VSCode extension from this repository and install it manually as a `.vsix` package.

## Goal

Use this flow when you want to:

- test the extension in another VSCode installation
- install it into a company-managed VSCode
- share a build with another internal user

## What gets built

The VSCode extension lives under:

- `vscode-extension/`

The compiled extension entrypoint is:

- `vscode-extension/out/extension.js`

The extension is packaged as a standard VSCode `.vsix` archive.

## Prerequisites

You need:

- Node.js
- npm
- a local clone of this repository

Recommended:

- the same major VSCode version range expected by the extension
- internet access for the first `npm install`

## Build the extension

From the repository root:

```bash
npm install
npm run build:vscode-extension
```

This compiles the extension sources under `vscode-extension/`.

## Package the extension as `.vsix`

From the repository root:

```bash
cd vscode-extension
npx @vscode/vsce package
```

This creates a file similar to:

```bash
ai-native-semantic-workflow-0.1.0.vsix
```

If `vsce` is not installed globally, `npx` is enough.

## Install the `.vsix` in VSCode

### Option 1: Install from the UI

1. Open VSCode
2. Open the Extensions view
3. Open the `...` menu in the Extensions panel
4. Choose `Install from VSIX...`
5. Select the generated `.vsix` file

### Option 2: Install from the command line

```bash
code --install-extension ai-native-semantic-workflow-0.1.0.vsix
```

If your VSCode binary is not `code`, use the correct launcher path from your environment.

## Updating the extension

When you make changes:

1. rebuild the extension
2. create a new `.vsix`
3. reinstall it in VSCode

Practical rebuild flow:

```bash
npm run build:vscode-extension
cd vscode-extension
npx @vscode/vsce package
code --install-extension ai-native-semantic-workflow-0.1.0.vsix --force
```

## Runtime dependencies

The extension package installs the UI and client logic, but most useful features depend on MCP services being reachable.

Default MCP endpoints:

- `http://localhost:3001/mcp` for `semantic-core`
- `http://localhost:3002/mcp` for `validator`
- `http://localhost:3003/mcp` for `compiler`
- `http://localhost:3004/mcp` for `java-parser`

If these services are not running, the extension can still load, but the workflow actions depending on them will fail.

## Run the MCP services locally

From the repository root, start the services in separate terminals:

```bash
npm run dev:http:semantic-core
npm run dev:http:validator
npm run dev:http:compiler
npm run dev:http:java-parser
```

## Configure the extension after install

After installation, open the extension settings and verify:

- semantic-core URL
- validator URL
- compiler URL
- java-parser URL
- artifact root
- Java base package

If your company environment hosts MCP services remotely, replace the default localhost URLs with the company endpoints.

## Common issues

### The extension installs, but actions fail

Usually this means one of these is true:

- the MCP services are not running
- the configured MCP URLs are wrong
- the company environment blocks local or remote HTTP access

### `vsce package` fails

Typical causes:

- dependencies are not installed
- TypeScript build has not completed
- packaging tool dependencies are missing locally

Retry with:

```bash
npm install
npm run build:vscode-extension
cd vscode-extension
npx @vscode/vsce package
```

### The installed version does not seem to change

Use forced reinstall:

```bash
code --install-extension ai-native-semantic-workflow-0.1.0.vsix --force
```

You may also need to reload the VSCode window.

## Recommended internal distribution

For internal testing, the simplest path is:

1. build the `.vsix`
2. store it in your company artifact share or internal chat/thread
3. provide the MCP endpoint configuration together with the file

That is enough for controlled pilot testing without publishing to a public marketplace.
