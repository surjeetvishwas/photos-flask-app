// Capture configuration early while script is loading
const currentScript = document.currentScript;
const developerKey = currentScript?.getAttribute('data-api-key') || '';
const appDomain = currentScript?.getAttribute('data-app-domain') || window.location.hostname;

// Validate critical configuration
if (!currentScript) {
  throw new Error('Picker script must be loaded directly in a <script> tag');
}

if (!developerKey) {
  console.error('Missing required data-api-key attribute');
  throw new Error('Invalid API key configuration');
}

class GooglePhotosPicker {
  constructor() {
    this.accessToken = null;
    this.pickerApiLoaded = false;
    this.developerKey = developerKey;
    this.appDomain = appDomain;

    // DOM Elements
    this.authBtn = document.getElementById('authorize-btn');
    this.pickerBtn = document.getElementById('picker-btn');
    this.gallery = document.getElementById('gallery');
    this.statusEl = document.getElementById('status-message');

    // Validate DOM elements
    if (!this.authBtn || !this.pickerBtn || !this.gallery || !this.statusEl) {
      throw new Error('Required DOM elements missing');
    }

    this.initEventListeners();
    this.initializeApp();
  }

  initEventListeners() {
    this.authBtn.addEventListener('click', () => {
      window.location.href = '/authorize';
    });

    this.pickerBtn.addEventListener('click', () => {
      this.openPicker().catch(error => {
        this.showError(error.message);
      });
    });
  }

  async initializeApp() {
    try {
      await this.loadPickerAPI();
      await this.checkAuthStatus();
      this.updateUI();
    } catch (error) {
      this.showError(error.message);
      this.authBtn.disabled = false;
    }
  }

  loadPickerAPI() {
    return new Promise((resolve, reject) => {
      if (window.google?.picker) {
        this.pickerApiLoaded = true;
        return resolve();
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        gapi.load('picker', {
          callback: () => {
            this.pickerApiLoaded = true;
            resolve();
          },
          onerror: reject
        });
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async checkAuthStatus() {
    try {
      const tokenData = await this.fetchTokenWithRetry();
      this.accessToken = tokenData.access_token;
      
      if (tokenData.expires_in) {
        setTimeout(() => {
          this.silentReauthenticate();
        }, (tokenData.expires_in - 60) * 1000);
      }
    } catch (error) {
      throw new Error('Authentication required');
    }
  }

  async fetchTokenWithRetry(retries = 3) {
    try {
      const response = await fetch('/token', { credentials: 'include' });
      
      if (response.status === 401) {
        const errorData = await response.json();
        if (errorData.code === 'TOKEN_EXPIRED' && retries > 0) {
          await this.silentReauthenticate();
          return this.fetchTokenWithRetry(retries - 1);
        }
        throw new Error('Authentication required');
      }
      
      if (!response.ok) throw new Error('Token request failed');
      
      return response.json();
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.fetchTokenWithRetry(retries - 1);
      }
      throw error;
    }
  }

  async silentReauthenticate() {
    try {
      const response = await fetch('/refresh-token', {
        method: 'POST',
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Refresh failed');
      
      return this.checkAuthStatus();
    } catch (error) {
      console.error('Silent reauth failed:', error);
      window.location.href = '/authorize';
      throw error;
    }
  }

  async openPicker() {
    if (!this.pickerApiLoaded) throw new Error('Picker API not loaded');
    if (!this.accessToken) await this.checkAuthStatus();

    return new Promise((resolve) => {
      const picker = new google.picker.PickerBuilder()
        .addView(google.picker.ViewId.PHOTOS)
        .addView(new google.picker.PhotosView()
          .setType(google.picker.PhotosView.Type.ALBUMS)
        )
        .setOAuthToken(this.accessToken)
        .setDeveloperKey(this.developerKey)
        .setCallback(data => {
          this.pickerCallback(data);
          resolve();
        })
        .setOrigin(window.location.origin)
        .setRelayUrl(`https://${this.appDomain}`)
        .build();

      picker.setVisible(true);
    });
  }

  pickerCallback(data) {
    if (data.action !== google.picker.Action.PICKED) return;

    this.gallery.innerHTML = '';
    data.docs.forEach(doc => {
      const img = document.createElement('img');
      img.src = doc.thumbnails?.pop()?.url || doc.url;
      img.alt = doc.name;
      img.classList.add('gallery-item');
      this.gallery.appendChild(img);
    });
  }

  updateUI() {
    this.authBtn.disabled = !!this.accessToken;
    this.pickerBtn.disabled = !this.accessToken || !this.pickerApiLoaded;
    this.statusEl.textContent = this.accessToken ? 'Ready to pick photos' : 'Please authenticate';
    this.statusEl.className = 'status';
  }

  showError(message) {
    this.statusEl.textContent = `Error: ${message}`;
    this.statusEl.classList.add('error');
    setTimeout(() => {
      this.statusEl.classList.remove('error');
    }, 5000);
  }
}

// Safe initialization
document.addEventListener('DOMContentLoaded', () => {
  try {
    if (document.querySelector('[data-picker-enabled]')) {
      new GooglePhotosPicker();
    }
  } catch (error) {
    console.error('Picker initialization failed:', error);
    const statusEl = document.getElementById('status-message');
    if (statusEl) {
      statusEl.textContent = `Initialization Error: ${error.message}`;
      statusEl.classList.add('error');
    }
  }
});