import type { BannerTexts, BannerTheme } from './types';

export const DEFAULT_THEME: BannerTheme = {
  background: '#ffffff',
  text: '#1d2433',
  primary: '#1f5eff',
  primaryText: '#ffffff',
  secondary: '#eef1f6',
  secondaryText: '#1d2433',
  radius: 10,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const en: BannerTexts = {
  title: 'We value your privacy',
  description:
    'We use cookies to run this site, remember your settings, measure traffic and show relevant ads. Choose which cookies you allow. You can change your choice at any time.',
  acceptAll: 'Accept all',
  rejectAll: 'Reject all',
  customize: 'Customize',
  save: 'Save my choices',
  preferencesTitle: 'Cookie preferences',
  preferencesDescription:
    'Necessary cookies are always on because the site needs them to work. Turn the other categories on or off.',
  privacyPolicy: 'Privacy policy',
  doNotSell: 'Do Not Sell or Share My Personal Information',
  ccpaDescription:
    'We use cookies for analytics and advertising. You can opt out of the sale or sharing of your personal information.',
  noticeDescription: 'This site uses cookies to improve your experience.',
  ok: 'OK',
  alwaysActive: 'Always active',
  cookiesUsed: 'Cookies in this category',
  floatingButton: 'Cookie settings',
  blockedContent: 'This content is blocked because it uses {category} cookies.',
  allowContent: 'Allow {category} cookies',
  categories: {
    necessary: { name: 'Necessary', description: 'Required for the site to work, such as security, load balancing and remembering your consent.' },
    preferences: { name: 'Preferences', description: 'Remember choices you make, such as language or region.' },
    statistics: { name: 'Statistics', description: 'Help us understand how visitors use the site, collected in aggregate.' },
    marketing: { name: 'Marketing', description: 'Used to show relevant ads and measure campaigns across websites.' },
  },
  table: { name: 'Name', provider: 'Provider', purpose: 'Purpose', expiry: 'Expiry', firstParty: 'This site' },
};

const de: BannerTexts = {
  title: 'Wir respektieren Ihre Privatsphäre',
  description:
    'Wir verwenden Cookies, um diese Website zu betreiben, Ihre Einstellungen zu speichern, Besuche zu messen und relevante Werbung zu zeigen. Wählen Sie, welche Cookies Sie zulassen. Sie können Ihre Auswahl jederzeit ändern.',
  acceptAll: 'Alle akzeptieren',
  rejectAll: 'Alle ablehnen',
  customize: 'Anpassen',
  save: 'Auswahl speichern',
  preferencesTitle: 'Cookie-Einstellungen',
  preferencesDescription:
    'Notwendige Cookies sind immer aktiv, weil die Website sie benötigt. Die anderen Kategorien können Sie ein- oder ausschalten.',
  privacyPolicy: 'Datenschutzerklärung',
  doNotSell: 'Meine personenbezogenen Daten nicht verkaufen oder teilen',
  ccpaDescription: 'Wir verwenden Cookies für Analyse und Werbung. Sie können dem Verkauf oder der Weitergabe Ihrer Daten widersprechen.',
  noticeDescription: 'Diese Website verwendet Cookies, um Ihr Erlebnis zu verbessern.',
  ok: 'OK',
  alwaysActive: 'Immer aktiv',
  cookiesUsed: 'Cookies in dieser Kategorie',
  floatingButton: 'Cookie-Einstellungen',
  blockedContent: 'Dieser Inhalt ist blockiert, weil er {category}-Cookies verwendet.',
  allowContent: '{category}-Cookies erlauben',
  categories: {
    necessary: { name: 'Notwendig', description: 'Erforderlich für den Betrieb der Website, z. B. Sicherheit und Speicherung Ihrer Einwilligung.' },
    preferences: { name: 'Präferenzen', description: 'Speichern Ihre Auswahl, z. B. Sprache oder Region.' },
    statistics: { name: 'Statistik', description: 'Helfen uns zu verstehen, wie Besucher die Website nutzen.' },
    marketing: { name: 'Marketing', description: 'Werden genutzt, um relevante Werbung zu zeigen und Kampagnen zu messen.' },
  },
  table: { name: 'Name', provider: 'Anbieter', purpose: 'Zweck', expiry: 'Ablauf', firstParty: 'Diese Website' },
};

const fr: BannerTexts = {
  title: 'Nous respectons votre vie privée',
  description:
    'Nous utilisons des cookies pour faire fonctionner ce site, mémoriser vos réglages, mesurer l’audience et afficher des publicités pertinentes. Choisissez les cookies que vous acceptez. Vous pouvez modifier votre choix à tout moment.',
  acceptAll: 'Tout accepter',
  rejectAll: 'Tout refuser',
  customize: 'Personnaliser',
  save: 'Enregistrer mes choix',
  preferencesTitle: 'Préférences de cookies',
  preferencesDescription:
    'Les cookies nécessaires sont toujours actifs car le site en a besoin. Activez ou désactivez les autres catégories.',
  privacyPolicy: 'Politique de confidentialité',
  doNotSell: 'Ne pas vendre ni partager mes informations personnelles',
  ccpaDescription: 'Nous utilisons des cookies pour l’analyse et la publicité. Vous pouvez refuser la vente ou le partage de vos informations.',
  noticeDescription: 'Ce site utilise des cookies pour améliorer votre expérience.',
  ok: 'OK',
  alwaysActive: 'Toujours actifs',
  cookiesUsed: 'Cookies de cette catégorie',
  floatingButton: 'Paramètres des cookies',
  blockedContent: 'Ce contenu est bloqué car il utilise des cookies {category}.',
  allowContent: 'Autoriser les cookies {category}',
  categories: {
    necessary: { name: 'Nécessaires', description: 'Indispensables au fonctionnement du site, comme la sécurité et la mémorisation de votre consentement.' },
    preferences: { name: 'Préférences', description: 'Mémorisent vos choix, comme la langue ou la région.' },
    statistics: { name: 'Statistiques', description: 'Nous aident à comprendre comment les visiteurs utilisent le site.' },
    marketing: { name: 'Marketing', description: 'Servent à afficher des publicités pertinentes et à mesurer les campagnes.' },
  },
  table: { name: 'Nom', provider: 'Fournisseur', purpose: 'Finalité', expiry: 'Expiration', firstParty: 'Ce site' },
};

const es: BannerTexts = {
  title: 'Respetamos tu privacidad',
  description:
    'Usamos cookies para que este sitio funcione, recordar tus ajustes, medir el tráfico y mostrar anuncios relevantes. Elige qué cookies permites. Puedes cambiar tu elección en cualquier momento.',
  acceptAll: 'Aceptar todas',
  rejectAll: 'Rechazar todas',
  customize: 'Personalizar',
  save: 'Guardar mis opciones',
  preferencesTitle: 'Preferencias de cookies',
  preferencesDescription:
    'Las cookies necesarias siempre están activas porque el sitio las necesita. Activa o desactiva las demás categorías.',
  privacyPolicy: 'Política de privacidad',
  doNotSell: 'No vender ni compartir mi información personal',
  ccpaDescription: 'Usamos cookies para análisis y publicidad. Puedes oponerte a la venta o el intercambio de tu información.',
  noticeDescription: 'Este sitio usa cookies para mejorar tu experiencia.',
  ok: 'OK',
  alwaysActive: 'Siempre activas',
  cookiesUsed: 'Cookies de esta categoría',
  floatingButton: 'Ajustes de cookies',
  blockedContent: 'Este contenido está bloqueado porque usa cookies de {category}.',
  allowContent: 'Permitir cookies de {category}',
  categories: {
    necessary: { name: 'Necesarias', description: 'Imprescindibles para el funcionamiento del sitio, como la seguridad y recordar tu consentimiento.' },
    preferences: { name: 'Preferencias', description: 'Recuerdan tus elecciones, como el idioma o la región.' },
    statistics: { name: 'Estadísticas', description: 'Nos ayudan a entender cómo usan el sitio los visitantes.' },
    marketing: { name: 'Marketing', description: 'Se usan para mostrar anuncios relevantes y medir campañas.' },
  },
  table: { name: 'Nombre', provider: 'Proveedor', purpose: 'Finalidad', expiry: 'Caducidad', firstParty: 'Este sitio' },
};

export const DEFAULT_TEXTS: Record<string, BannerTexts> = { en, de, fr, es };
export const SUPPORTED_LANGUAGES = Object.keys(DEFAULT_TEXTS);

/** Merge user overrides on top of the built-in translation (falls back to English). */
export function resolveTexts(lang: string, overrides?: Partial<BannerTexts>): BannerTexts {
  const base = DEFAULT_TEXTS[lang] ?? DEFAULT_TEXTS.en;
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    categories: { ...base.categories, ...(overrides.categories ?? {}) },
    table: { ...base.table, ...(overrides.table ?? {}) },
  };
}
