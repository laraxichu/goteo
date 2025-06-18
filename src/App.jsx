import { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';
import { CheckCircle, XCircle, Loader2, History, Trash2, User, Info, Eye, Bell, BellOff } from 'lucide-react';
import firebaseConfig from './firebase/config';
import './App.css';

function App() {
  // Input States
  const [calculationMode, setCalculationMode] = useState('calculateTime');
  const [volume, setVolume] = useState('500');
  const [dropsPerMl, setDropsPerMl] = useState('20');
  const [customDropsPerMl, setCustomDropsPerMl] = useState('20');
  const [secondsPerDrop, setSecondsPerDrop] = useState('10.34');
  const [patientName, setPatientName] = useState('');
  const [desiredHours, setDesiredHours] = useState('8');
  const [desiredMinutes, setDesiredMinutes] = useState('0');
  const [desiredSeconds, setDesiredSeconds] = useState('0');

  // Result and Error States
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [inputErrors, setInputErrors] = useState({});

  // App Loading and Calculation Loading States
  const [loading, setLoading] = useState(true);
  const [calculationLoading, setCalculationLoading] = useState(false);

  // History State
  const [history, setHistory] = useState([]);

  // UI Preferences States
  const [displayFormat, setDisplayFormat] = useState('hms');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const [showHistoryDetailModal, setShowHistoryDetailModal] = useState(false);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(null);

  // Reminder States
  const [reminderMinutesBeforeEnd, setReminderMinutesBeforeEnd] = useState('5');
  const [reminderTimeoutId, setReminderTimeoutId] = useState(null);
  const [reminderMessage, setReminderMessage] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState('default');

  // Firebase instances
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);

  // Refs for modals
  const infoModalRef = useRef(null);
  const howItWorksModalRef = useRef(null);
  const historyDetailModalRef = useRef(null);

  // Initialize Firebase and authenticate user
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);
      const analytics = getAnalytics(app); // Initialize Analytics

      setDb(firestore);
      setAuth(authentication);

      // Listen for auth state changes
      const unsubscribe = onAuthStateChanged(authentication, async (user) => {
        if (user) {
          setUserId(user.uid);
          console.log("User authenticated:", user.uid);
        } else {
          try {
            await signInAnonymously(authentication);
          } catch (e) {
            console.error("Error signing in anonymously:", e);
          }
          setUserId(authentication.currentUser?.uid || crypto.randomUUID());
        }
        setLoading(false);
      });

      // Check notification permission on load
      if (typeof Notification !== 'undefined') {
        setNotificationPermission(Notification.permission);
      }

      return () => unsubscribe();
    } catch (e) {
      console.error("Error initializing Firebase:", e);
      setError("Error al inicializar la base de datos.");
      setLoading(false);
    }
  }, []);

  // Fetch history from Firestore
  useEffect(() => {
    if (db && userId) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const historyCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/calculations`);
      const q = query(historyCollectionRef);

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const historyData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        historyData.sort((a, b) => b.timestamp - a.timestamp);
        setHistory(historyData);
      }, (err) => {
        console.error("Error fetching history:", err);
        setError("Error al cargar el historial.");
      });

      return () => unsubscribe();
    }
  }, [db, userId]);

  // Modal click outside handlers
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showInfoModal && infoModalRef.current && !infoModalRef.current.contains(event.target)) {
        setShowInfoModal(false);
      }
      if (showHowItWorksModal && howItWorksModalRef.current && !howItWorksModalRef.current.contains(event.target)) {
        setShowHowItWorksModal(false);
      }
      if (showHistoryDetailModal && historyDetailModalRef.current && !historyDetailModalRef.current.contains(event.target)) {
        setShowHistoryDetailModal(false);
        setSelectedHistoryEntry(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showInfoModal, showHowItWorksModal, showHistoryDetailModal]);

  // Validation function
  const validateInput = (value, fieldName) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0) {
      setInputErrors(prev => ({ ...prev, [fieldName]: true }));
      return false;
    } else {
      setInputErrors(prev => ({ ...prev, [fieldName]: false }));
      return true;
    }
  };

  // Input handlers
  const handleInputChange = (e, setter, fieldName) => {
    setter(e.target.value);
    validateInput(e.target.value, fieldName);
  };

  const handleDropsPerMlChange = (e) => {
    const value = e.target.value;
    setDropsPerMl(value);
    if (value === 'custom') {
      validateInput(customDropsPerMl, 'customDropsPerMl');
    } else {
      validateInput(value, 'dropsPerMl');
      setInputErrors(prev => ({ ...prev, 'customDropsPerMl': false }));
    }
  };

  const handleSubmitCalculation = async () => {
    setError(null);
    setResult(null);
    setCalculationLoading(true);
    setReminderMessage(null);
    clearTimeout(reminderTimeoutId);
    setReminderTimeoutId(null);

    const currentDropsPerMl = dropsPerMl === 'custom' ? customDropsPerMl : dropsPerMl;

    let isValid = true;
    isValid = validateInput(volume, 'volume') && isValid;
    isValid = validateInput(currentDropsPerMl, 'dropsPerMl') && isValid;

    if (calculationMode === 'calculateTime') {
      isValid = validateInput(secondsPerDrop, 'secondsPerDrop') && isValid;
    } else {
      isValid = validateInput(desiredHours, 'desiredHours') && isValid;
      isValid = validateInput(desiredMinutes, 'desiredMinutes') && isValid;
      isValid = validateInput(desiredSeconds, 'desiredSeconds') && isValid;
      const totalDesiredSeconds = parseFloat(desiredHours) * 3600 + parseFloat(desiredMinutes) * 60 + parseFloat(desiredSeconds);
      if (totalDesiredSeconds <= 0) {
        setError("El tiempo deseado total debe ser mayor que cero.");
        isValid = false;
      }
    }

    if (!isValid) {
      setError("Por favor, introduce valores numéricos válidos y mayores que cero en todos los campos requeridos.");
      setCalculationLoading(false);
      return;
    }

    const vol = parseFloat(volume);
    const dpm = parseFloat(currentDropsPerMl);

    let calculatedResult = {};

    if (calculationMode === 'calculateTime') {
      const spd = parseFloat(secondsPerDrop);
      const totalDrops = vol * dpm;
      const totalSeconds = totalDrops * spd;

      const hours = Math.floor(totalSeconds / 3600);
      const remainingSecondsAfterHours = totalSeconds % 3600;
      const minutes = Math.floor(remainingSecondsAfterHours / 60);
      const seconds = Math.round(remainingSecondsAfterHours % 60);

      calculatedResult = {
        type: 'time',
        totalSeconds,
        hours,
        minutes,
        seconds,
        volume: vol,
        dropsPerMl: dpm,
        secondsPerDrop: spd,
        patientName: patientName.trim() === '' ? undefined : patientName.trim(),
        timestamp: Date.now()
      };
    } else {
      const desHrs = parseFloat(desiredHours);
      const desMins = parseFloat(desiredMinutes);
      const desSecs = parseFloat(desiredSeconds);
      const totalDesiredSeconds = (desHrs * 3600) + (desMins * 60) + desSecs;

      const totalDropsInBag = vol * dpm;
      const dropsPerSecondNeeded = totalDropsInBag / totalDesiredSeconds;
      const dropsPerMinute = dropsPerSecondNeeded * 60;
      const mlPerHour = (vol / totalDesiredSeconds) * 3600;

      calculatedResult = {
        type: 'flow',
        dropsPerMinute: parseFloat(dropsPerMinute.toFixed(2)),
        mlPerHour: parseFloat(mlPerHour.toFixed(2)),
        volume: vol,
        dropsPerMl: dpm,
        desiredHours: desHrs,
        desiredMinutes: desMins,
        desiredSeconds: desSecs,
        patientName: patientName.trim() === '' ? undefined : patientName.trim(),
        timestamp: Date.now()
      };
    }

    setResult(calculatedResult);

    if (db && userId) {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const historyCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/calculations`);
        await addDoc(historyCollectionRef, calculatedResult);
        setPatientName('');
      } catch (e) {
        console.error("Error saving calculation to Firestore:", e);
        setError("Error al guardar el cálculo.");
      }
    }
    setCalculationLoading(false);
  };

  const deleteHistoryEntry = async (id) => {
    if (db && userId) {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/calculations`, id);
        await deleteDoc(docRef);
      } catch (e) {
        console.error("Error deleting history entry:", e);
        setError("Error al eliminar la entrada del historial.");
      }
    }
  };

  const clearInputs = () => {
    setVolume('500');
    setDropsPerMl('20');
    setCustomDropsPerMl('20');
    setSecondsPerDrop('10.34');
    setPatientName('');
    setDesiredHours('8');
    setDesiredMinutes('0');
    setDesiredSeconds('0');
    setResult(null);
    setError(null);
    setInputErrors({});
    setReminderMessage(null);
    clearTimeout(reminderTimeoutId);
    setReminderTimeoutId(null);
  };

  const formatTimeResult = (res) => {
    if (!res || res.type !== 'time') return '';

    let formatted = '';
    if (displayFormat === 'hms') {
      formatted = `${res.hours} horas, ${res.minutes} minutos y ${res.seconds} segundos`;
    } else if (displayFormat === 'h') {
      const totalHours = res.hours + res.minutes / 60 + res.seconds / 3600;
      formatted = `${totalHours.toFixed(2)} horas`;
    } else if (displayFormat === 'hm') {
      formatted = `${res.hours} horas, ${res.minutes} minutos`;
    }
    return `La solución durará aproximadamente ${formatted}.`;
  };

  const openHistoryDetailModal = (entry) => {
    setSelectedHistoryEntry(entry);
    setShowHistoryDetailModal(true);
  };

  const closeHistoryDetailModal = () => {
    setShowHistoryDetailModal(false);
    setSelectedHistoryEntry(null);
  };

  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      setReminderMessage('Tu navegador no soporta notificaciones de escritorio.');
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'denied') {
      setReminderMessage('Permiso de notificación denegado. Por favor, habilítalo en la configuración de tu navegador.');
    } else if (permission === 'granted') {
      setReminderMessage('Permiso de notificación concedido.');
    }
  }, []);

  const setInfusionReminder = () => {
    if (notificationPermission === 'denied') {
      setReminderMessage('No se puede establecer el recordatorio: las notificaciones están denegadas. Habilítalas.');
      return;
    }
    if (notificationPermission === 'default') {
      requestNotificationPermission();
      setReminderMessage('Por favor, concede permiso para notificaciones.');
      return;
    }

    if (!result || result.type !== 'time') {
      setReminderMessage('Primero debes realizar un cálculo de tiempo para establecer un recordatorio.');
      return;
    }

    const minutesBefore = parseFloat(reminderMinutesBeforeEnd);
    if (isNaN(minutesBefore) || minutesBefore < 0) {
      setReminderMessage('Introduce un número de minutos válido (no negativo).');
      return;
    }

    const totalInfusionSeconds = result.totalSeconds;
    const reminderOffsetSeconds = minutesBefore * 60;
    const delaySeconds = totalInfusionSeconds - reminderOffsetSeconds;

    if (delaySeconds <= 0) {
      setReminderMessage('El tiempo del recordatorio es en el pasado o demasiado cerca. El recordatorio no se establecerá.');
      return;
    }

    if (reminderTimeoutId) {
      clearTimeout(reminderTimeoutId);
    }

    const timeoutId = setTimeout(() => {
      new Notification('¡Atención: Infusión a punto de terminar!', {
        body: `La infusión de ${result.volume}ml (Paciente: ${result.patientName || 'N/A'}) terminará en ${minutesBefore} minutos.`,
        icon: 'https://placehold.co/100x100/0A58CE/FFFFFF?text=Infusión',
        vibrate: [200, 100, 200]
      });
      setReminderTimeoutId(null);
      setReminderMessage('Recordatorio disparado.');
    }, delaySeconds * 1000);

    setReminderTimeoutId(timeoutId);
    const reminderTime = new Date(Date.now() + delaySeconds * 1000);
    setReminderMessage(`Recordatorio establecido para el ${reminderTime.toLocaleString()}.`);
  };

  const cancelInfusionReminder = () => {
    if (reminderTimeoutId) {
      clearTimeout(reminderTimeoutId);
      setReminderTimeoutId(null);
      setReminderMessage('Recordatorio cancelado.');
    } else {
      setReminderMessage('No hay ningún recordatorio activo para cancelar.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="animate-spin text-blue-500 mr-2" size={24} />
        <span className="text-gray-700">Cargando aplicación...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-lg mb-8 border border-gray-200">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 text-center flex-grow leading-tight">
            Calculadora de Goteo <span className="block text-blue-600 text-2xl sm:text-3xl">Médica</span>
          </h1>
          <button
            onClick={() => setShowHowItWorksModal(true)}
            className="p-2 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition duration-200"
            aria-label="Cómo funciona la aplicación"
          >
            <Info size={24} />
          </button>
        </div>
        <p className="text-sm text-gray-600 text-center mb-6">ID de Usuario: {userId}</p>

        {/* Selector de Modo de Cálculo */}
        <div className="mb-6 flex justify-center space-x-4">
          <button
            onClick={() => { setCalculationMode('calculateTime'); clearInputs(); }}
            className={`px-5 py-2 rounded-lg font-medium transition duration-300 ${
              calculationMode === 'calculateTime' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Calcular Tiempo
          </button>
          <button
            onClick={() => { setCalculationMode('calculateFlow'); clearInputs(); }}
            className={`px-5 py-2 rounded-lg font-medium transition duration-300 ${
              calculationMode === 'calculateFlow' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Calcular Goteo Necesario
          </button>
        </div>

        {/* Campos de Entrada */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="mb-4">
            <label htmlFor="volume" className="block text-gray-800 text-sm font-semibold mb-2">
              Volumen de la bolsa (ml):
            </label>
            <input
              type="number"
              id="volume"
              value={volume}
              onChange={(e) => handleInputChange(e, setVolume, 'volume')}
              className={`w-full px-4 py-2 rounded-lg border ${inputErrors.volume ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm`}
              placeholder="Ejemplo: 500"
            />
          </div>

          <div className="mb-4 relative">
            <label htmlFor="dropsPerMlSelect" className="block text-gray-800 text-sm font-semibold mb-2">
              Gotas por ml (aproximado):
            </label>
            <div className="flex items-center">
              <select
                id="dropsPerMlSelect"
                value={dropsPerMl}
                onChange={handleDropsPerMlChange}
                className={`w-full px-4 py-2 rounded-lg border ${inputErrors.dropsPerMl ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm mr-2`}
              >
                <option value="20">Estándar (20 gotas/ml)</option>
                <option value="60">Microgotero (60 gotas/ml)</option>
                <option value="custom">Personalizado</option>
              </select>
              <button
                onClick={() => setShowInfoModal(true)}
                className="p-2 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition duration-200"
                aria-label="Información sobre gotas por ml"
              >
                <Info size={18} />
              </button>
            </div>
            {dropsPerMl === 'custom' && (
              <input
                type="number"
                value={customDropsPerMl}
                onChange={(e) => handleInputChange(e, setCustomDropsPerMl, 'customDropsPerMl')}
                className={`w-full px-4 py-2 mt-2 rounded-lg border ${inputErrors.customDropsPerMl ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm`}
                placeholder="Introduce valor personalizado"
              />
            )}
          </div>
        </div>

        {/* Campos Condicionales según el Modo de Cálculo */}
        {calculationMode === 'calculateTime' ? (
          <div className="mb-4">
            <label htmlFor="secondsPerDrop" className="block text-gray-800 text-sm font-semibold mb-2">
              Segundos por gota:
            </label>
            <input
              type="number"
              id="secondsPerDrop"
              value={secondsPerDrop}
              onChange={(e) => handleInputChange(e, setSecondsPerDrop, 'secondsPerDrop')}
              step="0.01"
              className={`w-full px-4 py-2 rounded-lg border ${inputErrors.secondsPerDrop ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm`}
              placeholder="Ejemplo: 10.34"
            />
          </div>
        ) : (
          <div className="mb-4">
            <label className="block text-gray-800 text-sm font-semibold mb-2">
              Tiempo deseado para la infusión:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={desiredHours}
                onChange={(e) => handleInputChange(e, setDesiredHours, 'desiredHours')}
                className={`px-4 py-2 rounded-lg border ${inputErrors.desiredHours ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm`}
                placeholder="Horas"
              />
              <input
                type="number"
                value={desiredMinutes}
                onChange={(e) => handleInputChange(e, setDesiredMinutes, 'desiredMinutes')}
                className={`px-4 py-2 rounded-lg border ${inputErrors.desiredMinutes ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm`}
                placeholder="Minutos"
              />
              <input
                type="number"
                value={desiredSeconds}
                onChange={(e) => handleInputChange(e, setDesiredSeconds, 'desiredSeconds')}
                className={`px-4 py-2 rounded-lg border ${inputErrors.desiredSeconds ? 'border-red-500' : 'border-gray-300'} focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm`}
                placeholder="Segundos"
              />
            </div>
          </div>
        )}

        {/* Campo de Nombre del Paciente */}
        <div className="mb-6">
          <label htmlFor="patientName" className="block text-gray-800 text-sm font-semibold mb-2">
            Nombre del paciente (opcional):
          </label>
          <input
            type="text"
            id="patientName"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 shadow-sm"
            placeholder="Ejemplo: Juan Pérez"
          />
        </div>

        {/* Botones de Acción */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <button
            onClick={handleSubmitCalculation}
            disabled={calculationLoading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 transition duration-300 ease-in-out transform hover:scale-105 shadow-md flex items-center justify-center"
          >
            {calculationLoading ? (
              <Loader2 className="animate-spin mr-2" size={20} />
            ) : (
              <CheckCircle className="mr-2" size={20} />
            )}
            {calculationLoading ? 'Calculando...' : 'Realizar Cálculo'}
          </button>
          <button
            onClick={clearInputs}
            className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-3 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-75 transition duration-300 ease-in-out transform hover:scale-105 shadow-md flex items-center justify-center"
          >
            <Trash2 className="mr-2" size={20} />
            Limpiar Campos
          </button>
        </div>

        {/* Formato de Visualización para Resultados de Tiempo */}
        {calculationMode === 'calculateTime' && (
          <div className="mb-6 flex justify-center space-x-4 p-3 bg-gray-50 rounded-lg shadow-sm">
            <span className="text-gray-700 text-sm font-semibold">Formato de tiempo:</span>
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio text-blue-600"
                name="displayFormat"
                value="hms"
                checked={displayFormat === 'hms'}
                onChange={(e) => setDisplayFormat(e.target.value)}
              />
              <span className="ml-2 text-gray-800 text-sm">H:M:S</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio text-blue-600"
                name="displayFormat"
                value="h"
                checked={displayFormat === 'h'}
                onChange={(e) => setDisplayFormat(e.target.value)}
              />
              <span className="ml-2 text-gray-800 text-sm">Solo Horas</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio text-blue-600"
                name="displayFormat"
                value="hm"
                checked={displayFormat === 'hm'}
                onChange={(e) => setDisplayFormat(e.target.value)}
              />
              <span className="ml-2 text-gray-800 text-sm">H:M</span>
            </label>
          </div>
        )}

        {/* Visualización de Resultados */}
        {error && (
          <div className="mt-6 p-4 bg-red-100 border border-red-200 text-red-700 rounded-lg text-center flex items-center justify-center shadow-sm">
            <XCircle className="mr-2" size={20} />
            <span>{error}</span>
          </div>
        )}

        {result && result.type === 'time' && (
          <div className="mt-6 p-4 bg-green-100 border border-green-200 text-green-800 rounded-lg text-center text-lg font-medium shadow-sm">
            {formatTimeResult(result)}

            {/* Sección de Recordatorio */}
            <div className="mt-4 pt-4 border-t border-green-200">
              <h4 className="text-base font-semibold text-gray-700 mb-2 flex items-center justify-center">
                <Bell size={18} className="mr-2" />
                Recordatorio de Infusión
              </h4>
              <div className="flex items-center justify-center mb-2">
                <label htmlFor="reminderMinutes" className="text-sm mr-2">Avisar:</label>
                <input
                  type="number"
                  id="reminderMinutes"
                  value={reminderMinutesBeforeEnd}
                  onChange={(e) => setReminderMinutesBeforeEnd(e.target.value)}
                  className="w-20 px-2 py-1 rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 text-center"
                  min="0"
                />
                <span className="text-sm ml-2">minutos antes de terminar</span>
              </div>
              <div className="flex justify-center space-x-2">
                <button
                  onClick={setInfusionReminder}
                  className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition duration-200 flex items-center"
                >
                  <Bell size={16} className="mr-1" /> Configurar
                </button>
                <button
                  onClick={cancelInfusionReminder}
                  className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm transition duration-200 flex items-center"
                >
                  <BellOff size={16} className="mr-1" /> Cancelar
                </button>
              </div>
              {reminderMessage && (
                <p className="text-sm text-gray-600 mt-2">{reminderMessage}</p>
              )}
            </div>
          </div>
        )}

        {result && result.type === 'flow' && (
          <div className="mt-6 p-4 bg-green-100 border border-green-200 text-green-800 rounded-lg text-center text-lg font-medium shadow-sm">
            <p className="font-bold mb-1">Goteo necesario:</p>
            <p><span className="font-semibold">{result.dropsPerMinute}</span> gotas/min</p>
            <p><span className="font-semibold">{result.mlPerHour}</span> ml/hora</p>
          </div>
        )}
      </div>

      {/* Sección de Historial */}
      {history.length > 0 && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-lg border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center">
            <History className="mr-2" size={24} /> Historial de Cálculos
          </h2>
          <ul className="space-y-3">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 shadow-sm text-sm sm:text-base cursor-pointer hover:bg-gray-100 transition duration-200"
              >
                <div className="flex-grow" onClick={() => openHistoryDetailModal(entry)}>
                  {entry.patientName && (
                    <p className="text-gray-900 font-semibold mb-1 flex items-center">
                      <User className="mr-2" size={16} /> Paciente: {entry.patientName}
                    </p>
                  )}
                  <p className="text-gray-800 font-medium">
                    <span className="font-semibold">Volumen:</span> {entry.volume} ml,{" "}
                    <span className="font-semibold">Gotas/ml:</span> {entry.dropsPerMl}
                  </p>
                  {entry.type === 'time' ? (
                    <p className="text-gray-600 mt-1">
                      Tiempo: {entry.hours}h, {entry.minutes}m, {entry.seconds}s
                    </p>
                  ) : (
                    <p className="text-gray-600 mt-1">
                      Goteo: <span className="font-semibold">{entry.dropsPerMinute}</span> g/min,{" "}
                      <span className="font-semibold">{entry.mlPerHour}</span> ml/h
                    </p>
                  )}
                  <p className="text-gray-500 text-xs mt-1">
                    {new Date(entry.timestamp).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => deleteHistoryEntry(entry.id)}
                  className="ml-4 p-2 bg-red-500 hover:bg-red-600 text-white rounded-full transition duration-200 ease-in-out transform hover:scale-110 shadow-md"
                  aria-label="Eliminar entrada"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modal de Información de Gotas por ml */}
      {showInfoModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div ref={infoModalRef} className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full relative">
            <h3 className="text-lg font-bold mb-3 text-gray-900">Información: Gotas por ml</h3>
            <p className="text-gray-700 text-sm">
              En medicina, la aproximación estándar es:
            </p>
            <p className="text-gray-700 text-sm font-semibold mt-2">
              1 ml ≈ 20 gotas
            </p>
            <p className="text-gray-700 text-sm mt-1">
              (Esto puede variar ligeramente según el equipo de venoclisis utilizado, pero 20 gotas/ml es lo más común para equipo estándar, y 60 gotas/ml para microgoteros).
            </p>
            <button
              onClick={() => setShowInfoModal(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
              aria-label="Cerrar"
            >
              <XCircle size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Modal de Cómo Funciona */}
      {showHowItWorksModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div ref={howItWorksModalRef} className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full relative">
            <h3 className="text-xl font-bold mb-3 text-gray-900">¿Cómo funciona esta app?</h3>
            <p className="text-gray-700 text-base">
              Esta aplicación calcula el tiempo de infusión o la velocidad de goteo necesaria basándose en una lógica sencilla:
            </p>
            <ul className="list-disc list-inside text-gray-700 text-sm mt-3 space-y-2">
              <li>Primero, calcula el número total de gotas en la bolsa, usando el volumen y la equivalencia de "gotas por ml".</li>
              <li>Para calcular el tiempo, multiplica el número total de gotas por el "tiempo que tarda en caer una gota" (segundos por gota). El resultado se convierte a horas, minutos y segundos.</li>
              <li>Para calcular el goteo necesario, usa el volumen total de la bolsa y el tiempo deseado para la infusión, determinando cuántas gotas o mililitros deben caer por minuto u hora para completarse en ese período.</li>
            </ul>
            <p className="text-gray-700 text-sm mt-4 font-semibold">
              Es importante que introduzcas el tiempo preciso que tarda en caer una gota después de la otra para obtener cálculos exactos.
            </p>
            <button
              onClick={() => setShowHowItWorksModal(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
              aria-label="Cerrar"
            >
              <XCircle size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Modal de Detalles del Historial */}
      {showHistoryDetailModal && selectedHistoryEntry && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div ref={historyDetailModalRef} className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full relative">
            <h3 className="text-xl font-bold mb-4 text-gray-900 flex items-center">
              <Eye className="mr-2" size={24} /> Detalles del Cálculo
            </h3>

            {selectedHistoryEntry.patientName && (
              <p className="text-gray-900 mb-2 flex items-center">
                <User className="mr-2" size={18} /> <span className="font-semibold">Paciente:</span> {selectedHistoryEntry.patientName}
              </p>
            )}
            <p className="text-gray-800 mb-2">
              <span className="font-semibold">Volumen:</span> {selectedHistoryEntry.volume} ml
            </p>
            <p className="text-gray-800 mb-2">
              <span className="font-semibold">Gotas por ml:</span> {selectedHistoryEntry.dropsPerMl}
            </p>

            {selectedHistoryEntry.type === 'time' ? (
              <>
                <p className="text-gray-800 mb-2">
                  <span className="font-semibold">Segundos por gota:</span> {selectedHistoryEntry.secondsPerDrop}
                </p>
                <p className="text-blue-700 text-lg font-bold mt-4">
                  Tiempo de Infusión: {selectedHistoryEntry.hours}h, {selectedHistoryEntry.minutes}m, {selectedHistoryEntry.seconds}s
                </p>
              </>
            ) : (
              <>
                <p className="text-gray-800 mb-2">
                  <span className="font-semibold">Tiempo Deseado:</span> {selectedHistoryEntry.desiredHours}h, {selectedHistoryEntry.desiredMinutes}m, {selectedHistoryEntry.desiredSeconds}s
                </p>
                <p className="text-blue-700 text-lg font-bold mt-4">
                  Goteo Necesario: <span className="font-semibold">{selectedHistoryEntry.dropsPerMinute}</span> gotas/min, <span className="font-semibold">{selectedHistoryEntry.mlPerHour}</span> ml/hora
                </p>
              </>
            )}

            <p className="text-gray-500 text-sm mt-4">
              Fecha del cálculo: {new Date(selectedHistoryEntry.timestamp).toLocaleString()}
            </p>

            <button
              onClick={closeHistoryDetailModal}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
              aria-label="Cerrar"
            >
              <XCircle size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
