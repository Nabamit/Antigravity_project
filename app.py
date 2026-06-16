import os
import json
import time
import requests
import xml.etree.ElementTree as ET
from flask import Flask, render_template, jsonify
from bs4 import BeautifulSoup

app = Flask(__name__)

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
CACHE_FILE = os.path.join(os.path.dirname(__file__), "data_cache.json")

def parse_html_content(html_content, date, link):
    """
    Parses the HTML content of a single day's release notes and splits it
    into separate individual updates by <h3> headers.
    """
    if not html_content:
        return []
        
    soup = BeautifulSoup(html_content, 'html.parser')
    updates = []
    
    current_type = None
    current_elements = []
    
    for child in soup.contents:
        if child.name == 'h3':
            if current_type is not None and current_elements:
                content_html = "".join(str(e) for e in current_elements).strip()
                if content_html:
                    updates.append({
                        'date': date,
                        'type': current_type,
                        'content': content_html,
                        'link': link
                    })
            current_type = child.get_text().strip()
            current_elements = []
        elif child.name is not None:
            current_elements.append(child)
        elif isinstance(child, str) and child.strip():
            current_elements.append(child)
            
    # Add the last segmented update
    if current_type is not None and current_elements:
        content_html = "".join(str(e) for e in current_elements).strip()
        if content_html:
            updates.append({
                'date': date,
                'type': current_type,
                'content': content_html,
                'link': link
            })
    elif current_type is None:
        # If there are no h3 tags in the entire entry, treat it as one general update
        content_html = str(soup).strip()
        if content_html:
            updates.append({
                'date': date,
                'type': 'Update',
                'content': content_html,
                'link': link
            })
            
    return updates

def fetch_and_parse_feed():
    """
    Fetches the BigQuery Release Notes RSS/Atom feed and parses it.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    response = requests.get(FEED_URL, headers=headers, timeout=15)
    response.raise_for_status()
    
    root = ET.fromstring(response.content)
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    
    all_updates = []
    
    for entry in root.findall('atom:entry', ns):
        title_date = entry.find('atom:title', ns).text.strip()
        link_elem = entry.find('atom:link[@rel="alternate"]', ns)
        link = link_elem.attrib.get('href') if link_elem is not None else ""
        content_elem = entry.find('atom:content', ns)
        
        html_content = content_elem.text if content_elem is not None else ""
        
        # Parse into separate updates
        day_updates = parse_html_content(html_content, title_date, link)
        all_updates.extend(day_updates)
        
    return all_updates

def get_cached_data():
    """
    Reads the locally cached updates. Returns None if cache does not exist.
    """
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None
    return None

def write_cache_data(updates):
    """
    Writes updates to the local JSON cache file with a timestamp.
    """
    cache_payload = {
        'last_updated': time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        'updates': updates
    }
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache_payload, f, indent=2, ensure_ascii=False)
    return cache_payload

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/updates', methods=['GET'])
def get_updates():
    cache = get_cached_data()
    if cache is not None:
        return jsonify(cache)
        
    # If cache doesn't exist, fetch it fresh
    try:
        updates = fetch_and_parse_feed()
        cache = write_cache_data(updates)
        return jsonify(cache)
    except Exception as e:
        return jsonify({'error': str(e), 'updates': []}), 500

@app.route('/api/refresh', methods=['POST'])
def refresh_updates():
    try:
        updates = fetch_and_parse_feed()
        cache = write_cache_data(updates)
        return jsonify(cache)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
