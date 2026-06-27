// Metro has no import.meta.glob, so namespaces are wired explicitly here.
// One JSON per namespace per language under ./locales/<lng>/<ns>.json.
// Keep both languages in sync when adding a namespace.
import itCommon from './locales/it/common.json';
import itLogin from './locales/it/login.json';
import itLock from './locales/it/lock.json';
import itForgotPassword from './locales/it/forgotPassword.json';
import itTimbrature from './locales/it/timbrature.json';
import itDashboard from './locales/it/dashboard.json';
import itBacheca from './locales/it/bacheca.json';
import itStorico from './locales/it/storico.json';
import itCorrezioni from './locales/it/correzioni.json';
import itRichieste from './locales/it/richieste.json';
import itProfilo from './locales/it/profilo.json';
import itDocumenti from './locales/it/documenti.json';
import itChooseTenant from './locales/it/chooseTenant.json';
import itComponents from './locales/it/components.json';

import enCommon from './locales/en/common.json';
import enLogin from './locales/en/login.json';
import enLock from './locales/en/lock.json';
import enForgotPassword from './locales/en/forgotPassword.json';
import enTimbrature from './locales/en/timbrature.json';
import enDashboard from './locales/en/dashboard.json';
import enBacheca from './locales/en/bacheca.json';
import enStorico from './locales/en/storico.json';
import enCorrezioni from './locales/en/correzioni.json';
import enRichieste from './locales/en/richieste.json';
import enProfilo from './locales/en/profilo.json';
import enDocumenti from './locales/en/documenti.json';
import enChooseTenant from './locales/en/chooseTenant.json';
import enComponents from './locales/en/components.json';

export const resources = {
  it: {
    common: itCommon,
    login: itLogin,
    lock: itLock,
    forgotPassword: itForgotPassword,
    timbrature: itTimbrature,
    dashboard: itDashboard,
    bacheca: itBacheca,
    storico: itStorico,
    correzioni: itCorrezioni,
    richieste: itRichieste,
    profilo: itProfilo,
    documenti: itDocumenti,
    chooseTenant: itChooseTenant,
    components: itComponents,
  },
  en: {
    common: enCommon,
    login: enLogin,
    lock: enLock,
    forgotPassword: enForgotPassword,
    timbrature: enTimbrature,
    dashboard: enDashboard,
    bacheca: enBacheca,
    storico: enStorico,
    correzioni: enCorrezioni,
    richieste: enRichieste,
    profilo: enProfilo,
    documenti: enDocumenti,
    chooseTenant: enChooseTenant,
    components: enComponents,
  },
} as const;

export const NAMESPACES = Object.keys(resources.it) as Array<keyof typeof resources.it>;
