class GooglePhotosPicker {
  constructor() {
    this.accessToken = null;
    this.pickerApiLoaded = false;
    this.developerKey = document.currentScript.getAttribute('data-api-key');
    this.appDomain = document.currentScript.getAttribute('data-app-domain');
    
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
    try {
      const tokenData = await this.fetchTokenWithRetry();
      this.accessToken = tokenData.access_token;
      
      // Set up token refresh before expiration
      if (tokenData.expires_in) {
        setTimeout(() => {
          this.silentReauthenticate();
        }, (tokenData.expires_in - 60) * 1000); // Refresh 1 minute before expiry
      }
    } catch (error) {
      throw new Error('Authentication required');
    }
  }

  async fetchTokenWithRetry(retries = 3) {
    try {
      const response = await fetch('/token', {
        credentials: 'include'
      });
      
      if (response.status === 401) {
        const errorData = await response.json();
        if (errorData.code === 'TOKEN_EXPIRED' && retries > 0) {
          await this.silentReauthenticate();
          return this.fetchTokenWithRetry(retries - 1);
        }
        throw new Error('Authentication required');
      }
      
      if (!response.ok) throw new Error('Token request failed');
      
      return await response.json();
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
      
      return await response.json();
    } catch (error) {
      console.error('Silent reauth failed:', error);
      window.location.href = '/authorize';
      throw error;
    }
  }

  async openPicker() {
    if (!this.pickerApiLoaded) {
      throw new Error('Picker API not loaded');
    }

    if (!this.accessToken) {
      await this.checkAuthStatus();
    }

    const picker = new google.picker.PickerBuilder()
      .addView(google.picker.ViewId.PHOTOS)
      .addView(new google.picker.PhotosView()
        .setType(google.picker.PhotosView.Type.ALBUMS)
      )
      .setOAuthToken(this.accessToken)
      .setDeveloperKey(this.developerKey)
      .setCallback(this.pickerCallback.bind(this))
      .setOrigin(window.location.origin)
      .setRelayUrl(`https://${this.appDomain}`)
      .build();

    picker.setVisible(true);
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new GooglePhotosPicker();
});