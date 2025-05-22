const DEVELOPER_KEY = document.currentScript.getAttribute('data-api-key');
let accessToken = null;
let pickerApiLoaded = false;

// DOM Elements
const authBtn = document.getElementById('authorize-btn');
const pickerBtn = document.getElementById('picker-btn');
const gallery = document.getElementById('gallery');
const statusEl = document.getElementById('status-message');

// Initialize Picker API
function initPickerAPI() {
  return new Promise((resolve) => {
    if (window.google && google.picker) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      gapi.load('picker', () => {
        pickerApiLoaded = true;
        resolve();
      });
    };
    document.head.appendChild(script);
  });
}

// Token Management
async function fetchToken() {
  try {
    const response = await fetch('/token');
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Not authenticated' : 'Token request failed');
    }
    const data = await response.json();
    accessToken = data.access_token;
    updateUI();
  } catch (error) {
    showError(error.message);
  }
}

// Picker Functions
function createPicker() {
  if (!pickerApiLoaded || !accessToken) {
    throw new Error('Picker API not ready');
  }

  const picker = new google.picker.PickerBuilder()
    .addView(google.picker.ViewId.PHOTOS)
    .addView(new google.picker.PhotosView()
      .setType(google.picker.PhotosView.Type.ALBUMS)
    )
    .setOAuthToken(accessToken)
    .setDeveloperKey(DEVELOPER_KEY)
    .setCallback(pickerCallback)
    .setOrigin(window.location.origin)
    .build();

  picker.setVisible(true);
}

function pickerCallback(data) {
  if (data.action !== google.picker.Action.PICKED) return;

  gallery.innerHTML = '';
  data.docs.forEach(doc => {
    const img = document.createElement('img');
    img.src = doc.thumbnails?.pop()?.url || doc.url;
    img.alt = doc.name;
    img.classList.add('gallery-item');
    gallery.appendChild(img);
  });
}

// UI Functions
function updateUI() {
  authBtn.disabled = !!accessToken;
  pickerBtn.disabled = !accessToken || !pickerApiLoaded;
  statusEl.textContent = accessToken ? 'Ready to pick photos' : 'Please authenticate';
}

function showError(message) {
  statusEl.textContent = `Error: ${message}`;
  statusEl.classList.add('error');
  setTimeout(() => statusEl.classList.remove('error'), 3000);
}

// Event Listeners
authBtn.addEventListener('click', () => {
  window.location.href = '/authorize';
});

pickerBtn.addEventListener('click', async () => {
  try {
    await createPicker();
  } catch (error) {
    showError(error.message);
  }
});

// Initialize
(async function init() {
  await initPickerAPI();
  await fetchToken();
  updateUI();
})();