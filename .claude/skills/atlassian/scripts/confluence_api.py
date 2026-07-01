"""
Confluence Server API Functions

Required environment variables:
    CONFLUENCE_PERSONAL_TOKEN  — Personal access token
    CONFLUENCE_URL             — Base URL (e.g. https://wiki.example.com/confluence)
"""

import os
import re
import requests
from typing import Optional, Dict, List

CONFLUENCE_TOKEN = os.environ.get('CONFLUENCE_PERSONAL_TOKEN')
CONFLUENCE_URL = os.environ.get('CONFLUENCE_URL', '').rstrip('/')
CONFLUENCE_API = f"{CONFLUENCE_URL}/rest/api"

confluence_headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {CONFLUENCE_TOKEN}'
}


def _check_config():
    if not CONFLUENCE_URL:
        raise EnvironmentError('CONFLUENCE_URL is not set')
    if not CONFLUENCE_TOKEN:
        raise EnvironmentError('CONFLUENCE_PERSONAL_TOKEN is not set')


def get_page(page_id: str, expand: Optional[List[str]] = None) -> Dict:
    _check_config()
    url = f"{CONFLUENCE_API}/content/{page_id}"
    params = {'expand': ','.join(expand)} if expand else {'expand': 'body.storage,version,space'}
    response = requests.get(url, headers=confluence_headers, params=params)
    response.raise_for_status()
    return response.json()


def get_page_by_url(page_url: str) -> Dict:
    """Fetch a page using its web UI URL by extracting the numeric page ID."""
    _check_config()
    match = re.search(r'/pages/(\d+)', page_url)
    if not match:
        raise ValueError(f'Cannot extract page ID from URL: {page_url}')
    return get_page(match.group(1))


def get_page_by_title(space_key: str, title: str, expand: Optional[List[str]] = None) -> Optional[Dict]:
    _check_config()
    params = {
        'spaceKey': space_key,
        'title': title,
        'expand': ','.join(expand) if expand else 'body.storage,version,space'
    }
    response = requests.get(f"{CONFLUENCE_API}/content", headers=confluence_headers, params=params)
    response.raise_for_status()
    results = response.json().get('results', [])
    return results[0] if results else None


def search_content(cql: str, start: int = 0, limit: int = 25, expand: Optional[List[str]] = None) -> Dict:
    _check_config()
    params = {'cql': cql, 'start': start, 'limit': limit}
    if expand:
        params['expand'] = ','.join(expand)
    response = requests.get(f"{CONFLUENCE_API}/content/search", headers=confluence_headers, params=params)
    response.raise_for_status()
    return response.json()


def create_page(space_key: str, title: str, body: str, parent_id: Optional[str] = None, content_format: str = 'storage') -> Dict:
    _check_config()
    data = {
        'type': 'page',
        'title': title,
        'space': {'key': space_key},
        'body': {content_format: {'value': body, 'representation': content_format}}
    }
    if parent_id:
        data['ancestors'] = [{'id': parent_id}]
    response = requests.post(f"{CONFLUENCE_API}/content", headers=confluence_headers, json=data)
    response.raise_for_status()
    return response.json()


def update_page(page_id: str, title: str, body: str, version_number: int, content_format: str = 'storage') -> Dict:
    _check_config()
    data = {
        'type': 'page',
        'title': title,
        'body': {content_format: {'value': body, 'representation': content_format}},
        'version': {'number': version_number + 1}
    }
    response = requests.put(f"{CONFLUENCE_API}/content/{page_id}", headers=confluence_headers, json=data)
    response.raise_for_status()
    return response.json()


def get_child_pages(page_id: str, start: int = 0, limit: int = 25) -> Dict:
    _check_config()
    response = requests.get(
        f"{CONFLUENCE_API}/content/{page_id}/child/page",
        headers=confluence_headers,
        params={'start': start, 'limit': limit}
    )
    response.raise_for_status()
    return response.json()


def get_page_url(page_id: str) -> str:
    return f"{CONFLUENCE_URL}/pages/viewpage.action?pageId={page_id}"
