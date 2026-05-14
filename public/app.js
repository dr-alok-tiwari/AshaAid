const root = document.documentElement;
const body = document.body;
const assistantReply = document.getElementById('assistantReply');
const voiceAutoRead = document.getElementById('voiceAutoRead');

const canSpeak = 'speechSynthesis' in window;
const canListen = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

function speakText(text) {
  if (!canSpeak || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.93;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function showReply(text) {
  assistantReply.textContent = text;
  if (voiceAutoRead.checked) {
    speakText(text);
  }
}

async function loadResources() {
  const resourceList = document.getElementById('resourceList');
  try {
    const response = await fetch('/api/resources');
    const data = await response.json();
    resourceList.innerHTML = '';

    data.resources.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${item.title}:</strong> ${item.description} <em>(${item.contact})</em>`;
      resourceList.appendChild(li);
    });
  } catch (error) {
    resourceList.innerHTML = '<li>Could not load resources right now.</li>';
  }
}

async function askAssistant() {
  const prompt = document.getElementById('userPrompt').value.trim();
  const language = document.getElementById('language').value;
  const tone = document.getElementById('voiceTone').value;

  if (!prompt) {
    showReply('Please type or speak your issue first.');
    return;
  }

  showReply('AshaBot is preparing an easy action plan...');

  try {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, language, tone })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');

    const sourceTag = data.source === 'openai' ? ' [AI Live]' : ' [Offline Guide]';
    showReply(`${data.answer}${sourceTag}`);
  } catch (error) {
    showReply('Connection issue. Retry in a moment or submit a volunteer request below.');
  }
}

function setupVoiceInput() {
  const micButton = document.getElementById('micButton');
  if (!canListen) {
    micButton.disabled = true;
    micButton.textContent = 'Voice unavailable in this browser';
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;

  micButton.addEventListener('click', () => {
    micButton.textContent = 'Listening...';
    recognition.start();
  });

  recognition.addEventListener('result', (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('userPrompt').value = transcript;
    micButton.textContent = '🎤 Voice Input';
  });

  recognition.addEventListener('end', () => {
    micButton.textContent = '🎤 Voice Input';
  });
}

async function submitHelpRequest(event) {
  event.preventDefault();
  const helpStatus = document.getElementById('helpStatus');

  const payload = {
    name: document.getElementById('requestName').value.trim(),
    phone: document.getElementById('requestPhone').value.trim(),
    location: document.getElementById('requestLocation').value.trim(),
    category: document.getElementById('requestCategory').value,
    urgency: document.getElementById('requestUrgency').value,
    notes: document.getElementById('requestNotes').value.trim()
  };

  if (!payload.location) {
    helpStatus.textContent = 'Please provide your location so helpers can reach you.';
    return;
  }

  helpStatus.textContent = 'Submitting your request...';

  try {
    const response = await fetch('/api/request-help', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to submit request');

    helpStatus.textContent = `✅ Request sent. Ticket ${data.ticketId}. ETA ${data.etaMinutes} minutes.`;
    document.getElementById('helpForm').reset();
    loadRequestDashboard();
  } catch (error) {
    helpStatus.textContent = 'Unable to submit request. Please retry shortly.';
  }
}

async function loadRequestDashboard() {
  const statsContainer = document.getElementById('requestStats');
  const feed = document.getElementById('requestFeed');

  try {
    const response = await fetch('/api/requests');
    const data = await response.json();

    statsContainer.innerHTML = `
      <div class="stat-card"><strong>${data.total}</strong><br/>Total Requests</div>
      <div class="stat-card"><strong>${data.urgent}</strong><br/>Urgent / Critical</div>
      <div class="stat-card"><strong>${data.categories.food || 0}</strong><br/>Food Cases</div>
      <div class="stat-card"><strong>${data.categories.medicine || 0}</strong><br/>Medicine Cases</div>
    `;

    feed.innerHTML = '';
    data.recent.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${item.ticketId}</strong> - ${item.category} (${item.urgency}) near ${item.location}`;
      feed.appendChild(li);
    });

    if (!data.recent.length) {
      feed.innerHTML = '<li>No requests yet. Be the first to ask for help if needed.</li>';
    }
  } catch (error) {
    statsContainer.textContent = 'Dashboard unavailable right now.';
    feed.innerHTML = '<li>Could not load requests.</li>';
  }
}

function setupQuickChips() {
  const quickChips = document.getElementById('quickChips');
  quickChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    document.getElementById('userPrompt').value = chip.dataset.prompt;
    document.getElementById('userPrompt').focus();
  });
}

function setupBasicControls() {
  document.getElementById('fontIncrease').addEventListener('click', () => {
    const currentSize = parseFloat(getComputedStyle(root).fontSize);
    root.style.fontSize = `${Math.min(currentSize + 2, 32)}px`;
  });

  document.getElementById('fontDecrease').addEventListener('click', () => {
    const currentSize = parseFloat(getComputedStyle(root).fontSize);
    root.style.fontSize = `${Math.max(currentSize - 2, 14)}px`;
  });

  document.getElementById('toggleContrast').addEventListener('click', () => {
    body.classList.toggle('high-contrast');
  });

  document.getElementById('toggleDyslexia').addEventListener('click', () => {
    body.classList.toggle('dyslexia-font');
  });

  document.getElementById('toggleSoftTheme').addEventListener('click', () => {
    body.classList.toggle('soft-theme');
  });

  document.getElementById('sendPrompt').addEventListener('click', askAssistant);
  document.getElementById('readReply').addEventListener('click', () => speakText(assistantReply.textContent));
  document.getElementById('copyReply').addEventListener('click', async () => {
    const text = assistantReply.textContent;
    if (!text) return;
    await navigator.clipboard.writeText(text);
  });

  document.getElementById('sosButton').addEventListener('click', () => {
    showReply('Emergency mode: Please call 112 immediately. Keep location ON and ask nearby people for support.');
    document.getElementById('requestUrgency').value = 'critical';
    document.getElementById('requestCategory').value = 'medicine';
    document.getElementById('requestNotes').value = 'Emergency support needed';
    document.getElementById('requestLocation').focus();
  });

  document.getElementById('helpForm').addEventListener('submit', submitHelpRequest);
}

setupBasicControls();
setupVoiceInput();
setupQuickChips();
loadResources();
loadRequestDashboard();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // ignore in unsupported environments
  });
}
