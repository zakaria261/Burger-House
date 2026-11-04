'use client';
import { useEffect, useState } from 'react';
import { Bell, Check, Smartphone } from 'lucide-react';
type Config = {
  recipientConfigured: boolean;
  canSubscribe: boolean;
  publicKey: string;
  subscribed: boolean;
  events: string[];
};
const choices = [
  ['in', 'Arrivées'],
  ['pause', 'Pauses'],
  ['resume', 'Reprises'],
  ['out', 'Départs'],
];
async function api(method: string, body?: unknown) {
  const response = await fetch('/api/push', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Notifications indisponibles.');
  return data;
}
export default function NotificationSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [events, setEvents] = useState(['in', 'pause', 'resume', 'out']);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [supported, setSupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const load = async () => {
    const data = (await api('GET')) as Config;
    if (
      data.canSubscribe &&
      data.subscribed &&
      'Notification' in window &&
      'serviceWorker' in navigator
    ) {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager?.getSubscription();
      if (Notification.permission !== 'granted' || !subscription) {
        data.subscribed = false;
        setMessage(
          Notification.permission === 'denied'
            ? 'Les notifications sont bloquées dans les réglages du téléphone. Autorisez Burger House, puis réactivez-les ici.'
            : 'Réactivez les notifications sur ce téléphone.',
        );
      }
    }
    setConfig(data);
    setEvents([...data.events]);
  };
  useEffect(() => {
    setSupported(
      'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator,
    );
    setNeedsInstall(
      /iPhone|iPad|iPod/.test(navigator.userAgent) &&
        !matchMedia('(display-mode: standalone)').matches &&
        !(navigator as Navigator & { standalone?: boolean }).standalone,
    );
    void load().catch((e) => setMessage(e.message));
  }, []);
  async function activate() {
    // Ask during the tap gesture, before any network or service-worker wait (required on iOS).
    setBusy(true);
    setMessage('');
    try {
      const permission = Notification.requestPermission();
      if ((await permission) !== 'granted')
        throw new Error(
          'Autorisez les notifications dans les réglages du téléphone pour recevoir les pointages.',
        );
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const key = Uint8Array.from(
          atob(config!.publicKey.replaceAll('-', '+').replaceAll('_', '/')),
          (c) => c.charCodeAt(0),
        );
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      }
      await api('POST', { subscription: subscription.toJSON(), events });
      await load();
      setMessage('Ce téléphone recevra les prochains pointages.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveEvents(next: string[]) {
    if (!next.length) {
      setMessage('Gardez au moins un type de notification.');
      return;
    }
    setEvents(next);
    if (!config?.subscribed) return;
    setBusy(true);
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (!sub) throw new Error('Réactivez les notifications sur ce téléphone.');
      await api('POST', { subscription: sub.toJSON(), events: next });
      await load();
      setMessage('Préférences enregistrées.');
    } catch (e) {
      setMessage((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel notification-panel">
      <div className="notification-heading">
        <span className="notification-symbol">
          <Bell size={22} />
        </span>
        <div>
          <h3>Les pointages, en direct</h3>
          <p>Votre équipe, sur votre téléphone.</p>
        </div>
        {config?.subscribed && (
          <span className="soft-label">
            <Check size={12} />
            Activées
          </span>
        )}
      </div>
      <p className="notification-copy">
        Un membre de l’équipe commence, fait une pause ou termine son service : recevez
        l’information sur ce téléphone, même quand l’app est fermée.
      </p>
      {!config ? (
        <p className="field-help">{message || 'Vérification des notifications…'}</p>
      ) : !config.recipientConfigured ? (
        <div className="info-box">
          <Smartphone size={20} />
          <p>
            Les notifications seront disponibles après la configuration des destinataires du
            restaurant.
          </p>
        </div>
      ) : !config.canSubscribe ? (
        <div className="info-box">
          <Smartphone size={20} />
          <p>
            Les notifications ne sont pas encore activées pour ce compte. Utilisez un compte
            autorisé par le responsable.
          </p>
        </div>
      ) : (
        <>
          {needsInstall ? (
            <div className="info-box">
              <Smartphone size={20} />
              <p>
                Sur iPhone, ajoutez Burger House à l’écran d’accueil, ouvrez l’app depuis son icône,
                puis activez les notifications ici (iOS 16.4 minimum).
              </p>
            </div>
          ) : !supported ? (
            <p className="field-help">
              Ce navigateur ne prend pas en charge les notifications. Ouvrez l’app sur un téléphone
              compatible.
            </p>
          ) : (
            <>
              <div className="notification-choices">
                {choices.map(([event, label]) => (
                  <label key={event}>
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={events.includes(event)}
                      disabled={busy}
                      onChange={(e) =>
                        void saveEvents(
                          e.target.checked ? [...events, event] : events.filter((x) => x !== event),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="notification-actions">
                {!config.subscribed ? (
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void activate()}
                  >
                    <Bell size={17} />
                    {busy ? 'Activation…' : 'Activer sur ce téléphone'}
                  </button>
                ) : (
                  <>
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api('POST', { type: 'test' });
                          setMessage(
                            'Notification de test mise en envoi. Vérifiez votre écran verrouillé.',
                          );
                        } catch (e) {
                          setMessage((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Envoyer un test
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api('DELETE');
                          const r = await navigator.serviceWorker.ready;
                          await (await r.pushManager.getSubscription())?.unsubscribe();
                          await load();
                          setMessage('Notifications désactivées sur ce téléphone.');
                        } catch (e) {
                          setMessage((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Désactiver
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {!!message && (
            <p className="field-help" role="status">
              {message}
            </p>
          )}
        </>
      )}
      <p className="field-help">
        Les horaires détaillés restent disponibles dans Équipe. La déconnexion désactive les
        notifications de ce téléphone.
      </p>
    </section>
  );
}
