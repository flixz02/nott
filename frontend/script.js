// frontend/script.js
document.addEventListener('DOMContentLoaded', () => {
    const loginSection = document.getElementById('loginSection');
    const trackerSection = document.getElementById('trackerSection');
    const usernameInput = document.getElementById('usernameInput');
    const loginButton = document.getElementById('loginButton');
    const loginError = document.getElementById('loginError');
    
    const displayName = document.getElementById('displayName');
    const workStatus = document.getElementById('workStatus');
    const workedTime = document.getElementById('workedTime');
    const currentTimeDisplay = document.getElementById('currentTime');
    const eventMessage = document.getElementById('eventMessage');

    const startButton = document.getElementById('startButton');
    const pauseButton = document.getElementById('pauseButton');
    const resumeButton = document.getElementById('resumeButton');
    const endButton = document.getElementById('endButton');
    const logoutButton = document.getElementById('logoutButton');

    const actionButtons = [startButton, pauseButton, resumeButton, endButton];

    // Gemini Feature Elements
    const getQuoteButton = document.getElementById('getQuoteButton');
    const planHourButton = document.getElementById('planHourButton');
    const geminiModal = document.getElementById('geminiModal');
    const geminiModalTitle = document.getElementById('geminiModalTitle');
    const geminiModalBody = document.getElementById('geminiModalBody');
    const closeGeminiModalButton = document.getElementById('closeGeminiModal');
    const geminiLoadingIndicator = document.getElementById('geminiLoadingIndicator');
    const copyGeminiResponseButton = document.getElementById('copyGeminiResponseButton');


    const API_BASE_URL = 'http://localhost:5000/api'; // Adjust if your backend runs elsewhere
    let currentUsername = localStorage.getItem('workTrackerUsername');

    // --- Utility Functions ---
    function formatSecondsToHHMMSS(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateCurrentTime() {
        const now = new Date();
        currentTimeDisplay.textContent = now.toLocaleTimeString();
    }
    setInterval(updateCurrentTime, 1000);
    updateCurrentTime(); // Initial call

    // --- UI Update Functions ---
    function showLogin() {
        loginSection.classList.remove('hidden');
        trackerSection.classList.add('hidden');
        loginError.textContent = '';
        usernameInput.value = '';
    }

    function showTracker(username) {
        currentUsername = username;
        localStorage.setItem('workTrackerUsername', username);
        displayName.textContent = username;
        loginSection.classList.add('hidden');
        trackerSection.classList.remove('hidden');
        fetchAndUpdateStatus();
    }

    function updateUI(data) {
        if (!data) {
            workStatus.textContent = 'Error fetching status';
            workedTime.textContent = '00:00:00';
            actionButtons.forEach(btn => btn.style.display = 'none');
            planHourButton.style.display = 'none'; // Hide plan hour button on error
            return;
        }

        workStatus.textContent = data.status.replace(/_/g, ' ');
        workedTime.textContent = formatSecondsToHHMMSS(data.worked_today_seconds || 0);

        actionButtons.forEach(btn => btn.style.display = 'none');
        planHourButton.style.display = 'none'; // Default hide

        switch (data.status) {
            case 'NOT_STARTED_TODAY':
                startButton.style.display = 'block';
                break;
            case 'WORKING':
                pauseButton.style.display = 'block';
                endButton.style.display = 'block';
                planHourButton.style.display = 'flex'; // Show plan hour button when working
                break;
            case 'PAUSED':
                resumeButton.style.display = 'block';
                endButton.style.display = 'block';
                break;
            case 'ENDED':
                startButton.style.display = 'block';
                workStatus.textContent = 'Workday Ended. Ready to start again?';
                break;
            default:
                break;
        }
    }

    // --- API Call Functions ---
    async function fetchAndUpdateStatus() {
        if (!currentUsername) return;
        try {
            const response = await fetch(`${API_BASE_URL}/status/${currentUsername}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            updateUI(data);
        } catch (error) {
            console.error('Error fetching status:', error);
            eventMessage.textContent = 'Error fetching status.';
            updateUI(null);
        }
    }

    async function postEvent(eventType) {
        if (!currentUsername) return;
        try {
            eventMessage.textContent = `Sending ${eventType}...`;
            const response = await fetch(`${API_BASE_URL}/event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: currentUsername, event_type: eventType })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            updateUI(data);
            eventMessage.textContent = `${eventType} recorded successfully at ${new Date().toLocaleTimeString()}.`;
            setTimeout(() => eventMessage.textContent = '', 3000);
        } catch (error) {
            console.error(`Error posting ${eventType} event:`, error);
            eventMessage.textContent = `Error: ${error.message || 'Could not record event.'}`;
        }
    }

    // --- Gemini API Functions ---
    const GEMINI_API_KEY = ""; // Per instructions, leave empty for gemini-2.0-flash
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    async function callGeminiAPI(promptText) {
        showGeminiLoading();
        geminiModalBody.textContent = ''; // Clear previous content
        copyGeminiResponseButton.style.display = 'none';


        const payload = {
            contents: [{ role: "user", parts: [{ text: promptText }] }]
        };

        try {
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorResult = await response.json();
                console.error('Gemini API Error Response:', errorResult);
                throw new Error(`Gemini API error: ${errorResult.error?.message || response.statusText}`);
            }

            const result = await response.json();
            hideGeminiLoading();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                geminiModalBody.textContent = text;
                copyGeminiResponseButton.style.display = 'block';
            } else {
                console.error('Unexpected Gemini API response structure:', result);
                geminiModalBody.textContent = 'Sorry, I could not get a response. Please try again.';
            }
        } catch (error) {
            console.error('Error calling Gemini API:', error);
            hideGeminiLoading();
            geminiModalBody.textContent = `Error: ${error.message}. Check the console for details.`;
        }
    }

    function showGeminiModal(title) {
        geminiModalTitle.textContent = title;
        geminiModal.classList.remove('hidden');
    }

    function hideGeminiModal() {
        geminiModal.classList.add('hidden');
        geminiModalBody.textContent = ''; // Clear body on close
        copyGeminiResponseButton.style.display = 'none';
    }

    function showGeminiLoading() {
        geminiLoadingIndicator.classList.remove('hidden');
        geminiModalBody.classList.add('hidden');
    }

    function hideGeminiLoading() {
        geminiLoadingIndicator.classList.add('hidden');
        geminiModalBody.classList.remove('hidden');
    }
    
    copyGeminiResponseButton.addEventListener('click', () => {
        const textToCopy = geminiModalBody.textContent;
        if (textToCopy) {
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                eventMessage.textContent = 'Copied to clipboard!';
            } catch (err) {
                console.error('Failed to copy text: ', err);
                eventMessage.textContent = 'Failed to copy.';
            }
            document.body.removeChild(textArea);
            setTimeout(() => eventMessage.textContent = '', 2000);
        }
    });


    // --- Event Listeners ---
    loginButton.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        if (!username) {
            loginError.textContent = 'Username cannot be empty.';
            return;
        }
        loginError.textContent = '';
        
        try {
            const response = await fetch(`${API_BASE_URL}/status/${username}`);
            if (!response.ok) {
                 if (response.status === 400) {
                    const errorData = await response.json();
                    loginError.textContent = errorData.error || "Invalid username.";
                    return;
                }
            }
            const data = await response.json();
            showTracker(username);
            updateUI(data);
        } catch (error) {
            console.error('Login error (fetching initial status):', error);
            loginError.textContent = 'Could not connect to server or user not found.';
        }
    });

    logoutButton.addEventListener('click', () => {
        currentUsername = null;
        localStorage.removeItem('workTrackerUsername');
        showLogin();
    });

    actionButtons.forEach(button => {
        button.addEventListener('click', () => {
            const eventType = button.dataset.event;
            if (eventType) {
                postEvent(eventType);
            }
        });
    });

    // Gemini Feature Event Listeners
    getQuoteButton.addEventListener('click', () => {
        showGeminiModal('✨ Motivational Quote');
        callGeminiAPI("Generate a short, inspiring motivational quote suitable for a workday. Make it concise and uplifting.");
    });

    planHourButton.addEventListener('click', () => {
        showGeminiModal('✨ Plan Your Next Hour');
        callGeminiAPI(`I am currently working. Help me plan my focus for the next hour. Suggest 2-3 small, actionable tasks or focus areas. My username is ${currentUsername || 'User'}.`);
    });

    closeGeminiModalButton.addEventListener('click', hideGeminiModal);
    // Optional: Close modal if clicking outside of it
    geminiModal.addEventListener('click', (event) => {
        if (event.target === geminiModal) { // Check if the click is on the backdrop
            hideGeminiModal();
        }
    });


    // --- Initial Load ---
    if (currentUsername) {
        showTracker(currentUsername);
    } else {
        showLogin();
    }
});