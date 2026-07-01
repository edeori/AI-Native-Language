"""
Jira Server API Functions

This module provides comprehensive functions for interacting with Jira Server REST API.
All functions require proper authentication via environment variables.

Required environment variables:
    JIRA_PERSONAL_TOKEN  — Personal access token
    JIRA_URL             — Base URL (e.g. https://jira.example.com/jira)

Example:
    >>> from jira_api import search_issues, get_issue, create_issue
    >>> results = search_issues('project = MYPROJECT AND status = "In Progress"')
    >>> issue = get_issue('MYPROJECT-1')
"""

import os
import requests
from typing import Optional, Dict, List, Any

# =============================================================================
# Configuration
# =============================================================================

JIRA_TOKEN = os.environ.get('JIRA_PERSONAL_TOKEN')
JIRA_URL = os.environ.get('JIRA_URL', '').rstrip('/')
JIRA_API = f"{JIRA_URL}/rest/api/2"

# Headers for Jira requests
jira_headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {JIRA_TOKEN}'
}


# =============================================================================
# Issue Operations
# =============================================================================

def search_issues(
    jql: str,
    start_at: int = 0,
    max_results: int = 50,
    fields: Optional[List[str]] = None,
    expand: Optional[List[str]] = None
) -> Dict:
    """Search for issues using JQL.

    Args:
        jql: JQL query string
        start_at: Index of first result (for pagination)
        max_results: Maximum results to return (max 1000)
        fields: List of fields to return (None for default fields)
        expand: List of fields to expand (e.g., ['changelog', 'renderedFields'])

    Returns:
        Dict containing 'issues', 'total', 'startAt', 'maxResults'

    Example:
        >>> results = search_issues('project = MYPROJECT AND status = "In Progress"')
        >>> results = search_issues('assignee = currentUser() AND resolution = Unresolved')
        >>> results = search_issues('created >= -7d ORDER BY created DESC')
    """
    url = f"{JIRA_API}/search"
    params = {
        'jql': jql,
        'startAt': start_at,
        'maxResults': max_results
    }
    if fields:
        params['fields'] = ','.join(fields)
    if expand:
        params['expand'] = ','.join(expand)

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def get_issue(
    issue_key: str,
    fields: Optional[List[str]] = None,
    expand: Optional[List[str]] = None
) -> Dict:
    """Get a single issue by key.

    Args:
        issue_key: Issue key (e.g., 'MYPROJECT-1')
        fields: Specific fields to return
        expand: Fields to expand (e.g., ['changelog', 'renderedFields', 'transitions'])

    Returns:
        Dict containing issue data with 'key', 'fields', etc.
    """
    url = f"{JIRA_API}/issue/{issue_key}"
    params = {}
    if fields:
        params['fields'] = ','.join(fields)
    if expand:
        params['expand'] = ','.join(expand)

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def create_issue(
    project_key: str,
    issue_type: str,
    summary: str,
    description: str = '',
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    labels: Optional[List[str]] = None,
    components: Optional[List[str]] = None,
    custom_fields: Optional[Dict] = None
) -> Dict:
    """Create a new issue.

    Args:
        project_key: Project key (e.g., 'MYPROJECT')
        issue_type: Issue type name (e.g., 'Bug', 'Story', 'Task', 'Epic')
        summary: Issue summary/title
        description: Issue description (supports Jira wiki markup)
        priority: Priority name (e.g., 'High', 'Medium', 'Low')
        assignee: Username of assignee
        labels: List of labels
        components: List of component names
        custom_fields: Dict of custom field IDs to values

    Returns:
        Dict containing 'id', 'key', 'self' (URL)
    """
    url = f"{JIRA_API}/issue"

    data = {
        'fields': {
            'project': {'key': project_key},
            'issuetype': {'name': issue_type},
            'summary': summary,
            'description': description
        }
    }

    if priority:
        data['fields']['priority'] = {'name': priority}
    if assignee:
        data['fields']['assignee'] = {'name': assignee}
    if labels:
        data['fields']['labels'] = labels
    if components:
        data['fields']['components'] = [{'name': c} for c in components]
    if custom_fields:
        data['fields'].update(custom_fields)

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()
    return response.json()


def update_issue(
    issue_key: str,
    fields: Optional[Dict] = None,
    update: Optional[Dict] = None,
    notify_users: bool = True
) -> None:
    """Update an issue.

    Args:
        issue_key: Issue key (e.g., 'MYPROJECT-1')
        fields: Fields to set (replaces values)
        update: Fields to update (add/remove/set operations)
        notify_users: Whether to send notifications

    Example - Set fields:
        >>> update_issue('MYPROJECT-123', fields={'summary': 'New title', 'priority': {'name': 'High'}})

    Example - Add label:
        >>> update_issue('MYPROJECT-123', update={'labels': [{'add': 'urgent'}]})

    Example - Add comment:
        >>> update_issue('MYPROJECT-123', update={'comment': [{'add': {'body': 'My comment'}}]})
    """
    url = f"{JIRA_API}/issue/{issue_key}"
    params = {'notifyUsers': notify_users}

    data = {}
    if fields:
        data['fields'] = fields
    if update:
        data['update'] = update

    response = requests.put(url, headers=jira_headers, json=data, params=params)
    response.raise_for_status()


def delete_issue(issue_key: str, delete_subtasks: bool = False) -> None:
    """Delete an issue.

    Args:
        issue_key: Issue key
        delete_subtasks: Whether to delete subtasks
    """
    url = f"{JIRA_API}/issue/{issue_key}"
    params = {'deleteSubtasks': delete_subtasks}

    response = requests.delete(url, headers=jira_headers, params=params)
    response.raise_for_status()


def assign_issue(issue_key: str, username: Optional[str] = None) -> None:
    """Assign an issue to a user.

    Args:
        issue_key: Issue key
        username: Username to assign to (None to unassign)
    """
    url = f"{JIRA_API}/issue/{issue_key}/assignee"
    data = {'name': username} if username else {'name': None}

    response = requests.put(url, headers=jira_headers, json=data)
    response.raise_for_status()


# =============================================================================
# Transition Operations
# =============================================================================

def get_transitions(issue_key: str) -> Dict:
    """Get available transitions for an issue.

    Args:
        issue_key: Issue key

    Returns:
        Dict containing 'transitions' list with 'id', 'name', 'to' status
    """
    url = f"{JIRA_API}/issue/{issue_key}/transitions"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def transition_issue(
    issue_key: str,
    transition_id: str,
    fields: Optional[Dict] = None,
    comment: Optional[str] = None,
    resolution: Optional[str] = None
) -> None:
    """Transition an issue to a new status.

    Args:
        issue_key: Issue key
        transition_id: ID of the transition (get from get_transitions)
        fields: Fields to set during transition
        comment: Comment to add with transition
        resolution: Resolution name (for closing issues)

    Example:
        >>> transitions = get_transitions('MYPROJECT-123')
        >>> for t in transitions['transitions']:
        ...     print(f"{t['id']}: {t['name']}")
        >>> transition_issue('MYPROJECT-123', '31', resolution='Done')
    """
    url = f"{JIRA_API}/issue/{issue_key}/transitions"

    data = {
        'transition': {'id': transition_id}
    }

    if fields:
        data['fields'] = fields
    if comment:
        data['update'] = {'comment': [{'add': {'body': comment}}]}
    if resolution:
        if 'fields' not in data:
            data['fields'] = {}
        data['fields']['resolution'] = {'name': resolution}

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()


# =============================================================================
# Comment Operations
# =============================================================================

def get_comments(
    issue_key: str,
    start_at: int = 0,
    max_results: int = 50
) -> Dict:
    """Get comments for an issue.

    Args:
        issue_key: Issue key
        start_at: Start index for pagination
        max_results: Maximum results

    Returns:
        Dict containing 'comments' list
    """
    url = f"{JIRA_API}/issue/{issue_key}/comment"
    params = {'startAt': start_at, 'maxResults': max_results}

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def add_comment(
    issue_key: str,
    body: str,
    visibility: Optional[Dict] = None
) -> Dict:
    """Add a comment to an issue.

    Args:
        issue_key: Issue key
        body: Comment body (supports Jira wiki markup)
        visibility: Visibility restriction {'type': 'role', 'value': 'Developers'}

    Returns:
        Dict containing created comment data
    """
    url = f"{JIRA_API}/issue/{issue_key}/comment"
    data = {'body': body}
    if visibility:
        data['visibility'] = visibility

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()
    return response.json()


def update_comment(issue_key: str, comment_id: str, body: str) -> Dict:
    """Update a comment.

    Args:
        issue_key: Issue key
        comment_id: Comment ID
        body: New comment body

    Returns:
        Dict containing updated comment data
    """
    url = f"{JIRA_API}/issue/{issue_key}/comment/{comment_id}"
    data = {'body': body}

    response = requests.put(url, headers=jira_headers, json=data)
    response.raise_for_status()
    return response.json()


def delete_comment(issue_key: str, comment_id: str) -> None:
    """Delete a comment.

    Args:
        issue_key: Issue key
        comment_id: Comment ID
    """
    url = f"{JIRA_API}/issue/{issue_key}/comment/{comment_id}"
    response = requests.delete(url, headers=jira_headers)
    response.raise_for_status()


# =============================================================================
# Attachment Operations
# =============================================================================

def get_attachments(issue_key: str) -> List[Dict]:
    """Get attachments for an issue.

    Args:
        issue_key: Issue key

    Returns:
        List of attachment dicts
    """
    issue = get_issue(issue_key, fields=['attachment'])
    return issue.get('fields', {}).get('attachment', [])


def add_attachment(issue_key: str, file_path: str) -> List[Dict]:
    """Add an attachment to an issue.

    Args:
        issue_key: Issue key
        file_path: Path to file to attach

    Returns:
        List containing created attachment data
    """
    url = f"{JIRA_API}/issue/{issue_key}/attachments"

    headers = {
        'Authorization': f'Bearer {JIRA_TOKEN}',
        'X-Atlassian-Token': 'no-check'
    }

    with open(file_path, 'rb') as f:
        files = {'file': f}
        response = requests.post(url, headers=headers, files=files)

    response.raise_for_status()
    return response.json()


def delete_attachment(attachment_id: str) -> None:
    """Delete an attachment.

    Args:
        attachment_id: Attachment ID
    """
    url = f"{JIRA_API}/attachment/{attachment_id}"
    response = requests.delete(url, headers=jira_headers)
    response.raise_for_status()


# =============================================================================
# Worklog Operations
# =============================================================================

def get_worklogs(issue_key: str) -> Dict:
    """Get worklogs for an issue.

    Args:
        issue_key: Issue key

    Returns:
        Dict containing 'worklogs' list
    """
    url = f"{JIRA_API}/issue/{issue_key}/worklog"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def add_worklog(
    issue_key: str,
    time_spent: str,
    comment: str = '',
    started: Optional[str] = None
) -> Dict:
    """Add a worklog entry.

    Args:
        issue_key: Issue key
        time_spent: Time spent (e.g., '2h 30m', '1d')
        comment: Worklog comment
        started: Start time in ISO format (defaults to now)

    Returns:
        Dict containing created worklog data
    """
    url = f"{JIRA_API}/issue/{issue_key}/worklog"
    data = {
        'timeSpent': time_spent,
        'comment': comment
    }
    if started:
        data['started'] = started

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()
    return response.json()


# =============================================================================
# Link Operations
# =============================================================================

def get_issue_links(issue_key: str) -> List[Dict]:
    """Get links for an issue.

    Args:
        issue_key: Issue key

    Returns:
        List of issue link dicts
    """
    issue = get_issue(issue_key, fields=['issuelinks'])
    return issue.get('fields', {}).get('issuelinks', [])


def create_issue_link(
    link_type: str,
    inward_issue: str,
    outward_issue: str,
    comment: Optional[str] = None
) -> None:
    """Create a link between issues.

    Args:
        link_type: Link type name (e.g., 'Blocks', 'Relates', 'Duplicate')
        inward_issue: Inward issue key
        outward_issue: Outward issue key
        comment: Optional comment

    Example:
        >>> create_issue_link('Blocks', 'MYPROJECT-123', 'MYPROJECT-456')  # MYPROJECT-123 blocks MYPROJECT-456
    """
    url = f"{JIRA_API}/issueLink"
    data = {
        'type': {'name': link_type},
        'inwardIssue': {'key': inward_issue},
        'outwardIssue': {'key': outward_issue}
    }
    if comment:
        data['comment'] = {'body': comment}

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()


def delete_issue_link(link_id: str) -> None:
    """Delete an issue link.

    Args:
        link_id: Link ID
    """
    url = f"{JIRA_API}/issueLink/{link_id}"
    response = requests.delete(url, headers=jira_headers)
    response.raise_for_status()


def get_link_types() -> Dict:
    """Get all available link types.

    Returns:
        Dict containing 'issueLinkTypes' list
    """
    url = f"{JIRA_API}/issueLinkType"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


# =============================================================================
# Project Operations
# =============================================================================

def get_all_projects(expand: Optional[List[str]] = None) -> List[Dict]:
    """Get all projects visible to the user.

    Args:
        expand: Fields to expand

    Returns:
        List of project dicts
    """
    url = f"{JIRA_API}/project"
    params = {}
    if expand:
        params['expand'] = ','.join(expand)

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def get_project(project_key: str, expand: Optional[List[str]] = None) -> Dict:
    """Get project details.

    Args:
        project_key: Project key
        expand: Fields to expand (e.g., ['description', 'lead', 'issueTypes'])

    Returns:
        Dict containing project data
    """
    url = f"{JIRA_API}/project/{project_key}"
    params = {}
    if expand:
        params['expand'] = ','.join(expand)

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def get_project_components(project_key: str) -> List[Dict]:
    """Get components for a project.

    Args:
        project_key: Project key

    Returns:
        List of component dicts
    """
    url = f"{JIRA_API}/project/{project_key}/components"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_project_versions(project_key: str) -> List[Dict]:
    """Get versions for a project.

    Args:
        project_key: Project key

    Returns:
        List of version dicts
    """
    url = f"{JIRA_API}/project/{project_key}/versions"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def create_version(
    project_key: str,
    name: str,
    description: str = '',
    release_date: Optional[str] = None,
    released: bool = False
) -> Dict:
    """Create a new version in a project.

    Args:
        project_key: Project key
        name: Version name
        description: Version description
        release_date: Release date (YYYY-MM-DD format)
        released: Whether version is released

    Returns:
        Dict containing created version data
    """
    url = f"{JIRA_API}/version"
    data = {
        'project': project_key,
        'name': name,
        'description': description,
        'released': released
    }
    if release_date:
        data['releaseDate'] = release_date

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()
    return response.json()


# =============================================================================
# User Operations
# =============================================================================

def get_user(username: str) -> Dict:
    """Get user details.

    Args:
        username: Username

    Returns:
        Dict containing user data
    """
    url = f"{JIRA_API}/user"
    params = {'username': username}

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def search_users(query: str, max_results: int = 50) -> List[Dict]:
    """Search for users.

    Args:
        query: Search query (username, name, or email)
        max_results: Maximum results to return

    Returns:
        List of user dicts
    """
    url = f"{JIRA_API}/user/search"
    params = {'username': query, 'maxResults': max_results}

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def get_current_user() -> Dict:
    """Get current authenticated user.

    Returns:
        Dict containing current user data
    """
    url = f"{JIRA_API}/myself"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_assignable_users(
    project_key: str,
    issue_key: Optional[str] = None
) -> List[Dict]:
    """Get users assignable to a project or issue.

    Args:
        project_key: Project key
        issue_key: Issue key (optional)

    Returns:
        List of assignable user dicts
    """
    url = f"{JIRA_API}/user/assignable/search"
    params = {'project': project_key}
    if issue_key:
        params['issueKey'] = issue_key

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


# =============================================================================
# Board and Sprint Operations (Agile)
# =============================================================================

def get_all_boards(
    project_key: Optional[str] = None,
    board_type: Optional[str] = None
) -> Dict:
    """Get all boards.

    Args:
        project_key: Filter by project
        board_type: Filter by type ('scrum', 'kanban')

    Returns:
        Dict containing 'values' list of boards
    """
    url = f"{JIRA_URL}/rest/agile/1.0/board"
    params = {}
    if project_key:
        params['projectKeyOrId'] = project_key
    if board_type:
        params['type'] = board_type

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def get_board(board_id: int) -> Dict:
    """Get a board by ID.

    Args:
        board_id: Board ID

    Returns:
        Dict containing board data
    """
    url = f"{JIRA_URL}/rest/agile/1.0/board/{board_id}"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_sprints(board_id: int, state: Optional[str] = None) -> Dict:
    """Get sprints for a board.

    Args:
        board_id: Board ID
        state: Filter by state ('active', 'closed', 'future')

    Returns:
        Dict containing 'values' list of sprints
    """
    url = f"{JIRA_URL}/rest/agile/1.0/board/{board_id}/sprint"
    params = {}
    if state:
        params['state'] = state

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def get_sprint_issues(
    sprint_id: int,
    start_at: int = 0,
    max_results: int = 50
) -> Dict:
    """Get issues in a sprint.

    Args:
        sprint_id: Sprint ID
        start_at: Start index
        max_results: Maximum results

    Returns:
        Dict containing 'issues' list
    """
    url = f"{JIRA_URL}/rest/agile/1.0/sprint/{sprint_id}/issue"
    params = {'startAt': start_at, 'maxResults': max_results}

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


def move_issue_to_sprint(sprint_id: int, issue_keys: List[str]) -> None:
    """Move issues to a sprint.

    Args:
        sprint_id: Target sprint ID
        issue_keys: List of issue keys to move
    """
    url = f"{JIRA_URL}/rest/agile/1.0/sprint/{sprint_id}/issue"
    data = {'issues': issue_keys}

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()


def get_backlog_issues(
    board_id: int,
    start_at: int = 0,
    max_results: int = 50
) -> Dict:
    """Get issues in the backlog.

    Args:
        board_id: Board ID
        start_at: Start index
        max_results: Maximum results

    Returns:
        Dict containing 'issues' list
    """
    url = f"{JIRA_URL}/rest/agile/1.0/board/{board_id}/backlog"
    params = {'startAt': start_at, 'maxResults': max_results}

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


# =============================================================================
# Filter Operations
# =============================================================================

def get_filter(filter_id: int) -> Dict:
    """Get a filter by ID.

    Args:
        filter_id: Filter ID

    Returns:
        Dict containing filter data
    """
    url = f"{JIRA_API}/filter/{filter_id}"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_favorite_filters() -> List[Dict]:
    """Get current user's favorite filters.

    Returns:
        List of filter dicts
    """
    url = f"{JIRA_API}/filter/favourite"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def create_filter(
    name: str,
    jql: str,
    description: str = '',
    favourite: bool = False
) -> Dict:
    """Create a new filter.

    Args:
        name: Filter name
        jql: JQL query
        description: Filter description
        favourite: Add to favorites

    Returns:
        Dict containing created filter data
    """
    url = f"{JIRA_API}/filter"
    data = {
        'name': name,
        'jql': jql,
        'description': description,
        'favourite': favourite
    }

    response = requests.post(url, headers=jira_headers, json=data)
    response.raise_for_status()
    return response.json()


def search_filters(filter_name: str) -> List[Dict]:
    """Search for filters by name.

    Args:
        filter_name: Filter name to search

    Returns:
        List of matching filter dicts
    """
    url = f"{JIRA_API}/filter/search"
    params = {'filterName': filter_name}

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json().get('values', [])


# =============================================================================
# Field and Metadata Operations
# =============================================================================

def get_fields() -> List[Dict]:
    """Get all fields (system and custom).

    Returns:
        List of field dicts
    """
    url = f"{JIRA_API}/field"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_issue_types() -> List[Dict]:
    """Get all issue types.

    Returns:
        List of issue type dicts
    """
    url = f"{JIRA_API}/issuetype"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_priorities() -> List[Dict]:
    """Get all priorities.

    Returns:
        List of priority dicts
    """
    url = f"{JIRA_API}/priority"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_statuses() -> List[Dict]:
    """Get all statuses.

    Returns:
        List of status dicts
    """
    url = f"{JIRA_API}/status"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_resolutions() -> List[Dict]:
    """Get all resolutions.

    Returns:
        List of resolution dicts
    """
    url = f"{JIRA_API}/resolution"
    response = requests.get(url, headers=jira_headers)
    response.raise_for_status()
    return response.json()


def get_create_meta(
    project_keys: List[str],
    issue_type_names: Optional[List[str]] = None
) -> Dict:
    """Get metadata for creating issues.

    Args:
        project_keys: List of project keys
        issue_type_names: Filter by issue type names

    Returns:
        Dict containing creation metadata
    """
    url = f"{JIRA_API}/issue/createmeta"
    params = {
        'projectKeys': ','.join(project_keys),
        'expand': 'projects.issuetypes.fields'
    }
    if issue_type_names:
        params['issuetypeNames'] = ','.join(issue_type_names)

    response = requests.get(url, headers=jira_headers, params=params)
    response.raise_for_status()
    return response.json()


# =============================================================================
# Utility Functions
# =============================================================================

def get_issue_url(issue_key: str) -> str:
    """Get the web URL for an issue.

    Args:
        issue_key: Issue key

    Returns:
        URL string
    """
    return f"{JIRA_URL}/browse/{issue_key}"
