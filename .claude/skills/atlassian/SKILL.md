---
name: atlassian
description: "Interact with self-hosted Jira and Confluence Server APIs for project management, issue tracking, and documentation. Use this skill when you need to: (1) Search or manage Jira issues, projects, and boards, (2) Search or manage Confluence pages and spaces, (3) Create, update, or transition Jira issues, (4) Create or update Confluence documentation, or (5) Perform any Jira/Confluence API operations."
---

# Atlassian (Jira & Confluence Server)

This skill provides interaction with self-hosted Jira Server and Confluence Server REST APIs.

## Configuration

Set the following environment variables before use:

| Variable | Description |
|----------|-------------|
| `JIRA_PERSONAL_TOKEN` | Personal access token for Jira API |
| `CONFLUENCE_PERSONAL_TOKEN` | Personal access token for Confluence API |
| `JIRA_URL` | Jira instance base URL (e.g. `https://jira.example.com/jira`) |
| `CONFLUENCE_URL` | Confluence instance base URL (e.g. `https://wiki.example.com/confluence`) |

### Creating Personal Access Tokens

1. Go to your profile settings in Jira or Confluence
2. Navigate to **Personal Access Tokens**
3. Click **Create token**, set a name and expiry
4. Copy the token value into the environment variable

## Usage

### Confluence: Fetch a page by URL

```python
from scripts.confluence_api import get_page_by_url

page = get_page_by_url('https://wiki.example.com/confluence/spaces/TEAM/pages/123456/My+Page')
print(page['title'])
print(page['body']['storage']['value'])
```

### Confluence: Search pages

```python
from scripts.confluence_api import search_content

results = search_content('space = "DOCS" AND type = page AND title ~ "architecture"')
for page in results['results']:
    print(f"{page['id']}: {page['title']}")
```

### Jira: Search issues

```python
from scripts.jira_api import search_issues

results = search_issues('project = MYPROJECT AND status = "In Progress"')
for issue in results['issues']:
    print(f"{issue['key']}: {issue['fields']['summary']}")
```

## Document Import Integration

The `document-import` MCP server uses `CONFLUENCE_PERSONAL_TOKEN` and `CONFLUENCE_URL` automatically when fetching Confluence pages via the `fetch_confluence_page` tool. No extra configuration needed beyond setting these env vars.

## References

- [scripts/confluence_api.py](scripts/confluence_api.py) — Confluence API functions
- [scripts/jira_api.py](scripts/jira_api.py) — Jira API functions
