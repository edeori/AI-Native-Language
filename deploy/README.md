# Remote MCP Deployment

This folder contains helper scripts for syncing the build inputs to a remote host and running the MCP servers there with Docker Compose.

## Assumptions

- the remote host has Docker and Docker Compose installed
- SSH key-based access is available
- the remote host can expose ports `3001`, `3002`, `3003`, and `3004`
- the remote host can create and use `/srv/ai-native-language-mcp`
- `rsync` is preferred for sync; the script falls back to a tar-over-SSH transfer if needed

## Default model

- local development uses Docker Compose on the developer machine if Docker is available
- remote deployment syncs only the build inputs to `/srv/ai-native-language-mcp`
- remote deployment runs `docker compose -f /srv/ai-native-language-mcp/docker/compose.yaml up -d --build`
- the extension points at the remote Streamable HTTP endpoints

## Scripts

- `remote-sync-and-start.sh`: sync the repository and start or rebuild the MCP stack on the remote host
- `remote-mcp-start.sh`: compatibility wrapper around `remote-sync-and-start.sh`
- `remote-mcp-stop.sh`: stop the MCP stack on the remote host
- `remote-mcp-status.sh`: show running containers and compose status on the remote host
- `build-and-push-images.sh`: compatibility wrapper around `remote-sync-and-start.sh`

## Example

```bash
REMOTE_HOST=10.9.0.2 REMOTE_USER=myuser \
  ./deploy/remote-sync-and-start.sh
```

The sync script copies only the build inputs to `/srv/ai-native-language-mcp`, preserves the remote `.ai-native/` artifact directory, and runs `docker compose up -d --build` on the remote host.

If you prefer the older command names, `remote-mcp-start.sh` and `build-and-push-images.sh` still work as aliases.
