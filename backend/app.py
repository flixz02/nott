# backend/app.py
import sqlite3
import os
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from datetime import datetime, timezone

# --- App Setup ---
app = Flask(__name__)
CORS(app) # Enable CORS for all routes

# --- Database Configuration ---
DATABASE_FOLDER = os.path.join(app.instance_path, 'db')
DATABASE = os.path.join(DATABASE_FOLDER, 'work_tracker.sqlite')
os.makedirs(DATABASE_FOLDER, exist_ok=True)

def get_db():
    """Opens a new database connection if there is none yet for the current application context."""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row # Access columns by name
    return g.db

@app.teardown_appcontext
def close_db(error):
    """Closes the database again at the end of the request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    """Initializes the database and creates tables if they don't exist."""
    db = get_db()
    schema_script = """
    CREATE TABLE IF NOT EXISTS work_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        event_timestamp TEXT NOT NULL, -- ISO 8601 format, UTC
        event_type TEXT NOT NULL CHECK(event_type IN ('START', 'PAUSE', 'RESUME', 'END')),
        day TEXT NOT NULL -- YYYY-MM-DD, derived from event_timestamp UTC
    );
    CREATE INDEX IF NOT EXISTS idx_user_day ON work_events (username, day);
    """
    db.executescript(schema_script)
    db.commit()
    app.logger.info("Database initialized.")

# Initialize DB when app starts
with app.app_context():
    init_db()

# --- Helper Functions ---
def get_current_utc_iso():
    """Returns the current time in UTC ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()

def get_current_utc_day_str():
    """Returns the current day string (YYYY-MM-DD) in UTC."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')

def add_event(username, event_type):
    """Adds a work event to the database."""
    db = get_db()
    timestamp = get_current_utc_iso()
    day_str = datetime.fromisoformat(timestamp).strftime('%Y-%m-%d') # Ensure day is from timestamp

    # Basic validation: Prevent PAUSE/RESUME/END if no START, etc.
    # More robust validation could be added here based on last event type.
    # For example, you can't PAUSE if already PAUSED or not STARTED.
    # This example keeps it simpler, relying on frontend logic primarily.

    db.execute(
        "INSERT INTO work_events (username, event_timestamp, event_type, day) VALUES (?, ?, ?, ?)",
        (username, timestamp, event_type, day_str)
    )
    db.commit()
    app.logger.info(f"Event added: User '{username}', Type '{event_type}', Day '{day_str}'")

def get_user_events_for_day(username, day_str):
    """Retrieves all events for a user for a specific day, sorted by time."""
    db = get_db()
    cursor = db.execute(
        "SELECT * FROM work_events WHERE username = ? AND day = ? ORDER BY event_timestamp ASC",
        (username, day_str)
    )
    events = cursor.fetchall()
    return [dict(row) for row in events] # Convert sqlite3.Row to dict

def calculate_work_time_and_get_status(username):
    """
    Calculates the total worked time for the user for the current UTC day
    and determines their current work status.
    """
    today_str = get_current_utc_day_str()
    events = get_user_events_for_day(username, today_str)

    total_worked_seconds = 0
    status = 'NOT_STARTED_TODAY'
    last_recorded_event_type = None
    
    if not events:
        return {
            'status': status,
            'worked_today_seconds': 0,
            'last_event_type': None,
            'username': username,
            'day': today_str
        }

    # Determine current status based on the last event in the DB
    last_event_from_db = events[-1]
    last_recorded_event_type = last_event_from_db['event_type']

    if last_recorded_event_type == 'START' or last_recorded_event_type == 'RESUME':
        status = 'WORKING'
    elif last_recorded_event_type == 'PAUSE':
        status = 'PAUSED'
    elif last_recorded_event_type == 'END':
        status = 'ENDED'

    # Calculate total worked seconds by iterating through events
    current_segment_start_time_obj = None
    for event in events:
        event_ts_obj = datetime.fromisoformat(event['event_timestamp'])
        event_type = event['event_type']

        if event_type == 'START' or event_type == 'RESUME':
            current_segment_start_time_obj = event_ts_obj
        elif event_type == 'PAUSE' or event_type == 'END':
            if current_segment_start_time_obj:
                duration_this_segment = (event_ts_obj - current_segment_start_time_obj).total_seconds()
                total_worked_seconds += duration_this_segment
                current_segment_start_time_obj = None # Segment ended or paused
    
    # If currently 'WORKING' (i.e., last event was START/RESUME and no subsequent PAUSE/END for that segment),
    # add the duration from that last START/RESUME event to now.
    if status == 'WORKING' and current_segment_start_time_obj:
        # current_segment_start_time_obj here is the timestamp of the last START or RESUME
        # because the loop finished and it wasn't cleared by a PAUSE or END.
        now_utc = datetime.now(timezone.utc)
        total_worked_seconds += (now_utc - current_segment_start_time_obj).total_seconds()

    return {
        'status': status,
        'worked_today_seconds': int(round(total_worked_seconds)),
        'last_event_type': last_recorded_event_type,
        'username': username,
        'day': today_str
    }

# --- API Routes ---
@app.route('/api/login', methods=['POST'])
def login():
    """
    Mock login. In a real app, this would involve authentication.
    Here, we just acknowledge the username.
    """
    data = request.get_json()
    username = data.get('username')
    if not username:
        return jsonify({"error": "Username is required"}), 400
    
    # For this example, login doesn't change server state,
    # but we can return the initial status for the user.
    app.logger.info(f"Login attempt for user: {username}")
    return jsonify(calculate_work_time_and_get_status(username))

@app.route('/api/event', methods=['POST'])
def record_event():
    """
    Records a work event (START, PAUSE, RESUME, END) for a user.
    """
    data = request.get_json()
    username = data.get('username')
    event_type = data.get('event_type')

    if not username or not event_type:
        return jsonify({"error": "Username and event_type are required"}), 400
    
    valid_events = ['START', 'PAUSE', 'RESUME', 'END']
    if event_type not in valid_events:
        return jsonify({"error": f"Invalid event_type. Must be one of {valid_events}"}), 400

    # Add event to database
    add_event(username, event_type)
    
    # Return the new status and total work time
    return jsonify(calculate_work_time_and_get_status(username))

@app.route('/api/status/<username>', methods=['GET'])
def get_status(username):
    """
    Gets the current work status and total worked time for the user for today.
    """
    if not username:
        return jsonify({"error": "Username is required in path"}), 400
    
    return jsonify(calculate_work_time_and_get_status(username))

@app.route('/')
def index():
    # This route is not strictly necessary if you serve index.html directly
    # or if the frontend is entirely separate.
    # For a fully self-contained Flask app serving the frontend:
    # return send_from_directory('static', 'index.html')
    return "Work Tracker Backend is running. Serve your frontend separately."

if __name__ == '__main__':
    app.run(debug=True, port=5000)
    