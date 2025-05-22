// picker.js

let accessToken = null;
const authBtn   = document.getElementById('authorize-btn');
const pickerBtn = document.getElementById('picker-btn');
const gallery   = document.getElementById('gallery');

// 1) Fetch OAuth token from the backend
async function fetchToken() {
  console.log('[CLIENT] Fetching /token');
  const res = await fetch('/token');
  if (!res.ok) {
    console.warn('[CLIENT] /token returned', res.status);
    return;
  }
  const data = await res.json();
  accessToken = data.access_token;
  console.log('[CLIENT] Access token received');
  // Now wait for Picker API
  waitForPicker();
}

// 2) Poll until both gapi.picker AND the standalone picker library are ready
function waitForPicker() {
  const interval = setInterval(() => {
    const hasGapiPicker = window.google && google.picker && google.picker.PickerBuilder;
    const hasGapiFlag   = window.pickerApiLoaded;
    if (hasGapiPicker && hasGapiFlag) {
      console.log('[CLIENT] Picker fully loaded');
      clearInterval(interval);
      pickerBtn.disabled = false;  // enable button
      authBtn.disabled   = true;   // disable authorize
    }
  }, 300);
}

// 3) Build and show the photo picker
function openPicker() {
  if (!accessToken) {
    return alert('Please connect to Google first.');
  }
  if (!(window.google && google.picker && window.pickerApiLoaded)) {
    return alert('Picker API not ready. Please wait a moment.');
  }

  console.log('[CLIENT] Opening Picker with API key and origin');

  const origin = window.location.protocol + '//' + window.location.host;
  new google.picker.PickerBuilder()
    .addView(google.picker.ViewId.PHOTOS)
    .setOAuthToken(accessToken)
    .setDeveloperKey('AIzaSyAs5gi9b3WNriZoaUW7eq2-5ECOPp1lBmU')            // your API key here
    .setOrigin(origin)                          // IMPORTANT!
    .setCallback(onPickerCallback)
    .build()
    .setVisible(true);
}


// Handle user selection
function onPickerCallback(data) {
  console.log('[CLIENT] Picker callback:', data);
  if (data.action === google.picker.Action.PICKED) {
    gallery.innerHTML = '';
    data.docs.forEach(doc => {
      const img = document.createElement('img');
      img.src = doc.thumbnails[0].url;
      gallery.appendChild(img);
    });
  }
}

// 4) Wire up buttons
authBtn.onclick   = () => { console.log('[CLIENT] Authorize clicked'); window.location.href = '/authorize'; };
pickerBtn.onclick = () => { console.log('[CLIENT] Open Picker clicked'); openPicker(); };

// 5) Start on load
window.onload = () => {
  console.log('[CLIENT] Window loaded, fetching token...');
  fetchToken();
};
