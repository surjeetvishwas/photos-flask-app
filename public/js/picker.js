class GooglePhotosPicker {
  constructor({ developerKey, appDomain }) {
    this.accessToken = null;
    this.pickerApiLoaded = false;
    this.developerKey = developerKey;
    this.appDomain = appDomain;

    this.initElements();
    this.initEventListeners();
    this.initializeApp();
  }

  initElements() {
    this.authBtn = document.getElementById('authorize-btn');
    this.pickerBtn = document.getElementById('picker-btn');
    this.gallery = document.getElementById('gallery');
    this.statusEl = document.getElementById('status-message');
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
    return new Promise((resolve) => {
      if (window.google && google.picker) {
        this.pickerApiLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        gapi.load('picker', () => {
          this.pickerApiLoaded = true;
          resolve();
        });
      };
      document.head.appendChild(script);
    });
  }

  async checkAuthStatus() {
    const tokenData = await this.fetchTokenWithRetry();
    this.accessToken = tokenData.access_token;

    if (tokenData.expires_in) {
      setTimeout(() => {
        this.silentReauthenticate();
      }, (tokenData.expires_in - 60) * 1000);
    }
  }

  async fetchTokenWithRetry(retries = 3) {
    try {
      const response = await fetch('/token', { credentials: 'include' });
      if (!response.ok) throw new Error('Token fetch failed');
      return await response.json();
    } catch (error) {
      if (retries > 0) {
        await new Promise(res => setTimeout(res, 1000));
        return this.fetchTokenWithRetry(retries - 1);
      }
      throw error;
    }
  }

  async silentReauthenticate() {
    const res = await fetch('/refresh-token', {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) throw new Error('Silent reauth failed');
  }

  async openPicker() {
    if (!this.pickerApiLoaded) throw new Error('Picker not loaded');
    if (!this.accessToken) await this.checkAuthStatus();

    const picker = new google.picker.PickerBuilder()
      .addView(google.picker.ViewId.PHOTOS)
      .setOAuthToken(this.accessToken)
      .setDeveloperKey(this.developerKey)
      .setCallback(this.pickerCallback.bind(this))
      .setOrigin(window.location.origin)
      .build();

    picker.setVisible(true);
  }

  pickerCallback(data) {
    if (data.action !== google.picker.Action.PICKED) return;

    this.gallery.innerHTML = '';
    for (const doc of data.docs) {
      const img = document.createElement('img');
      img.src = doc.thumbnails?.pop()?.url || doc.url;
      img.alt = doc.name || 'Photo';
      img.classList.add('gallery-item');
      this.gallery.appendChild(img);
    }
  }

  updateUI() {
    this.authBtn.disabled = !!this.accessToken;
    this.pickerBtn.disabled = !this.accessToken || !this.pickerApiLoaded;
    this.statusEl.textContent = this.accessToken ? 'Ready' : 'Please connect';
  }

  showError(msg) {
    this.statusEl.textContent = `Error: ${msg}`;
    this.statusEl.classList.add('error');
    setTimeout(() => this.statusEl.classList.remove('error'), 4000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new GooglePhotosPicker({
    developerKey: window.PICKER_CONFIG.apiKey,
    appDomain: window.PICKER_CONFIG.appDomain
  });
});
