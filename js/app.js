/*
  Configuración requerida:
  1. service_app_token: access token actual de la Service App de Webex.
  2. service_app_refresh_token: refresh token de la Service App de Webex.
  3. service_app_client_id / service_app_client_secret: credenciales OAuth de la Service App.
  4. CLICK_TO_CALL_CALLED_NUMBER: número, cola o destino que recibirá la llamada.

  Nota importante:
  El call token/JWE de Click-to-Call se solicita nuevamente en cada clic.
  No lo reutilices entre llamadas, porque puede expirar o quedar consumido y provocar 403.

  Para producción, no expongas el token de la Service App en el navegador.
  La generación de guest token y call token debería hacerse desde un backend.
*/
let service_app_token = 'NTRjNTBjZGEtOGM5ZC00NjVjLWIzNDctOTZmZWIzOGZkYzA5ZjFjN2U5MzAtMDRk_P0A1_13ab0633-3ac9-4201-86fb-b00be6f71b9c';
let service_app_refresh_token = 'RDZkM2U0YmMtMzgxOS00YmUwLTk4MTYtNWY1NzAzMzc5MWUzOTg4ZWY3NjgtMjM2_P0A1_13ab0633-3ac9-4201-86fb-b00be6f71b9c';
const service_app_client_id = 'Ca54f9127b200556fec167b0fd96db5cad625d20ba3de510d40ad6718af6699c8';
const service_app_client_secret = 'c6af6c268a29b72348c18361f205e22086406cd4a97de8e45c0c9d3969fdd671';

const CLICK_TO_CALL_CALLED_NUMBER = '8800'; // Destino (extensión, número o URI)

// Variables de Estado de la Llamada y Video
let isVideoMuted = true;      // Cambiado a true porque ahora inicia silenciado por defecto
let globalActiveCall = null;  // Almacenará la llamada activa de forma global

function getClickToCallConfig() {
  return {
    calledNumber: CLICK_TO_CALL_CALLED_NUMBER,
    region: 'us-east-1',
    country: 'US'
  };
}

function updateAuthIndicator({ config, auth, line, message }) {
  console.log(`[Status Update] Config: ${config}, Auth: ${auth}, Line: ${line} | ${message}`);
  
  const configItem = document.getElementById('configStatusItem');
  const authItem = document.getElementById('authStatusItem');
  const lineItem = document.getElementById('lineStatusItem');
  const msgEl = document.getElementById('clickToCallStatus');

  const valConfig = document.getElementById('configStatusValue');
  const valAuth = document.getElementById('authStatusValue');
  const valLine = document.getElementById('lineStatusValue');

  if (configItem && valConfig) {
    configItem.setAttribute('data-state', config);
    valConfig.textContent = config === 'ok' ? 'Listo' : (config === 'error' ? 'Error' : 'Pendiente');
  }
  if (authItem && valAuth) {
    authItem.setAttribute('data-state', auth);
    valAuth.textContent = auth === 'ok' ? 'Conectado' : (auth === 'error' ? 'Error' : 'Pendiente');
  }
  if (lineItem && valLine) {
    lineItem.setAttribute('data-state', line);
    valLine.textContent = line === 'ok' ? 'Activa' : (line === 'error' ? 'Error' : 'Pendiente');
  }
  if (msgEl) {
    msgEl.textContent = message || '';
  }
}

async function handleTokenRefresh() {
  console.log('Intentando refrescar el token de la Service App...');
  const url = 'https://webexapis.com/v1/oauth2/token';
  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: service_app_refresh_token,
    client_id: service_app_client_id,
    client_secret: service_app_client_secret
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload
    });

    if (!response.ok) {
      throw new Error(`Error en refresco de token: ${response.status}`);
    }

    const data = await response.json();
    service_app_token = data.access_token;
    if (data.refresh_token) {
      service_app_refresh_token = data.refresh_token;
    }
    console.log('Token de Service App refrescado exitosamente.');
    return true;
  } catch (error) {
    console.error('Fallo crítico al refrescar el token:', error);
    updateAuthIndicator({ config: 'error', auth: 'error', line: 'pending', message: 'Credenciales inválidas o expiradas.' });
    return false;
  }
}

async function webexFetch(url, options = {}) {
  if (!options.headers) options.headers = {};
  options.headers['Authorization'] = `Bearer ${service_app_token}`;

  let response = await fetch(url, options);

  if (response.status === 401) {
    console.warn('Token de Service App posiblemente expirado (401). Refrescando...');
    const refreshed = await handleTokenRefresh();
    if (refreshed) {
      options.headers['Authorization'] = `Bearer ${service_app_token}`;
      response = await fetch(url, options);
    }
  }
  return response;
}

async function getGuestToken() {
  updateAuthIndicator({ config: 'working', auth: 'pending', line: 'pending', message: 'Creando sesión temporal de invitado...' });
  
  const url = 'https://webexapis.com/v1/guests/users';
  const response = await webexFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Cliente de Soporte (' + Math.floor(1000 + Math.random() * 9000) + ')'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    updateAuthIndicator({ config: 'error', auth: 'pending', line: 'pending', message: 'Error al generar invitado.' });
    throw new Error(`No se pudo crear Guest User: ${errText}`);
  }

  const data = await response.json();
  return data.token;
}

async function getJweToken() {
  updateAuthIndicator({ config: 'ok', auth: 'working', line: 'pending', message: 'Solicitando autorización para Click-to-Call...' });

  const url = 'https://webexapis.com/v1/clickToCall/tokens';
  const response = await webexFetch(url, { method: 'POST' });

  const data = await response.json();

  if (!response.ok) {
    updateAuthIndicator({ config: 'ok', auth: 'error', line: 'pending', message: 'Permiso denegado por Webex.' });
    throw new Error(`Error en clickToCall/tokens (${response.status}): ${JSON.stringify(data)}`);
  }

  updateAuthIndicator({ config: 'ok', auth: 'ok', line: 'pending', message: 'Call token fresco obtenido.' });
  return data.callToken;
}

async function getWebexConfig() {
  const guestToken = await getGuestToken();
  return {
    config: {
      logger: { level: 'debug' },
      meetings: {
        reconnection: { enabled: true },
        enableRtx: true,
      },
      encryption: {
        kmsInitialTimeout: 8000,
        kmsMaxTimeout: 40000,
        batcherMaxCalls: 30,
        caroots: null,
      },
      dss: {},
    },
    credentials: {
      access_token: guestToken,
    },
  };
}

// CAMBIO CRÍTICO: Configuración de inicio con video deshabilitado por defecto
async function getCallingConfig() {
  const config = getClickToCallConfig();
  const jweToken = await getJweToken();
  const loggerConfig = { level: 'info' };
  return {
    clientConfig: {
      calling: true,
      video: false, // <--- CAMBIADO A FALSE: Llama exclusivamente con AUDIO al iniciar
      callHistory: false,
    },
    callingClientConfig: {
      logger: loggerConfig,
      discovery: {
        region: config.region,
        country: config.country,
      },
      serviceData: {
        indicator: jweToken,
      },
    },
  };
}

// --- INTERCEPCIÓN Y CONTROL DEL FLUJO DE LLAMADA ---

// Sincronizar el estado del botón cuando la llamada conecta en modo Audio
function enableVideoControls(callInstance) {
  globalActiveCall = callInstance;
  isVideoMuted = true; // Forzar estado inicial silenciado ya que iniciamos sin video
  
  const toggleVideoBtn = document.getElementById('toggleVideoBtn');
  if (toggleVideoBtn) {
    toggleVideoBtn.removeAttribute('disabled');
    toggleVideoBtn.classList.add('video-muted');   // Pone el botón en rojo
    toggleVideoBtn.innerHTML = '🎥 Encender Video'; // Texto correcto para activarlo
  }
}

// Resetear el botón por completo al colgar la llamada
function resetVideoControls() {
  globalActiveCall = null;
  isVideoMuted = true;
  
  const toggleVideoBtn = document.getElementById('toggleVideoBtn');
  if (toggleVideoBtn) {
    toggleVideoBtn.setAttribute('disabled', 'true');
    toggleVideoBtn.classList.remove('video-muted');
    toggleVideoBtn.innerHTML = '🎥 Apagar Video';
  }
}

// Función interactiva del botón para alternar el video durante la llamada
function toggleVideoTrack() {
  if (!globalActiveCall) {
    console.error("No hay ninguna llamada activa asignada para controlar el video.");
    return;
  }

  const videoBtn = document.getElementById('toggleVideoBtn');

  if (!isVideoMuted) {
    // Escenario A: Desactivar Video (Pasar a solo audio)
    if (typeof globalActiveCall.muteVideo === 'function') {
      globalActiveCall.muteVideo();
    } else if (globalActiveCall.localStream) {
      globalActiveCall.localStream.getVideoTracks().forEach(track => track.enabled = false);
    }
    
    isVideoMuted = true;
    if (videoBtn) {
      videoBtn.classList.add('video-muted');
      videoBtn.innerHTML = '🎥 Encender Video';
    }
    console.log("Transmisión de video local pausada.");
  } else {
    // Escenario B: Activar Video (Encender la cámara en llamada en curso)
    if (typeof globalActiveCall.unmuteVideo === 'function') {
      globalActiveCall.unmuteVideo();
    } else if (globalActiveCall.localStream) {
      globalActiveCall.localStream.getVideoTracks().forEach(track => track.enabled = true);
    }
    
    isVideoMuted = false;
    if (videoBtn) {
      videoBtn.classList.remove('video-muted');
      videoBtn.innerHTML = '🎥 Apagar Video';
    }
    console.log("Transmisión de video local iniciada con éxito.");
  }
}

// Enlazar con las funciones del ciclo de vida de calling-sdk.js (Inyección Dinámica)
window.addEventListener('load', () => {
  // Capturar dinámicamente cuando se inicie una llamada en el SDK para registrar el objeto
  if (typeof initiateCall === 'function') {
    const originalInitiateCall = initiateCall;
    window.initiateCall = async function(...args) {
      const result = await originalInitiateCall(...args);
      
      // Esperar un breve instante a que el SDK asigne el objeto de llamada a las variables globales
      setTimeout(() => {
        const activeCallRef = typeof activeCall !== 'undefined' ? activeCall : (typeof currentCall !== 'undefined' ? currentCall : null);
        if (activeCallRef) { 
          enableVideoControls(activeCallRef); 
          activeCallRef.on('disconnected', resetVideoControls);
        }
      }, 1500);
      return result;
    };
  }

  // Capturar dinámicamente el colgado de llamadas para limpiar el estado del botón
  if (typeof disconnectCall === 'function') {
    const originalDisconnectCall = disconnectCall;
    window.disconnectCall = function(...args) {
      resetVideoControls();
      return originalDisconnectCall(...args);
    };
  }
});